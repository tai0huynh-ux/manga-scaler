"""Native launcher compatibility tests."""

import importlib.util
import json
from pathlib import Path


def load_launcher():
    launcher_path = Path(__file__).resolve().parents[2] / "native-host" / "launcher.py"
    spec = importlib.util.spec_from_file_location("ai_manga_native_launcher", launcher_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_launcher_rejects_http_healthy_backend_with_stale_pipeline(monkeypatch) -> None:
    launcher = load_launcher()

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"status": "ok"}).encode("utf-8")

    monkeypatch.setattr(launcher, "urlopen", lambda *_args, **_kwargs: Response())

    assert launcher.healthy() is False
    assert launcher.BACKEND_PORT == 8766
    assert launcher.REQUIRED_PIPELINE_VERSION == "3"
