"""FFmpeg discovery regressions; no external video or model downloads."""
import os
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import yt_dlp
from yt_dlp.postprocessor.ffmpeg import FFmpegMergerPP
from . import paths,downloader

class FFmpegTests(unittest.TestCase):
    def test_actual_video_audio_merge_with_empty_bundle(self):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            self.skipTest("Requires system ffmpeg/ffprobe")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=root/"empty-bundle";bundle.mkdir()
            video=root/"video.mp4";audio=root/"audio.m4a";output=root/"merged.mp4"
            subprocess.run(["ffmpeg","-v","error","-f","lavfi","-i","color=c=blue:s=128x128:r=10","-t","0.5","-c:v","libx264","-threads","1","-an",str(video)],check=True,capture_output=True,timeout=20)
            subprocess.run(["ffmpeg","-v","error","-f","lavfi","-i","sine=frequency=440","-t","0.5","-c:a","aac",str(audio)],check=True,capture_output=True,timeout=20)
            with patch.object(paths,"FFMPEG_DIR",bundle):
                paths.require_ffmpeg()
                with yt_dlp.YoutubeDL({"quiet":True,"no_warnings":True}) as ydl:
                    FFmpegMergerPP(ydl).run({"filepath":str(output),"ext":"mp4",
                        "requested_formats":[{"vcodec":"h264","acodec":"none","protocol":"https"},
                                             {"vcodec":"none","acodec":"aac","protocol":"https"}],
                        "__files_to_merge":[str(video),str(audio)]})
            probe=subprocess.run(["ffprobe","-v","error","-show_streams","-of","json",str(output)],check=True,capture_output=True,timeout=10)
            self.assertEqual({s["codec_type"] for s in json.loads(probe.stdout)["streams"]},{"video","audio"})

    def test_empty_bundle_does_not_hide_installed_tools(self):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            self.skipTest("Requires system ffmpeg/ffprobe")
        with tempfile.TemporaryDirectory() as directory,patch.object(paths,"FFMPEG_DIR",Path(directory)):
            with yt_dlp.YoutubeDL({"quiet":True,"no_warnings":True,"ffmpeg_location":directory}) as legacy:
                self.assertFalse(FFmpegMergerPP(legacy).available)
            paths.require_ffmpeg()
            with yt_dlp.YoutubeDL({"quiet":True,"no_warnings":True}) as fixed:
                self.assertTrue(FFmpegMergerPP(fixed).available)

    def test_nested_bundle_is_added_to_path(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{"PATH":os.environ.get("PATH","")}):
            root=Path(directory)
            (root/"bin").mkdir();(root/"bin"/"ffmpeg.exe").write_bytes(b"fixture")
            with patch.object(paths,"FFMPEG_DIR",root):paths.ensure_ffmpeg()
            self.assertEqual(os.environ["PATH"].split(os.pathsep)[0],str(root/"bin"))

    def test_missing_tools_fail_before_network(self):
        with patch.object(paths.shutil,"which",return_value=None),patch.object(downloader.yt_dlp,"YoutubeDL") as ydl:
            with self.assertRaisesRegex(RuntimeError,"ffmpeg is not available.*Retry"):
                downloader.download_video("https://youtu.be/2AGegNK_dAY")
            ydl.assert_not_called()

    def test_broken_tool_has_dependency_error(self):
        with patch.object(paths.shutil,"which",return_value="/fake/ffmpeg"),patch.object(paths.subprocess,"run",return_value=subprocess.CompletedProcess([],1)):
            with self.assertRaisesRegex(RuntimeError,"failed its version check"):
                paths.require_ffmpeg()

    def test_download_options_do_not_override_system_path(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(downloader,"DOWNLOADS_DIR",Path(directory)),patch.object(downloader,"require_ffmpeg"),patch.object(downloader,"get_ffmpeg_location",return_value=None):
            token="a"*32
            (Path(directory)/(token+".mp4")).write_bytes(b"fixture")
            with patch.object(downloader.yt_dlp,"YoutubeDL") as ydl:
                result=downloader.download_video("https://youtu.be/2AGegNK_dAY",download_token=token)
                self.assertEqual(result.name,token+".mp4")
                self.assertNotIn("ffmpeg_location",ydl.call_args.args[0])

    def test_reuses_existing_install_tools(self):
        ffmpeg=shutil.which("ffmpeg");ffprobe=shutil.which("ffprobe")
        if not ffmpeg or not ffprobe:self.skipTest("Needs installed tools")
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{"LOCALAPPDATA":directory,"PATH":""}):
            folder=Path(directory)/"Programs"/"BMG.CLIP-V3-Preview"/"ffmpeg"/"bin"
            folder.mkdir(parents=True)
            (folder/"ffmpeg").symlink_to(ffmpeg);(folder/"ffprobe").symlink_to(ffprobe)
            with patch.object(paths,"FFMPEG_DIR",Path(directory)/"empty"):
                self.assertEqual(paths.get_ffmpeg_location(),str(folder))
                with yt_dlp.YoutubeDL({"quiet":True,"ffmpeg_location":str(folder)}) as ydl:
                    self.assertTrue(FFmpegMergerPP(ydl).available)

if __name__=="__main__":unittest.main()
