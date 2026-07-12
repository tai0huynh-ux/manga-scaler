"""Hash helpers for cache keys."""

import hashlib


def sha256_bytes(content: bytes) -> str:
    """Return the SHA256 hexadecimal digest for a byte payload."""
    return hashlib.sha256(content).hexdigest()

