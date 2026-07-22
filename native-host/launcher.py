"""Chrome/Edge Native Messaging host that starts the local backend."""

import json
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
BACKEND_PORT = 8766
BACKEND_URL = f"http://127.0.0.1:{BACKEND_PORT}/health"
REQUIRED_PIPELINE_VERSION = "4"


def read_message() -> dict:
    length_data = sys.stdin.buffer.read(4)
    if len(length_data) != 4:
        return {}
    length = struct.unpack("<I", length_data)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def healthy() -> bool:
    try:
        with urlopen(BACKEND_URL, timeout=1) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return payload.get("status") == "ok" and str(payload.get("pipelineVersion")) == REQUIRED_PIPELINE_VERSION
    except Exception:
        return False


def start_backend() -> dict:
    if healthy():
        return {"ok": True, "status": "already-running"}
    scripts = ROOT / ".venv" / "Scripts"
    pythonw = scripts / "pythonw.exe"
    python = scripts / "python.exe"
    executable = pythonw if pythonw.exists() else python
    if not executable.exists():
        return {"ok": False, "error": f"Virtual environment not found: {executable}"}
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
    subprocess.Popen(
        [str(executable), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
        cwd=ROOT / "backend",
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )
    for _ in range(30):
        if healthy():
            return {"ok": True, "status": "started"}
        time.sleep(0.25)
    return {"ok": False, "error": "Backend did not become healthy within 7.5 seconds."}


def main() -> None:
    if read_message().get("command") == "start":
        send_message(start_backend())
    else:
        send_message({"ok": False, "error": "Unsupported native command."})


if __name__ == "__main__":
    main()
