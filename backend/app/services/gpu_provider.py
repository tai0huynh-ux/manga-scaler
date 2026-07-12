"""ONNX Runtime execution provider detection and selection."""

import logging
from dataclasses import dataclass

import onnxruntime as ort

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderSelection:
    """Selected ONNX Runtime provider and diagnostics."""

    provider: str
    available_providers: tuple[str, ...]
    gpu: dict[str, str | bool | tuple[str, ...]]


class GpuProviderSelector:
    """Selects the best available ONNX Runtime provider from config preference."""

    def __init__(self, preferred_providers: tuple[str, ...]) -> None:
        self.preferred_providers = preferred_providers
        self.selection = self._select_provider()

    def current(self) -> ProviderSelection:
        """Return the current provider selection."""
        return self.selection

    def _select_provider(self) -> ProviderSelection:
        available = tuple(ort.get_available_providers())
        for provider in self.preferred_providers:
            if provider in available:
                LOGGER.info(
                    "Selected ONNX Runtime provider",
                    extra={"_provider": provider, "_available_providers": available},
                )
                return ProviderSelection(
                    provider=provider,
                    available_providers=available,
                    gpu={
                        "accelerated": provider != "CPUExecutionProvider",
                        "provider": provider,
                        "availableProviders": available,
                    },
                )

        LOGGER.warning(
            "No preferred ONNX Runtime provider available; falling back to CPU",
            extra={"_available_providers": available},
        )
        return ProviderSelection(
            provider="CPUExecutionProvider",
            available_providers=available,
            gpu={
                "accelerated": False,
                "provider": "CPUExecutionProvider",
                "availableProviders": available,
            },
        )
