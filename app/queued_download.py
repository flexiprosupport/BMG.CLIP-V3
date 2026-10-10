"""Bounded/cancellable yt-dlp subprocess transport; no shell-string execution."""
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import time
import signal
import uuid
from .downloader import DownloadCancelled
from .models import InvalidVideoURLError
from .paths import ROOT_DIR, DOWNLOADS_DIR

def stop_tree(process):
    if process.poll() is not None:
        return
    if os.name=="nt":
        subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"],
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    else:
        try:
            os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        if os.name!="nt":
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
        process.kill()
        process.wait()

def download(url,progress,cancelled):
    token=uuid.uuid4().hex
    metadata={}
    events=queue.Queue(maxsize=100)
    with tempfile.TemporaryFile() as error:
        process=subprocess.Popen([sys.executable,"-m","app.download_worker"],
            cwd=str(ROOT_DIR),stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=error,text=True,encoding="utf-8",start_new_session=os.name!="nt",
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        process.stdin.write(json.dumps({"url":url,"token":token})+"\n");process.stdin.close()
        def read():
            for line in process.stdout:
                try: events.put(json.loads(line),timeout=2)
                except (ValueError,queue.Full): pass
        reader=threading.Thread(target=read,daemon=True);reader.start()
        started=time.monotonic();path=None;message=None
        try:
            while process.poll() is None or reader.is_alive() or not events.empty():
                if cancelled():
                    raise DownloadCancelled()
                if time.monotonic()-started>900:
                    raise InvalidVideoURLError("Download timed out after 15 minutes. Check your connection and retry.")
                try: event=events.get(timeout=.2)
                except queue.Empty: continue
                if "progress" in event:
                    info=event["progress"]
                    if info.get("title"): metadata["title"]=info["title"]
                    if info.get("duration"): metadata["duration"]=info["duration"]
                    progress(info)
                path=event.get("path") or path
                message=event.get("error") or message
            if process.returncode or not path:
                raise InvalidVideoURLError(message or "Could not download this video. Check that it is public and available.")
            resolved=pathlib.Path(path).resolve()
            if DOWNLOADS_DIR.resolve() not in resolved.parents or not resolved.is_file():
                raise InvalidVideoURLError("Downloaded video file is missing.")
            if metadata:
                info_path=resolved.with_suffix(".metadata.json")
                temp=info_path.with_suffix(".tmp")
                temp.write_text(json.dumps(metadata),encoding="utf-8")
                os.replace(temp,info_path)
            return resolved
        finally:
            stop_tree(process)
            reader.join(timeout=3)
            process.stdout.close()
            if not path or process.returncode:
                for item in DOWNLOADS_DIR.glob(token+"*"):
                    if item.is_file(): item.unlink(missing_ok=True)
