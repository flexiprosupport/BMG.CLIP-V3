"""Offline queue regression tests. Run: python -m unittest app.test_processing_queue."""
import tempfile
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from . import jobs, job_store, resources, source_security
from .models import GenerateRequest, InvalidVideoURLError

class ProcessingTests(unittest.TestCase):
    def setUp(self):
        jobs.shutdown()
        if jobs._SCHEDULER: jobs._SCHEDULER.join(2)
        jobs._JOBS.clear();jobs._RUNNING.clear();jobs._THREADS.clear();jobs._INITIALIZED=False
        self.temp=tempfile.TemporaryDirectory()
        self.db=patch.object(job_store,"DB_PATH",Path(self.temp.name)/"queue.sqlite3");self.db.start()
        jobs.initialize();resources.configure({"max_parallel_jobs":1,"max_downloads":2,"retry_limit":2})

    def tearDown(self):
        jobs.shutdown()
        if jobs._SCHEDULER: jobs._SCHEDULER.join(2)
        self.db.stop();self.temp.cleanup()
        jobs._JOBS.clear();jobs._INITIALIZED=False

    def req(self,n,**settings):
        return GenerateRequest(video_url=f"https://youtu.be/video{n:06d}",**settings)

    def wait(self,condition,seconds=5):
        until=time.time()+seconds
        while time.time()<until:
            if condition():return
            time.sleep(.02)
        self.fail("Timed out waiting for queue.")

    def test_batch_failure_isolation_and_bounded_workers(self):
        active=0;maximum=0;lock=threading.Lock()
        def pipeline(job):
            nonlocal active,maximum
            with resources.slot("render",lambda:job.cancelled):
                with lock:active+=1;maximum=max(maximum,active)
                job.set_stage("exporting",None,"Offline test export")
                time.sleep(.04)
                if job.req.video_url.endswith("000002"):job.fail("Unavailable test video")
                else:job.finish([])
                with lock:active-=1
        with patch.object(jobs,"_run_pipeline",pipeline):
            batch,created=jobs.create_batch([self.req(n) for n in range(5)])
            self.wait(lambda:all(j.status in ("done","error") for j in created))
        self.assertEqual(len(created),5)
        self.assertEqual(sum(j.status=="done" for j in created),4)
        self.assertEqual(maximum,1)
        self.assertEqual(len(job_store.load()),5)

    def test_background_submission_and_cancel(self):
        release=threading.Event()
        def pipeline(job):
            job.set_stage("transcribing",None,"Offline transcription")
            while not release.wait(.02):
                if job.cancelled:return
            job.finish([])
        with patch.object(jobs,"_run_pipeline",pipeline):
            a=jobs.create_job(self.req(1));jobs.start_job(a)
            self.wait(lambda:a.status=="running")
            b=jobs.create_job(self.req(2));jobs.start_job(b)
            self.assertIsNotNone(jobs.get_job(b.id))
            self.assertEqual(a.status,"running")
            a.cancel();self.wait(lambda:a.status=="cancelled")
            release.set();self.wait(lambda:b.status=="done")

    def test_restart_recovers_settings_and_stable_output_id(self):
        j=jobs.create_job(self.req(1,blur_strength=73,background_blur=True,caption_style="studio:premium-stack"))
        j.update(status="running",clip_id="a"*32,metadata={"windows":[{"start":0,"end":10}],"source_path":"cached.mp4"})
        jobs._JOBS.clear();jobs._INITIALIZED=False;jobs.initialize()
        restored=jobs.get_job(j.id)
        self.assertEqual(restored.status,"queued")
        self.assertEqual(restored.clip_id,"a"*32)
        self.assertEqual(restored.req.blur_strength,73)
        self.assertEqual(restored.metadata["windows"][0]["end"],10)

    def test_retry_and_remove_keep_finished_clip_records(self):
        j=jobs.create_job(self.req(1));j.clip_id="b"*32
        j.add_clip({"index":0,"url":"/clips/"+j.clip_id+"/0.mp4"})
        j.fail("Test failure")
        with patch.object(jobs,"start_scheduler"):
            jobs.retry_job(j.id)
        self.assertEqual(len(j.clips),1);self.assertEqual(j.clip_id,"b"*32)
        j.fail("Stopped");jobs.remove_job(j.id)
        self.assertNotIn(j.id,[r[0] for r in job_store.load()])
        self.assertEqual(len(j.clips),1)

    def test_idempotent_submission_and_batch_deduplication(self):
        req=self.req(1,submission_id="same")
        self.assertIs(jobs.create_job(req),jobs.create_job(req))
        with patch.object(jobs,"start_scheduler"):
            _,created=jobs.create_batch([self.req(2),self.req(2),self.req(3)])
        self.assertEqual(len(created),2)

    def test_private_and_unsupported_sources_rejected(self):
        for value in ("file:///etc/passwd","http://127.0.0.1/video.mp4","http://[::1]/a.mp4","https://user:pass@youtube.com/watch?v=x","https://youtube.com.evil.example/watch","ftp://example.com/a.mp4"):
            with self.assertRaises(InvalidVideoURLError):source_security.validate_source(value)
        for value in ("127.0.0.1","10.0.0.1","169.254.169.254","::1","::ffff:127.0.0.1","224.0.0.1"):
            with self.assertRaises(OSError):source_security.public_address(value)

if __name__=="__main__":unittest.main()
