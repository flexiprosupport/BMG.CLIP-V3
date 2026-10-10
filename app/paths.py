"""Central filesystem layout for the project.

All other modules import these so directory locations are defined exactly once.
The directories are created on import (and again at startup) so the very first
run works without any manual setup.
"""

from __future__ import annotations

from pathlib import Path

# Project root = the directory that contains the `app/` package.
ROOT_DIR = Path(__file__).resolve().parent.parent

DOWNLOADS_DIR = ROOT_DIR / "downloads"
TRANSCRIPTS_DIR = ROOT_DIR / "transcripts"
CLIPS_DIR = ROOT_DIR / "clips"
ASSETS_DIR = ROOT_DIR / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
MASKS_DIR = ASSETS_DIR / "masks"
# Background-music library. Users can drop .mp3/.m4a/.wav files straight in here,
# or upload them through the UI — both show up as track options.
MUSIC_DIR = ASSETS_DIR / "music"
STATIC_DIR = ROOT_DIR / "static"
# Built React dashboard (web/dist) — served as the primary frontend when present.
WEB_DIST_DIR = ROOT_DIR / "web" / "dist"
MODELS_DIR = ROOT_DIR / "models"
FFMPEG_DIR = ROOT_DIR / "ffmpeg"

import os
if "HF_HOME" not in os.environ:
    os.environ["HF_HOME"] = str(MODELS_DIR)


def ensure_ffmpeg() -> None:
    """Ensure ffmpeg is on PATH if bundled in ROOT_DIR / 'ffmpeg'."""
    if (FFMPEG_DIR / "ffmpeg.exe").is_file() or (FFMPEG_DIR / "ffmpeg").is_file():
        if str(FFMPEG_DIR) not in os.environ.get("PATH", ""):
            os.environ["PATH"] = str(FFMPEG_DIR) + os.pathsep + os.environ.get("PATH", "")


def ensure_dirs() -> None:
    """Create every runtime directory if it does not already exist."""
    for directory in (
        DOWNLOADS_DIR,
        TRANSCRIPTS_DIR,
        CLIPS_DIR,
        ASSETS_DIR,
        FONTS_DIR,
        MASKS_DIR,
        MUSIC_DIR,
        STATIC_DIR,
        FFMPEG_DIR,
        MODELS_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    ensure_ffmpeg()


# Create directories eagerly so importing any module is enough to get a working
# tree. Startup also calls ensure_dirs() defensively.
ensure_dirs()

