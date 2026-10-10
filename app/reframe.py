"""Per-clip render recipes, so "Reframe" can re-render ONE clip.

Every clip already goes through ``clipper.generate_clip(source_mp4, start,
end, opts)`` inside the batch pipeline (see ``jobs.py``). To let a user
manually reposition the crop later without re-running the whole
download -> transcribe -> select -> render pipeline for every other clip,
jobs.py saves the exact arguments that produced each clip here, keyed by
``clip_id`` + ``index``. The reframe endpoint (main.py) looks the recipe back
up, swaps in new crop keyframes, and re-renders just that one file in place.

In-memory only (like ``jobs.py``'s job registry) — recipes don't need to
survive a server restart; the clip files on disk already reflect the last
render either way.
"""

from __future__ import annotations

import threading
import json
import os
import uuid
from pathlib import Path
from typing import Optional
from .paths import CLIPS_DIR

_RECIPES: dict[str, dict] = {}
_LOCK = threading.Lock()


def _key(clip_id: str, index: int) -> str:
    return f"{clip_id}:{index}"


def save_recipe(clip_id: str, index: int, *, source_mp4: Path, start: float, end: float, opts_kwargs: dict) -> None:
    """Record what produced ``clips/<clip_id>/<index>.mp4`` for later reframing."""
    with _LOCK:
        _RECIPES[_key(clip_id, index)] = {
            "source_mp4": str(source_mp4),
            "start": start,
            "end": end,
            "opts_kwargs": opts_kwargs,
        }
        if len(clip_id)==32 and all(c in "0123456789abcdef" for c in clip_id) and index>=0:
            folder=CLIPS_DIR/clip_id
            folder.mkdir(parents=True,exist_ok=True)
            target=folder/f"{index}.recipe.json"
            temp=folder/f".{index}.recipe.{uuid.uuid4().hex}.tmp"
            try:
                temp.write_text(json.dumps(_RECIPES[_key(clip_id,index)],default=str),encoding="utf-8")
                os.replace(temp,target)
            finally:
                temp.unlink(missing_ok=True)


def get_recipe(clip_id: str, index: int) -> Optional[dict]:
    with _LOCK:
        recipe = _RECIPES.get(_key(clip_id, index))
        if recipe is None and len(clip_id)==32 and all(c in "0123456789abcdef" for c in clip_id) and index>=0:
            target=CLIPS_DIR/clip_id/f"{index}.recipe.json"
            if target.is_file():
                recipe=json.loads(target.read_text(encoding="utf-8"))
                for key in ("ass_path","caption_recipe","music_path"):
                    if recipe["opts_kwargs"].get(key):
                        recipe["opts_kwargs"][key]=Path(recipe["opts_kwargs"][key])
                _RECIPES[_key(clip_id,index)]=recipe
        return dict(recipe) if recipe else None
