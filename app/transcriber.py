"""Local transcription with faster-whisper (word-level timestamps).

Each request can pick its compute device (``auto``/``cuda``/``cpu``). Models are
heavy (~1.5 GB for 'medium'), so we load one lazily per device and cache it for
reuse. ``auto`` prefers CUDA (float16) and falls back to CPU (int8); an explicit
``cuda`` request fails with a clear message if the GPU cannot be initialised.
No audio or text ever leaves the machine.
"""

from __future__ import annotations

import glob
import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)


def _add_cuda_dll_directories() -> None:
    """Make pip-installed NVIDIA CUDA libraries discoverable on Windows.

    ctranslate2 (faster-whisper's backend) loads cuBLAS/cuDNN lazily at compute
    time. The ``nvidia-*-cu12`` wheels drop those DLLs under
    ``site-packages/nvidia/**/bin``, which Windows does NOT search by default -
    so without this the GPU path fails with "cublas64_12.dll is not found".
    No-op on non-Windows (there the loader uses RPATH/LD_LIBRARY_PATH).
    """
    if os.name != "nt":
        return
    for entry in sys.path:
        nvidia_root = os.path.join(entry, "nvidia")
        if not os.path.isdir(nvidia_root):
            continue
        for bin_dir in glob.glob(os.path.join(nvidia_root, "*", "bin")):
            # add_dll_directory helps DLLs loaded with the user-dirs flag, but
            # ctranslate2's native dependency load uses the standard search
            # order - which consults PATH, not these added dirs. So do BOTH.
            try:
                os.add_dll_directory(bin_dir)
            except OSError:
                pass
            if bin_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


# Must run before faster_whisper/ctranslate2 try to load the CUDA DLLs.
_add_cuda_dll_directories()

# Native math runtimes can create a worker pool per library. Bound their default
# thread counts before faster-whisper/ctranslate2 imports them on low-end PCs.
for _thread_var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    _limit = min(4, os.cpu_count() or 4)
    try:
        _configured = int(os.environ.get(_thread_var, str(_limit)))
    except ValueError:
        _configured = _limit
    os.environ[_thread_var] = str(max(1, min(_configured, _limit)))

from faster_whisper import WhisperModel  # noqa: E402

from .models import TranscriptionError  # noqa: E402
from .paths import TRANSCRIPTS_DIR  # noqa: E402

# Fallback when hardware can't be probed at all. Per-device auto-selection
# (see _pick_model_size) normally overrides this — kept only as a last resort.
MODEL_SIZE = "medium"

# Per-device compute precision. float16 on the GPU, int8 on the CPU.
_COMPUTE_TYPE = {"cuda": "float16", "cpu": "int8"}

# One cached model per device ('cuda' / 'cpu') so switching devices between
# requests is cheap after the first load. `_device` records the most recently
# used device (drives the /health badge); `_cuda_available` is a cached probe.
_models: dict[str, WhisperModel] = {}
_task_device = threading.local()
_model_sizes: dict[str, str] = {}  # device -> whisper model size actually loaded
_device: str = "uninitialised"
_cuda_available: Optional[bool] = None

# Cached human-readable GPU name (e.g. "NVIDIA GeForce RTX 5060 Ti"). `_probed`
# guards the one-time lookup so a missing/None name isn't re-queried every call.
_gpu_name: Optional[str] = None
_gpu_name_probed: bool = False

# Serialises model loads so two requests warming the same device don't double-load.
_load_lock = threading.Lock()
# Serialises actual transcription passes — one GPU pass at a time. Concurrent passes
# on the single model thrash each other and look "stuck at 0%"; this queues them.
_transcribe_lock = threading.Lock()


def cuda_available() -> bool:
    """Best-effort, cached check for a usable CUDA GPU.

    Uses ctranslate2's device count (faster-whisper's backend) so the UI can
    offer/hide the GPU option without paying the cost of a full model load.
    """
    global _cuda_available
    if _cuda_available is None:
        try:
            from ctranslate2 import get_cuda_device_count

            _cuda_available = get_cuda_device_count() > 0
        except Exception:  # noqa: BLE001 - any failure means "no usable GPU"
            _cuda_available = False
    return _cuda_available


def available_devices() -> list[str]:
    """Devices the UI may offer, best (GPU) first."""
    return (["cuda", "cpu"] if cuda_available() else ["cpu"])


def gpu_name() -> Optional[str]:
    """Best-effort, cached human-readable name of the active CUDA GPU.

    Returns the marketing name (e.g. "NVIDIA GeForce RTX 5060 Ti") so the UI can
    auto-detect and show the real device instead of a generic "GPU" label, or
    ``None`` when there's no usable GPU / the name can't be read. Uses
    ``nvidia-smi`` (shipped with every NVIDIA driver) rather than pulling in a
    heavy dep like torch just to read a string. Probed once, then cached.
    """
    global _gpu_name, _gpu_name_probed
    if _gpu_name_probed:
        return _gpu_name
    _gpu_name_probed = True
    if not cuda_available():
        return None
    try:
        import subprocess

        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
            # Avoid a flashing console window on Windows (no-op elsewhere).
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if out.returncode == 0:
            lines = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
            if lines:
                _gpu_name = lines[0]
    except Exception as exc:  # noqa: BLE001 - any failure -> unnamed GPU
        logger.debug("Could not read GPU name via nvidia-smi: %s", exc)
    return _gpu_name


def _gpu_vram_gb() -> Optional[float]:
    """Best-effort currently free VRAM of the active CUDA GPU, in GB."""
    if not cuda_available():
        return None
    try:
        import subprocess

        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if out.returncode == 0:
            lines = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
            if lines:
                return float(lines[0]) / 1024.0  # MiB -> GiB
    except Exception as exc:  # noqa: BLE001 - any failure -> unknown VRAM
        logger.debug("Could not read GPU VRAM via nvidia-smi: %s", exc)
    return None


def _system_ram_gb() -> Optional[float]:
    """Best-effort total system RAM, in GB. None if unknown.

    No new dependency (e.g. psutil) needed: ``GlobalMemoryStatusEx`` on
    Windows, ``sysconf`` on POSIX (Linux and macOS both support it) covers
    every platform this app packages for.
    """
    try:
        if os.name == "nt":
            import ctypes

            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = _MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return stat.ullTotalPhys / (1024**3)
        return (os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")) / (1024**3)
    except Exception as exc:  # noqa: BLE001 - any failure -> unknown RAM
        logger.debug("Could not read system RAM: %s", exc)
        return None


def _available_ram_gb() -> Optional[float]:
    """Physical RAM free now; total installed RAM alone can over-pick the model."""
    try:
        if os.name == "nt":
            import ctypes

            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = _MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return None
            return stat.ullAvailPhys / (1024**3)
        return (os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")) / (1024**3)
    except Exception as exc:  # noqa: BLE001 - missing system probe is nonfatal
        logger.debug("Could not read free RAM: %s", exc)
        return None


# (min GB, model size) tiers, checked best-first. A modest GPU/CPU shouldn't
# get stuck trying to load 'medium' (slow, or may not fit in VRAM) — and CPU
# never defaults to 'medium' at all (impractically slow) unless told to.
_GPU_TIERS: list[tuple[float, str]] = [(10.0, "large-v3"), (6.0, "medium"), (3.0, "small"), (0.0, "base")]
_CPU_TIERS: list[tuple[float, str]] = [(16.0, "small"), (0.0, "base")]


def _pick_model_size(device: str) -> str:
    """Auto-select a whisper model size that actually fits this machine.

    Cached per device in ``_model_sizes`` once loaded (see ``_load_on``), so
    this probe runs at most once per device per process.
    """
    if device == "cuda":
        avail, tiers, unknown_default = _gpu_vram_gb(), _GPU_TIERS, "small"
    else:
        free = _available_ram_gb()
        if free is not None and free < 2.0:
            return "tiny"
        if free is not None and free < 4.0:
            return "base"
        avail, tiers, unknown_default = _system_ram_gb(), _CPU_TIERS, "small"
    if avail is None:
        return unknown_default
    for threshold, size in tiers:
        if avail >= threshold:
            return size
    return tiers[-1][1]


def _is_memory_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return isinstance(exc, MemoryError) or any(marker in message for marker in (
        "mkl_malloc", "bad_alloc", "out of memory", "not enough memory",
        "cannot allocate memory", "failed to allocate memory", "memory allocation failed",
    ))



def get_model_size(device: Optional[str] = None) -> str:
    """The whisper model size loaded (or that WOULD be picked) for a device.

    With no argument, returns the size for the most-recently-used device
    (falls back to a fresh auto-pick for 'cuda' if nothing has loaded yet) —
    used by the startup log and the /api/devices response.
    """
    dev = device or (_device if _device != "uninitialised" else ("cuda" if cuda_available() else "cpu"))
    return _model_sizes.get(dev) or _pick_model_size(dev)


def is_loaded(device: str) -> bool:
    """True if a model for this concrete device is already cached (warm)."""
    return device in _models


# ---------------------------------------------------------------------------
# First-run download progress — the server used to block on load_model() at
# startup, so the browser hit a refused connection (not a "loading" page)
# while a multi-GB model downloaded, which is the "stuck / looks broken"
# complaint. main.py now loads the model on a background thread instead and
# polls this status via /api/model-status; this section just tracks it.
# ---------------------------------------------------------------------------
_status_lock = threading.Lock()
_load_status: dict = {"status": "idle", "message": "", "progress": None, "model_size": None, "device": None}

# Rough ctranslate2-quantized model sizes in bytes — only used to turn a
# growing partial-download file into an approximate percentage, so these
# don't need to be exact.
_MODEL_BYTES_EST = {
    "tiny": 75_000_000, "base": 145_000_000, "small": 484_000_000,
    "medium": 1_500_000_000, "large-v3": 3_100_000_000,
}


def _set_status(**kwargs) -> None:
    with _status_lock:
        _load_status.update(kwargs)


def model_status() -> dict:
    """Snapshot of the background model load — polled by /api/model-status."""
    with _status_lock:
        return dict(_load_status)


def _poll_download_progress(size: str, stop_event: threading.Event) -> None:
    """Watch HuggingFace's partial-download file(s) and update progress.

    huggingface_hub downloads to a `*.incomplete` file under the cache's
    blobs/ dir, growing it to the final size before atomically renaming it —
    so its current size vs. the known approximate model size is a good stand-in
    for a real percentage, without needing to hook into their download internals.

    Resolves the cache dir via huggingface_hub's own ``HF_HUB_CACHE`` constant
    (accounts for HF_HOME / HUGGINGFACE_HUB_CACHE / the default ``~/.cache/
    huggingface/hub`` all at once) rather than reading ``HF_HOME`` directly —
    that env var isn't always set (e.g. a plain dev-server launch), and this
    poller would otherwise silently do nothing and leave progress frozen at 0%.
    """
    total = _MODEL_BYTES_EST.get(size)
    if not total:
        return
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
    except ImportError:
        return
    pattern = os.path.join(HF_HUB_CACHE, f"models--Systran--faster-whisper-{size}", "blobs", "*.incomplete")
    while not stop_event.is_set():
        try:
            got = sum(os.path.getsize(p) for p in glob.glob(pattern))
            if got > 0:
                frac = max(0.0, min(0.99, got / total))
                _set_status(
                    status="downloading", progress=frac,
                    message=f"Downloading the '{size}' AI model (first time only)... {int(frac * 100)}%",
                )
        except OSError:
            pass
        stop_event.wait(1.0)


def reset_model_status() -> None:
    """Reset model status so a failed load can be re-attempted."""
    with _status_lock:
        _load_status.update({
            "status": "idle",
            "message": "Retrying AI model load...",
            "progress": 0.0,
        })


def retry_load_background(device: str = "auto") -> None:
    """Trigger background reload of whisper model, clearing any previous error state."""
    reset_model_status()

    def _worker():
        try:
            load_model(device)
        except Exception:
            logger.exception("Model retry failed.")

    threading.Thread(target=_worker, daemon=True).start()


def _load_on(device: str) -> WhisperModel:
    """Load (or reuse the cached) model on a concrete device ('cuda'/'cpu')."""
    global _device
    with _load_lock:
        if device in _models:
            _device = device
            return _models[device]
        compute = _COMPUTE_TYPE[device]
        size = _pick_model_size(device)
        size_order = ["large-v3", "medium", "small", "base", "tiny"]
        sizes = size_order[size_order.index(size):]
        for candidate in sizes:
            _model_sizes[device] = candidate
            _set_status(status="downloading", message=f"Preparing the '{candidate}' AI model...",
                        progress=0.0, model_size=candidate, device=device)
            logger.info("Loading whisper '%s' on %s (%s)...", candidate, device, compute)

            stop_event = threading.Event()
            poller = threading.Thread(target=_poll_download_progress,
                                      args=(candidate, stop_event), daemon=True)
            poller.start()
            try:
                threads = min(4, os.cpu_count() or 4)
                if device == "cpu" and (_available_ram_gb() or float("inf")) < 4.0:
                    threads = min(2, threads)
                model = WhisperModel(candidate, device=device, compute_type=compute,
                                     cpu_threads=threads, num_workers=1)
                break
            except Exception as exc:
                if not _is_memory_error(exc) or candidate == sizes[-1]:
                    raise
                logger.warning("Model '%s' ran out of memory on %s; trying a smaller model.", candidate, device)
            finally:
                stop_event.set()

        _models[device] = model
        _device = device
        _set_status(status="ready", message="Ready", progress=1.0, model_size=candidate, device=device)
        logger.info("Whisper '%s' loaded on %s.", candidate, device)
        return model



def load_model(device: str = "auto") -> WhisperModel:
    """Load the whisper model for the requested device, caching per device.

    Args:
        device: 'auto' (GPU if available, else CPU), 'cuda', or 'cpu'.

    'auto' tries the GPU first and falls back to the CPU. An explicit 'cuda'
    request does NOT silently fall back - it raises a clear error so the user
    knows the GPU is unusable and can pick CPU. Safe to call repeatedly.
    """
    requested = (device or "auto").lower()
    if requested == "gpu":
        requested = "cuda"

    if requested == "cuda":
        try:
            return _load_on("cuda")
        except Exception as exc:  # noqa: BLE001 - GPU absent or cuDNN mismatched
            logger.warning("CUDA load failed (%s).", exc)
            _set_status(status="error", message=str(exc))
            raise TranscriptionError(
                "Could not run on the GPU (CUDA). Check CUDA 12 + matching cuDNN, "
                f"or choose CPU instead. Details: {exc}"
            ) from exc

    if requested == "cpu":
        try:
            return _load_on("cpu")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load whisper on CPU.")
            _set_status(status="error", message=str(exc))
            raise TranscriptionError(
                f"Could not load the whisper model on CPU: {exc}"
            ) from exc

    # 'auto' (or anything unrecognised): prefer GPU, fall back to CPU.
    if cuda_available():
        try:
            return _load_on("cuda")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "CUDA load failed (%s). Falling back to CPU (int8). "
                "If you expected GPU, check CUDA 12 + matching cuDNN.",
                exc,
            )
    try:
        return _load_on("cpu")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to load whisper on CPU as well.")
        _set_status(status="error", message=str(exc))
        raise TranscriptionError(
            f"Could not load the whisper model on GPU or CPU: {exc}"
        ) from exc


def get_device() -> str:
    """Return the device of the most-recent model ('cuda', 'cpu', or 'uninitialised')."""
    return getattr(_task_device,"value",_device)


def _normalize_language(language: Optional[str]) -> Optional[str]:
    """Map UI language values to a Whisper code, or None for auto-detect.

    Empty string / 'auto' (case-insensitive) -> None, which tells Whisper to
    detect the spoken language itself. 'hinglish' is not a Whisper language —
    it's Hindustani transcribed as Hindi and then romanised after the fact (see
    ``transcribe_video``), so here it maps to the Hindi model code.
    """
    if not language:
        return None
    lang = language.strip().lower()
    if lang in ("", "auto"):
        return None
    if lang == "hinglish":
        return "hi"
    return lang


def transcribe_video(
    video_path: Path,
    clip_id: str,
    progress: Optional[Callable[[float, str], None]] = None,
    device: str = "auto",
    language: Optional[str] = None,
    cancelled: Optional[Callable[[], bool]] = None,
) -> dict:
    """Transcribe `video_path`, returning a dict with word-level timestamps.

    Returns a dict shaped like:
        {
          "language": "en",
          "duration": 123.4,
          "text": "full transcript ...",
          "words": [{"word": "Hello", "start": 0.0, "end": 0.4}, ...],
          "segments": [{"id": 0, "start": 0.0, "end": 3.2, "text": "..."}, ...],
        }

    The result is also saved to transcripts/<clip_id>.json.

    Raises:
        TranscriptionError: on any failure.
    """
    model = load_model(device)

    # One transcription at a time. If another is running, surface a clear "waiting"
    # message so the UI shows a queued state instead of a frozen 0%.
    if progress and _transcribe_lock.locked():
        progress(0.0, "Waiting for an earlier transcription to finish…")
    while not _transcribe_lock.acquire(timeout=.2):
        if cancelled and cancelled():
            raise TranscriptionError("Transcription cancelled while waiting.")
    try:
        if cancelled and cancelled():
            raise TranscriptionError("Transcription cancelled.")
        def _run_pass(active_model: WhisperModel) -> dict:
            _task_device.value=next((name for name,loaded in list(_models.items()) if loaded is active_model),device)
            segments_gen, info = active_model.transcribe(
                str(video_path),
                word_timestamps=True,
                vad_filter=True,  # trims long silences -> better segment boundaries
                beam_size=1,
                best_of=1,
                language=_normalize_language(language),  # None -> auto-detect
            )
            segments: list[dict] = []
            words: list[dict] = []
            text_parts: list[str] = []
            total_dur = float(info.duration) or 0.0
            if progress:
                progress(None, "Transcribing audio with local Whisper...")

            for seg in segments_gen:
                if cancelled and cancelled():
                    raise TranscriptionError("Transcription cancelled at an audio segment boundary.")
                seg_text = (seg.text or "").strip()
                if progress and total_dur > 0:
                    frac = min(0.99, float(seg.end) / total_dur)
                    progress(frac, f"Transcribing... {int(frac * 100)}%")
                segments.append(
                    {
                        "id": seg.id,
                        "start": float(seg.start),
                        "end": float(seg.end),
                        "text": seg_text,
                    }
                )
                text_parts.append(seg_text)

                for w in (seg.words or []):
                    token = (w.word or "").strip()
                    if not token:
                        continue
                    words.append(
                        {
                            "word": token,
                            "start": float(w.start),
                            "end": float(w.end),
                        }
                    )

            return {
                "device": _task_device.value,
                "language": info.language,
                "duration": total_dur,
                "text": " ".join(text_parts).strip(),
                "words": words,
                "segments": segments,
            }

        try:
            result = _run_pass(model)
        except Exception as exc:
            # If GPU transcription failed (either at init or mid-stream), fall back to CPU
            is_gpu = any(name=="cuda" and loaded is model for name,loaded in _models.items())
            if is_gpu and device != "cpu":
                logger.warning("GPU transcription failed (%s). Retrying on CPU...", exc)
                if progress:
                    progress(0.02, "Switching to CPU transcription...")
                cpu_model = load_model("cpu")
                result = _run_pass(cpu_model)
            else:
                raise exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Transcription failed for %s", video_path)
        raise TranscriptionError(f"Transcription failed: {exc}") from exc
    finally:
        _transcribe_lock.release()

    # Hinglish: the audio was transcribed as Hindi (Devanagari); romanise the
    # whole transcript to readable Roman Urdu/Hindi before caching/persisting.
    if (language or "").strip().lower() == "hinglish":
        from . import translit

        result = translit.romanize_transcript(result)

    # Persist the transcript for debugging / reuse.
    transcript_path = TRANSCRIPTS_DIR / f"{clip_id}.json"
    try:
        transcript_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        logger.warning("Could not write transcript json: %s", exc)

    return result
