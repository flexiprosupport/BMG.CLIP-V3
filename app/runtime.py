"""Identify the source loaded by this process, not subsequently replaced files."""
import hashlib
from pathlib import Path

API_CONTRACT = 3

def source_fingerprint(directory=None):
    root=Path(directory) if directory is not None else Path(__file__).parent
    entries=[p.name+":"+hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(root.glob("*.py"),key=lambda p:p.name)]
    return hashlib.sha256("|".join(entries).encode("utf-8")).hexdigest()

# Capture once: reading disk anew in /health would hide a stale running process.
LOADED_FINGERPRINT=source_fingerprint()
