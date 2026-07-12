"""Singleton ONNX Runtime model manager with hot reload support."""

import logging
import hashlib
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar
from urllib.request import Request, urlopen
from uuid import uuid4

import numpy as np
import onnxruntime as ort

from app.core.config import InferenceConfig, ModelConfig
from app.services.gpu_provider import GpuProviderSelector

LOGGER = logging.getLogger(__name__)


@dataclass
class LoadedModel:
    """Loaded ONNX model session and metadata."""

    name: str
    path: Path
    scale: int
    session: ort.InferenceSession
    input_name: str
    output_name: str
    mtime: float
    provider: str
    run_lock: threading.Lock


class ModelManager:
    """Loads ONNX models once, supports hot reload, and switches active models."""

    _instance: ClassVar["ModelManager | None"] = None
    _instance_lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(
        self,
        models_dir: Path,
        config: InferenceConfig,
        provider_selector: GpuProviderSelector,
    ) -> None:
        self.models_dir = models_dir
        self.config = config
        self.provider_selector = provider_selector
        self.active_model_name = config.default_model
        self.loaded: dict[str, LoadedModel] = {}
        self.lock = threading.RLock()

    @classmethod
    def create_singleton(
        cls,
        models_dir: Path,
        config: InferenceConfig,
        provider_selector: GpuProviderSelector,
    ) -> "ModelManager":
        """Create or replace the process singleton."""
        with cls._instance_lock:
            cls._instance = cls(models_dir, config, provider_selector)
            return cls._instance

    @classmethod
    def instance(cls) -> "ModelManager":
        """Return the configured singleton instance."""
        if cls._instance is None:
            raise RuntimeError("ModelManager has not been initialized.")
        return cls._instance

    def switch_model(self, model_name: str) -> LoadedModel:
        """Switch the active model, loading it if needed."""
        with self.lock:
            model = self.load_model(model_name)
            self.active_model_name = model_name
            LOGGER.info("Switched active model", extra={"_model": model_name})
            return model

    def reload_active_model(self) -> LoadedModel:
        """Force a thread-safe reload of the active model."""
        with self.lock:
            self.loaded.pop(self.active_model_name, None)
            return self.load_model(self.active_model_name)

    def get_active_model(self) -> LoadedModel:
        """Return the active model, hot reloading if the file changed."""
        return self.get_model(self.active_model_name)

    def get_model(self, model_name: str | None = None) -> LoadedModel:
        """Return a loaded model by name."""
        with self.lock:
            name = model_name or self.active_model_name
            model = self.loaded.get(name)
            if model and self._is_stale(model):
                LOGGER.info("Hot reloading changed model", extra={"_model": name})
                self.loaded.pop(name, None)
                model = None
            return model or self.load_model(name)

    def load_model(self, model_name: str) -> LoadedModel:
        """Load an ONNX model session exactly once unless hot reload invalidates it."""
        if model_name not in self.config.models:
            raise ValueError(f"Unknown model: {model_name}")

        existing = self.loaded.get(model_name)
        if existing:
            return existing

        descriptor = self.config.models[model_name]
        path = self._model_path(descriptor)
        if not path.exists():
            self._download_model(descriptor, path)
        self._verify_checksum(descriptor, path)

        provider = self.provider_selector.current().provider
        session_options = ort.SessionOptions()
        is_directml = provider == "DmlExecutionProvider"
        session_options.enable_mem_pattern = not is_directml
        session_options.enable_cpu_mem_arena = True
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        session = ort.InferenceSession(
            str(path),
            sess_options=session_options,
            providers=[provider],
        )
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name
        loaded = LoadedModel(
            name=model_name,
            path=path,
            scale=descriptor.scale,
            session=session,
            input_name=input_name,
            output_name=output_name,
            mtime=path.stat().st_mtime,
            provider=provider,
            run_lock=threading.Lock(),
        )
        self.loaded[model_name] = loaded
        LOGGER.info("Loaded ONNX model", extra={"_model": model_name, "_path": str(path), "_provider": provider})

        if self.config.warmup:
            self.warmup(loaded)

        return loaded

    def warmup(self, model: LoadedModel) -> None:
        """Warm provider kernels using concrete model dimensions when available."""
        input_shape = model.session.get_inputs()[0].shape
        if len(input_shape) != 4:
            raise ValueError(f"Model {model.name} must expose a four-dimensional NCHW input.")
        fallback = (1, 3, self.config.tile_size, self.config.tile_size)
        shape = tuple(
            dimension if isinstance(dimension, int) and dimension > 0 else fallback[index]
            for index, dimension in enumerate(input_shape)
        )
        sample = np.zeros(shape, dtype=np.float32)
        with model.run_lock:
            model.session.run([model.output_name], {model.input_name: sample})
        LOGGER.info("Completed model warmup", extra={"_model": model.name})

    def status(self) -> dict[str, object]:
        """Return model manager diagnostics."""
        return {
            "activeModel": self.active_model_name,
            "loadedModels": sorted(self.loaded),
            "availableModels": sorted(self.config.models),
            "installedModels": sorted(
                name for name, descriptor in self.config.models.items() if self._model_path(descriptor).exists()
            ),
            "provider": self.provider_selector.current().provider,
        }

    def _model_path(self, descriptor: ModelConfig) -> Path:
        """Resolve a model file path from a descriptor."""
        return (self.models_dir / descriptor.file).resolve()

    def _download_model(self, descriptor: ModelConfig, path: Path) -> None:
        """Download an explicitly configured model using an atomic publish."""
        if not descriptor.auto_download or not descriptor.url:
            raise FileNotFoundError(f"Model file not found and auto-download is unavailable: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.download")
        LOGGER.info("Downloading ONNX model", extra={"_url": descriptor.url, "_path": str(path)})
        try:
            request = Request(descriptor.url, headers={"User-Agent": "AI-Manga-Upscaler/0.2"})
            with urlopen(request, timeout=120) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            self._verify_checksum(descriptor, temporary)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _verify_checksum(self, descriptor: ModelConfig, path: Path) -> None:
        """Reject incomplete or replaced model artifacts."""
        if not descriptor.sha256:
            return
        digest = hashlib.sha256()
        with path.open("rb") as model_file:
            while chunk := model_file.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest().lower() != descriptor.sha256.lower():
            raise ValueError(f"Model checksum mismatch: {path}")

    def _is_stale(self, model: LoadedModel) -> bool:
        """Return whether the model file has changed since loading."""
        return not model.path.exists() or model.path.stat().st_mtime != model.mtime
