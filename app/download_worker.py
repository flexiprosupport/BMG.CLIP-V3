"""Isolated download process. Parent owns and cancels the complete process tree."""
import json
import sys
from . import source_security
from .downloader import download_video
from . import downloader
import os
import yt_dlp
from yt_dlp.downloader.external import FFmpegFD

class SafeYoutubeDL(yt_dlp.YoutubeDL):
    def build_request_director(self,handlers,preferences=None):
        safe=[handler for handler in handlers if handler.RH_KEY=="Urllib"]
        if not safe:
            raise RuntimeError("A guarded HTTP handler is unavailable.")
        return super().build_request_director(safe,preferences)

def main():
    request=json.loads(sys.stdin.readline())
    url=source_security.validate_source(request["url"])
    source_security.install_network_guard()
    yt_dlp.YoutubeDL=SafeYoutubeDL
    def no_external_network(*args,**kwargs):
        raise RuntimeError("This stream needs an external network downloader. For safety, upload a local video or use an HTTP/native-HLS source instead.")
    FFmpegFD.real_download=no_external_network
    attempts=downloader._download_attempts
    def authorized_attempts(options):
        forced=(os.environ.get(downloader._COOKIE_BROWSER_ENV) or "").strip().lower()
        return [(label,opts) for label,opts in attempts(options)
                if label in ("default","cookies file") or forced and label==forced+" cookies"]
    downloader._download_attempts=authorized_attempts
    def progress(data):
        info=data.get("info_dict") or {}
        total=data.get("total_bytes") or data.get("total_bytes_estimate")
        if (total or data.get("downloaded_bytes") or 0)>2*1024**3:
            raise RuntimeError("Video download exceeds the 2 GB limit.")
        event={key:data.get(key) for key in ("status","downloaded_bytes")}
        event["total_bytes"]=total
        event["title"]=str(info.get("title") or "")[:300]
        event["duration"]=info.get("duration")
        print(json.dumps({"progress":event}),flush=True)
    try:
        path=download_video(url,progress_hook=progress,download_token=request["token"])
        print(json.dumps({"path":str(path)}),flush=True)
    except Exception as exc:
        print(json.dumps({"error":str(exc)[:1200]}),flush=True)
        sys.exit(1)

if __name__=="__main__":
    main()

