"""Development entry point for running the local FastAPI service."""

import uvicorn

from app.core.config import get_settings


def main() -> None:
    """Start the backend using the configured host and port."""
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.app.host,
        port=settings.app.port,
        reload=True,
    )


if __name__ == "__main__":
    main()
