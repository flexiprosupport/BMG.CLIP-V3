"""Background job model + in-memory registry for the clip pipeline.

The full pipeline (download -> transcribe -> select -> render) can take minutes,
so running it inside the HTTP request would make the browser appear frozen. Each
request instead creates a :class:`Job`, runs the pipeline on a daemon thread, and
reports fine-grained progress that the frontend streams live (see the SSE
endpoint in ``main.py``).

Everything is in-memory and single-process - perfect for this local, single-user
tool. Restarting the server clears jobs (the rendered clips on disk survive).
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from typing import Dict, List, Optional

from . import captions, canvas_captions, downloader, history, music, pretranscribe, reframe, selector, transcriber, uploads, job_store, resources, queued_download, source_security
from .clipper import ClipOptions, generate_clip, target_size
from .downloader import DownloadCancelled
from .models import (
    LANGUAGE_NAMES,
    ClipGenerationError,
    GenerateRequest,
    InvalidVideoURLError,
    TranscriptionError,
)
from .paths import CLIPS_DIR

logger = logging.getLogger("ai_video_clipper.jobs")


# Overall-progress span (0..1) owned by each stage. The per-stage fraction is
# mapped into these bands so the single top progress bar advances smoothly across
# the whole pipeline rather than jumping per stage.
_STAGE_SPANS = {
    "queued": (0.0, 0.0),
    "downloading": (0.02, 0.25),
    "transcribing": (0.25, 0.70),
    "selecting": (0.70, 0.74),
    "rendering": (0.74, 0.99),
    "done": (1.0, 1.0),
    "error": (0.0, 0.0),
}

# Human labels for the stepper in the UI.
STAGE_LABELS = {
    "downloading": "Download",
    "transcribing": "Transcribe",
    "selecting": "Analyze",
    "rendering": "Render",
}

# Characters not allowed in filenames on Windows (and best avoided elsewhere).
_BAD_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def download_filename(title: str, language: Optional[str], index: int) -> str:
    """Suggested download name for a clip, written in the caption's language.

    Prefixes the language's native name (e.g. "اردو", "हिन्दी", "English") so the
    file is clearly named in the language its captions are in, then the clip
    title (already in that language, since it's drawn from the transcript). Falls
    back to a numbered name when the title is empty. Always ends in ``.mp4``.
    """
    lang = (language or "").strip().lower()
    native = LANGUAGE_NAMES.get(lang, lang.upper() if lang else "Clip")
    clean_title = _BAD_FILENAME_CHARS.sub(" ", (title or "").strip()).strip()
    clean_title = re.sub(r"\s+", " ", clean_title)
    if clean_title:
        name = f"{native} - {clean_title}"
    else:
        name = f"{native} - clip {index + 1}"
    return name[:120].strip() + ".mp4"


class Job:
    """A single pipeline run with thread-safe progress + result state."""

    def __init__(self, req: GenerateRequest) -> None:
        self.id = uuid.uuid4().hex
        self.req = req
        self.status = "queued"  # queued | running | done | error
        self.stage = "queued"
        self.stage_progress = 0.0  # 0..1 within the current stage
        self.progress = 0.0  # 0..1 overall (derived from stage span)
        self.message = "Queued..."
        self.clips: List[dict] = []
        self.error: Optional[str] = None
        self.clip_id: Optional[str] = None
        self.cancelled = False
        self._lock = threading.RLock()
        self._rev = 0  # bumped on every change so the SSE stream only sends diffs
        self.created_at = time.time()
        self.started_at = None
        self.finished_at = None
        self.stage_started_at = self.created_at
        self.batch_id = None
        self.attempts = 0
        self.source_title = req.upload_name or req.video_url or "Video"
        self.duration = None
        self.device = "Pending"
        self.metadata = {}
        self.stage_progress = None
        self.progress = None

    def persist(self):
        job_store.save(self)

    def update(self, **values):
        with self._lock:
            if all(getattr(self,key,None)==value for key,value in values.items()):
                return
            for key,value in values.items():
                setattr(self,key,value)
            self._rev += 1
            self.persist()

    def cancel(self) -> None:
        """Flag the run for cancellation; the pipeline stops at the next checkpoint."""
        with self._lock:
            if self.status in ("done", "error", "cancelled"):
                return
            self.cancelled = True
            self.status = "cancelling" if self.id in _RUNNING else "cancelled"
            self.message = "Cancellation requested; stopping owned work…" if self.status=="cancelling" else "Cancelled."
            self._rev += 1
            self.persist()

    # -- mutation ---------------------------------------------------------- #
    def set_stage(self, stage: str, frac: float, message: str) -> None:
        """Move to/within a stage and recompute the overall progress band."""
        frac = min(1.0, max(0.0, frac)) if frac is not None else None
        with self._lock:
            if self.cancelled:
                return
            self.status = "queued" if stage=="queued" else "running"
            if stage != self.stage:
                self.stage_started_at = time.time()
            self.stage = stage
            self.stage_progress = frac
            self.progress = frac
            self.message = message
            self._rev += 1
            self.persist()

    def add_clip(self, clip: dict) -> None:
        """Publish a finished clip so the UI can show it before the run ends."""
        with self._lock:
            if self.cancelled:
                return
            self.clips = [c for c in self.clips if c["index"] != clip["index"]] + [clip]
            self._rev += 1
            self.persist()

    def finish(self, clips: List[dict]) -> None:
        with self._lock:
            if self.cancelled:
                return
            self.status = "done"
            self.stage = "done"
            self.stage_progress = 1.0
            self.progress = 1.0
            self.message = f"Done - {len(clips)} clip(s) ready."
            self.clips = clips
            self._rev += 1
            self.finished_at = time.time()
            self.persist()

    def fail(self, message: str) -> None:
        with self._lock:
            if self.cancelled:
                return
            self.status = "error"
            self.stage = "error"
            self.error = message
            self.message = message
            self._rev += 1
            self.finished_at = time.time()
            self.persist()

    # -- read -------------------------------------------------------------- #
    def snapshot(self) -> dict:
        """Return a JSON-serialisable view of the current state."""
        with self._lock:
            return {
                "id": self.id,
                "status": self.status,
                "stage": self.stage,
                "stage_progress": round(self.stage_progress, 4) if self.stage_progress is not None else None,
                "progress": round(self.progress, 4) if self.progress is not None else None,
                "message": self.message,
                "clips": list(self.clips),
                "error": self.error,
                "clip_id": self.clip_id,
                "rev": self._rev,
                "created_at": self.created_at, "started_at": self.started_at,
                "finished_at": self.finished_at, "stage_started_at": self.stage_started_at,
                "batch_id": self.batch_id, "attempts": self.attempts,
                "source_title": self.source_title, "source": self.req.upload_name if self.req.upload_id else self.req.video_url,
                "source_type": "upload" if self.req.upload_id else "url",
                "duration": self.duration, "device": self.device,
                "requested_clips": self.req.num_clips,
                "planned_clips": len(self.metadata.get("windows") or []) or None,
                "generated_clips": len(self.clips), "metadata": dict(self.metadata),
                "settings": self.req.model_dump(mode="json"),
                "elapsed": round(max(0,(self.finished_at or time.time())-(self.started_at or self.created_at))),
                "eta": round((time.time()-self.stage_started_at)*(1-self.stage_progress)/self.stage_progress)
                    if self.status=="running" and self.stage_progress is not None and .05<self.stage_progress<1 else None,
            }


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
_JOBS: Dict[str, Job] = {}
_JOBS_LOCK = threading.RLock()
_RUNNING = set()
_STOP = threading.Event()
_INITIALIZED = False
_SCHEDULER = None
_THREADS = {}

def initialize():
    global _INITIALIZED
    with _JOBS_LOCK:
        if _INITIALIZED:
            return
        job_store.initialize()
        resources.configure(job_store.preferences())
        for id_,req,snapshot in job_store.load():
            job = Job(GenerateRequest.model_validate(req))
            job.id = id_
            for key in ("status","stage","stage_progress","progress","message","clips","error","clip_id",
                        "created_at","started_at","finished_at","stage_started_at","batch_id","attempts",
                        "source_title","duration","device","metadata"):
                if key in snapshot:
                    setattr(job,key,snapshot[key])
            if job.status=="cancelling":
                job.status="cancelled";job.cancelled=True
            elif job.status in ("running","queued"):
                job.status="queued";job.stage="queued";job.message="Recovered after restart; safely retrying incomplete stages."
                job.stage_progress=None;job.progress=None
            job._rev=snapshot.get("rev",0)+1
            _JOBS[id_]=job
            job.persist()
            if job.clips and job.clip_id:
                history.add_entry(job.clip_id,job.req.upload_name or job.req.video_url or "Video",
                                  job.req.model_dump(mode="json"),job.clips,
                                  "upload" if job.req.upload_id else "url")
        _INITIALIZED=True

def list_jobs():
    initialize()
    with _JOBS_LOCK:
        return sorted([j.snapshot() for j in _JOBS.values()],key=lambda j:j["created_at"],reverse=True)

def create_batch(requests,title="Video batch"):
    initialize()
    unique=[];seen=set()
    for req in requests:
        key=req.upload_id or source_security.identity(req.video_url)
        if key not in seen:
            seen.add(key);unique.append(req)
    with _JOBS_LOCK:
        submitted={req.submission_id for req in unique if req.submission_id}
        prior=[j for j in _JOBS.values() if j.req.submission_id in submitted]
        if submitted and prior:
            wanted={req.submission_id:req for req in unique}
            if len(prior)!=len(unique) or any(j.req!=wanted[j.req.submission_id] for j in prior):
                raise InvalidVideoURLError("This batch submission is already registered with different settings.")
            return prior[0].batch_id,prior
        if sum(j.status not in ("done","error","cancelled") for j in _JOBS.values())+len(unique)>100:
            raise InvalidVideoURLError("Queue limit is 100 unfinished videos. Wait or cancel queued work first.")
        batch_id=uuid.uuid4().hex
        jobs_=[]
        for req in unique:
            job=Job(req);job.batch_id=batch_id;jobs_.append(job)
        job_store.save_batch_jobs(batch_id,time.time(),title[:120],jobs_)
        for job in jobs_:
            _JOBS[job.id]=job
    start_scheduler()
    return batch_id,jobs_

def retry_job(job_id):
    job=get_job(job_id)
    if job is None: raise InvalidVideoURLError("Unknown job.")
    with _JOBS_LOCK,job._lock:
        if job.status not in ("error","cancelled") or job.id in _RUNNING:
            raise InvalidVideoURLError("Only stopped failed/cancelled jobs can be retried.")
        if job.attempts>=resources.LIMITS["retry_limit"]+1:
            raise InvalidVideoURLError("Retry limit reached. Increase the retry limit in Queue Settings.")
        job.cancelled=False
        job.update(status="queued",stage="queued",progress=None,stage_progress=None,error=None,
                   finished_at=None,message="Queued for retry; completed exports are kept.")
    start_scheduler()
    return job

def remove_job(job_id):
    with _JOBS_LOCK:
        job=get_job(job_id)
        if not job or job.status not in ("done","error","cancelled") or job.id in _RUNNING:
            raise InvalidVideoURLError("Only stopped jobs may be removed from history.")
        job_store.hide(job_id);del _JOBS[job_id]

def _worker(job):
    try:
        job.update(started_at=time.time(),attempts=job.attempts+1,finished_at=None)
        _run_pipeline(job)
    finally:
        if job.cancelled and getattr(job,"_interrupted",False):
            job.update(status="queued",stage="queued",finished_at=None,message="Server stopped; will resume on restart.")
        elif job.cancelled:
            job.update(status="cancelled",stage="cancelled",finished_at=time.time(),message="Cancelled. Finished Library clips were kept.")
        with _JOBS_LOCK:
            _RUNNING.discard(job.id)
            _THREADS.pop(job.id,None)

def _schedule():
    while not _STOP.wait(.2):
        with _JOBS_LOCK:
            capacity=resources.LIMITS["max_downloads"]+resources.LIMITS["max_parallel_jobs"]
            for job in sorted(_JOBS.values(),key=lambda j:j.created_at):
                if len(_RUNNING)>=capacity: break
                if job.status=="queued" and not job.cancelled and job.id not in _RUNNING:
                    _RUNNING.add(job.id)
                    thread=threading.Thread(target=_worker,args=(job,),daemon=True)
                    _THREADS[job.id]=thread;thread.start()

def start_scheduler():
    global _SCHEDULER
    initialize()
    with _JOBS_LOCK:
        if not _SCHEDULER or not _SCHEDULER.is_alive():
            _STOP.clear()
            _SCHEDULER=threading.Thread(target=_schedule,daemon=True);_SCHEDULER.start()

def shutdown():
    _STOP.set()
    for job_id in list(_RUNNING):
        job=get_job(job_id)
        if job:
            if not job.cancelled: job._interrupted=True
            job.cancelled=True
    deadline=time.monotonic()+8
    for thread in list(_THREADS.values()):
        thread.join(timeout=max(0,deadline-time.monotonic()))


def create_job(req: GenerateRequest) -> Job:
    initialize()
    if req.video_url:
        source_security.validate_source(req.video_url)
    job = Job(req)
    with _JOBS_LOCK:
        if req.submission_id:
            existing=next((j for j in _JOBS.values() if j.req.submission_id==req.submission_id),None)
            if existing:
                if existing.req != req:
                    raise InvalidVideoURLError("This submission is already queued with different settings.")
                return existing
        if sum(j.status not in ("done","error","cancelled") for j in _JOBS.values())>=100:
            raise InvalidVideoURLError("Queue is full (100 unfinished jobs).")
        _JOBS[job.id] = job
        job.persist()
    return job


def get_job(job_id: str) -> Optional[Job]:
    initialize()
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def start_job(job: Job) -> None:
    """Run the pipeline for `job` on a background daemon thread."""
    start_scheduler()


# --------------------------------------------------------------------------- #
# Pipeline runner
# --------------------------------------------------------------------------- #
def _run_pipeline(job: Job) -> None:
    """download -> transcribe -> select -> render, updating `job` throughout."""
    req = job.req
    heavy_slot = None
    logger.info("[%s] starting pipeline: %s", job.id, req.model_dump())

    try:
        if job.cancelled:
            return
        # 1) Get the source video. Order of preference:
        #    a) a file already fetched in the background (prefetch) — instant reuse,
        #    b) a previously uploaded file,
        #    c) a fresh URL download.
        source_mp4 = None
        saved_source = job.metadata.get("source_path")
        if saved_source:
            from pathlib import Path
            source_mp4=Path(saved_source)
            if not source_mp4.is_file(): source_mp4=None

        if source_mp4 is None and req.download_id:
            try:
                source_mp4 = uploads.resolve_upload(req.download_id)
                job.set_stage("downloading", 1.0, "Video already downloaded. Preparing...")
            except InvalidVideoURLError:
                # Prefetched file vanished — fall back to a normal download below.
                logger.warning(
                    "[%s] prefetched file %s missing; re-downloading.",
                    job.id,
                    req.download_id,
                )

        if source_mp4 is None and req.upload_id:
            job.set_stage("downloading", 0.2, "Loading uploaded video...")
            source_mp4 = uploads.resolve_upload(req.upload_id)
            job.set_stage("downloading", 1.0, "Uploaded video ready. Preparing...")

        if source_mp4 is None:
            job.set_stage("downloading", 0.0, "Starting download...")

            def on_download(d: dict) -> None:
                status = d.get("status")
                if status == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate")
                    done = d.get("downloaded_bytes") or 0
                    if total:
                        pct = int(done * 100 / total)
                        job.set_stage("downloading", done / total, f"Downloading video... {pct}%")
                    else:
                        mb = done / 1_048_576
                        job.set_stage("downloading", None, f"Downloading video... {mb:.1f} MB")
                elif status == "finished":
                    job.set_stage("downloading", 1.0, "Download complete. Preparing...")

                if d.get("title") or d.get("duration"):
                    job.update(source_title=d.get("title") or job.source_title,duration=d.get("duration") or job.duration)
            with resources.slot("download",lambda:job.cancelled,
                                lambda:job.set_stage("queued",None,"Waiting for a download worker…")):
                source_mp4 = queued_download.download(req.video_url,on_download,lambda:job.cancelled)
        job.update(metadata={**job.metadata,"source_path":str(source_mp4)})
        sidecar=source_mp4.with_suffix(".metadata.json")
        if sidecar.is_file():
            import json
            try:
                details=json.loads(sidecar.read_text(encoding="utf-8"))
                job.update(source_title=str(details.get("title") or job.source_title)[:300])
            except (ValueError,OSError): pass

        if job.cancelled:
            return

        # 2) Transcribe locally (word timestamps) on the requested device. The
        # transcript is keyed by the source file id (its stem), so a transcript
        # prepared in the background (pre-transcription, while the user was still
        # adjusting settings) is reused here and this stage finishes instantly.
        heavy_slot=resources.slot("process",lambda:job.cancelled,
                                 lambda:job.set_stage("queued",None,"Video ready; waiting for processing resources/RAM…"))
        heavy_slot.__enter__()
        clip_id = job.clip_id or uuid.uuid4().hex
        job.update(clip_id=clip_id)
        import json, subprocess
        job.set_stage("analyzing",None,"Checking video and audio streams…")
        probe=subprocess.run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(source_mp4)],
                             capture_output=True,text=True,timeout=15)
        if probe.returncode:
            raise ClipGenerationError("This file could not be read as a video. Try a valid MP4 or another source.")
        info=json.loads(probe.stdout)
        streams=info.get("streams") or []
        if not any(s.get("codec_type")=="video" for s in streams):
            raise ClipGenerationError("This file has no video stream.")
        if not any(s.get("codec_type")=="audio" for s in streams):
            raise TranscriptionError("This video has no audio. Choose a video with speech to generate captions.")
        duration=float(info.get("format",{}).get("duration") or 0)
        if duration>21600:
            raise ClipGenerationError("Videos longer than six hours are not supported.")
        job.update(duration=duration or job.duration)
        preview=CLIPS_DIR/clip_id/"thumbnail.jpg"
        preview.parent.mkdir(parents=True,exist_ok=True)
        if not preview.exists():
            with resources.slot("render",lambda:job.cancelled):
                subprocess.run(["ffmpeg","-v","error","-i",str(source_mp4),"-frames:v","1",
                                "-vf","scale=320:-2","-y",str(preview)],capture_output=True,timeout=15)
        source_id = source_mp4.stem
        device_label = {"auto": "Auto", "cuda": "GPU", "cpu": "CPU"}.get(
            req.device.value, "Auto"
        )
        def on_transcribe(frac: float, msg: str) -> None:
            job.update(device=transcriber.get_device().upper())
            job.set_stage("transcribing", frac, msg)

        if pretranscribe.cached(source_id, req.language) is not None:
            job.set_stage(
                "transcribing", 1.0, "Using transcript prepared while you set things up..."
            )
        else:
            # A background pre-transcription (started on Step 2) may already be
            # running and holding the shared Whisper lock. Rather than freeze the
            # bar while we block on that lock, mirror the background job's live
            # progress here so the user sees real movement; once it finishes,
            # get_or_transcribe returns its cached result instantly.
            running = pretranscribe.find_running(source_id)
            if running is not None:
                while True:
                    if job.cancelled:
                        return
                    snap = running.snapshot()
                    if snap.get("status") != "running":
                        break
                    job.set_stage(
                        "transcribing", snap.get("progress", 0.0),
                        f"Transcribing audio with local Whisper ({device_label})... "
                        f"{int((snap.get('progress') or 0) * 100)}%",
                    )
                    time.sleep(0.4)
            else:
                job.set_stage(
                    "transcribing", 0.0,
                    f"Transcribing audio with local Whisper ({device_label})...",
                )

        if job.cancelled:
            return
        transcript = pretranscribe.get_or_transcribe(
            source_mp4, source_id, req.device.value,
            progress=on_transcribe, language=req.language, cancelled=lambda:job.cancelled,
        )
        if job.cancelled:
            return
        job.update(duration=transcript.get("duration") or job.duration,device=(transcript.get("device") or transcriber.get_device()).upper())
        # The language the captions are actually in: what the user forced, or
        # what Whisper detected. Drives the per-clip download filename.
        forced = (req.language or "").strip().lower()
        caption_language = (
            forced if forced and forced != "auto" else transcript.get("language")
        )

        # 3) Select clips (local heuristic, optional local Ollama).
        job.set_stage("selecting", None, "Analyzing transcript for the best moments...")
        windows = job.metadata.get("windows") or selector.select_clips(transcript, req.num_clips, req.clip_length)
        job.update(metadata={**job.metadata,"windows":windows})
        if job.cancelled:
            return
        if not windows:
            raise ClipGenerationError(
                "Could not find any suitable clip windows in this video. "
                "Try a longer video or fewer clips."
            )
        job.set_stage("selecting", 1.0, f"Found {len(windows)} clip(s) to render.")

        # 4) Per clip: build ASS captions + render with ffmpeg. The caption canvas
        # must match the actual output frame (1:1 in square mode, aspect otherwise).
        words = transcript.get("words") or []
        caption_overrides = (
            req.caption_overrides.model_dump(exclude_none=True) if req.caption_overrides else None
        )
        cinematic = req.cinematic.model_dump() if req.cinematic else None
        # Resolve the background-music track once (None if unset / missing).
        music_path = None
        if req.music_track:
            try:
                music_path = music.resolve_track(req.music_track)
            except InvalidVideoURLError:
                logger.warning("[%s] music track %r not found; skipping.", job.id, req.music_track)
        width, height = target_size(req.aspect_ratio, req.fit_mode)
        clip_dir = CLIPS_DIR / clip_id
        clip_dir.mkdir(parents=True, exist_ok=True)

        results: List[dict] = []
        existing={c["index"]:c for c in job.clips}
        total = len(windows)
        for index, win in enumerate(windows):
            if job.cancelled:
                logger.info("[%s] cancelled before clip %d", job.id, index)
                return
            start, end = float(win["start"]), float(win["end"])
            if index in existing and (clip_dir/f"{index}.mp4").is_file():
                results.append(existing[index])
                continue
            job.set_stage(
                "rendering",
                None,
                f"Rendering clip {index + 1} of {total}...",
            )

            clip_words = [w for w in words if w["end"] > start and w["start"] < end]
            ass_path = clip_dir / f"{index}.ass"
            captions.build_ass(
                words=clip_words,
                style_preset=req.caption_style,
                video_w=width,
                video_h=height,
                out_path=ass_path,
                clip_start=start,
                overrides=caption_overrides,
                fit_mode=req.fit_mode.value,
            )

            opts = ClipOptions(
                aspect_ratio=req.aspect_ratio,
                fit_mode=req.fit_mode,
                blur_strength=req.blur_strength,
                background_blur=req.background_blur,
                square_corners=req.square_corners.value,
                ass_path=ass_path,
                clip_id=clip_id,
                index=index,
                bar_text=req.bar_text,
                bar_text_color=req.bar_text_color or "#FFFFFF",
                bar_text_anim=req.bar_text_anim or "none",
                cinematic=cinematic,
                music_path=music_path,
                music_volume=req.music_volume if req.music_volume is not None else 35.0,
                music_duck=req.music_duck if req.music_duck is not None else 70.0,
                music_start=req.music_start if req.music_start is not None else 0.0,
                signature=req.signature.model_dump() if req.signature else None,
            )
            if captions.get_preset(req.caption_style).get("engine") == "canvas":
                opts.caption_recipe = canvas_captions.write_recipe(
                    clip_dir / f"{index}.captions.json", style=req.caption_style,
                    words=clip_words, start=start, end=end, overrides=caption_overrides,
                    language=caption_language,
                )
            generate_clip(source_mp4, start, end, opts, cancelled=lambda: job.cancelled,
                          progress=lambda stage,frac:job.set_stage(stage,frac,f"{stage.title()} clip {index+1} of {total}"))
            if job.cancelled:
                return

            # So "Reframe" can later re-render just this one clip (see reframe.py).
            reframe.save_recipe(
                clip_id, index, source_mp4=source_mp4, start=start, end=end,
                opts_kwargs={
                    "aspect_ratio": opts.aspect_ratio,
                    "fit_mode": opts.fit_mode,
                    "blur_strength": opts.blur_strength,
                    "background_blur": opts.background_blur,
                    "square_corners": opts.square_corners,
                    "ass_path": opts.ass_path,
                    "caption_recipe": opts.caption_recipe,
                    "bar_text": opts.bar_text,
                    "bar_text_color": opts.bar_text_color,
                    "bar_text_anim": opts.bar_text_anim,
                    "cinematic": opts.cinematic,
                    "music_path": opts.music_path,
                    "music_volume": opts.music_volume,
                    "music_duck": opts.music_duck,
                    "music_start": opts.music_start,
                    "signature": opts.signature,
                },
            )

            title = win.get("title") or f"Clip {index + 1}"
            clip = {
                "index": index,
                "title": title,
                "start": round(start, 2),
                "end": round(end, 2),
                "url": f"/clips/{clip_id}/{index}.mp4",
                "language": caption_language,
                "filename": download_filename(title, caption_language, index),
            }
            results.append(clip)
            job.add_clip(clip)  # stream the finished clip to the UI immediately

            # Save each clip to history as it finishes so partial results survive errors/cancellation
            if req.upload_id:
                source_label = req.upload_name or "Uploaded file"
                source_type = "upload"
            else:
                source_label = req.video_url or "Unknown source"
                source_type = "url"
            try:
                history.add_entry(
                    clip_id=clip_id,
                    source=source_label,
                    source_type=source_type,
                    settings={
                        "aspect_ratio": req.aspect_ratio.value,
                        "fit_mode": req.fit_mode.value,
                        "blur_strength": req.blur_strength,
                        "background_blur": req.background_blur,
                        "caption_style": req.caption_style,
                        "num_clips": req.num_clips,
                        "language": caption_language,
                    },
                    clips=results,
                )
            except Exception:
                logger.warning("[%s] could not write history entry", job.id, exc_info=True)

        job.finish(results)
        logger.info("[%s] pipeline complete: %d clips", job.id, len(results))

    except DownloadCancelled:
        logger.info("[%s] download cancelled", job.id)
        return
    except InvalidVideoURLError as exc:
        logger.warning("[%s] download error: %s", job.id, exc)
        job.fail(str(exc))
    except TranscriptionError as exc:
        logger.warning("[%s] transcription error: %s", job.id, exc)
        job.fail(str(exc))
    except ClipGenerationError as exc:
        logger.warning("[%s] render error: %s", job.id, exc)
        job.fail(str(exc))
    except Exception as exc:  # noqa: BLE001 - never let a thread die silently
        logger.exception("[%s] unexpected pipeline failure", job.id)
        job.fail(f"Unexpected error: {exc}")
    finally:
        if heavy_slot is not None:
            heavy_slot.__exit__(None,None,None)
