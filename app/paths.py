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
import shutil
import subprocess
if "HF_HOME" not in os.environ:
    os.environ["HF_HOME"] = str(MODELS_DIR)


def ensure_ffmpeg() -> None:
    """Prefer actual bundled tools; keep system-installed tools discoverable."""
    for directory in (FFMPEG_DIR / "bin", FFMPEG_DIR):
        if any((directory/name).is_file() for name in ("ffmpeg.exe","ffmpeg","ffprobe.exe","ffprobe")):
            entries=os.environ.get("PATH","").split(os.pathsep)
            entries=[entry for entry in entries if os.path.normcase(entry)!=os.path.normcase(str(directory))]
            os.environ["PATH"]=os.pathsep.join([str(directory),*entries])


def get_ffmpeg_location():
    """Reuse a working existing installation, without copying user data."""
    candidates=[FFMPEG_DIR,FFMPEG_DIR/"bin"]
    executable=shutil.which("ffmpeg")
    if executable:
        candidates.append(Path(executable).resolve().parent)
    local=os.environ.get("LOCALAPPDATA")
    if local:
        for name in ("BMG.CLIP-V3","BMG.CLIP-V3-Preview"):
            folder=Path(local)/"Programs"/name/"ffmpeg"
            candidates.extend((folder,folder/"bin"))
    seen=set()
    for folder in candidates:
        if str(folder) in seen:continue
        seen.add(str(folder))
        binaries=[folder/(name+(".exe" if os.name=="nt" else "")) for name in ("ffmpeg","ffprobe")]
        if not all(binary.is_file() for binary in binaries):continue
        try:
            if all(subprocess.run([str(binary),"-version"],capture_output=True,timeout=10).returncode==0 for binary in binaries):
                entries=os.environ.get("PATH","").split(os.pathsep)
                os.environ["PATH"]=os.pathsep.join([str(folder),*entries])
                return str(folder)
        except (OSError,subprocess.TimeoutExpired):continue
    return None


def require_ffmpeg() -> None:
    """Fail before downloading, with a dependency error rather than a bad-URL error."""
    ensure_ffmpeg()
    get_ffmpeg_location()
    for name in ("ffmpeg","ffprobe"):
        executable=shutil.which(name)
        if not executable:
            raise RuntimeError(f"{name} is not available to the app. Run the latest BMG.CLIP-V3 Setup to install or repair FFmpeg, reopen the desktop app, then Retry this job.")
        try:
            result=subprocess.run([executable,"-version"],capture_output=True,timeout=10)
        except (OSError,subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"{name} was found but could not start. Run BMG.CLIP-V3 Setup to repair it, reopen the app, then Retry this job.") from exc
        if result.returncode:
            raise RuntimeError(f"{name} failed its version check. Run BMG.CLIP-V3 Setup to repair it, reopen the app, then Retry this job.")


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

