"""Offline regression checks for stale desktop backend detection."""
import tempfile
import unittest
from pathlib import Path
from . import runtime,source_security

class RuntimeTests(unittest.TestCase):
    def test_shared_youtube_link_is_valid(self):
        url="https://youtu.be/2AGegNK_dAY?si=rB-cG0fMJCYHfLDT"
        self.assertEqual(source_security.validate_source(url),url)

    def test_updating_source_changes_disk_not_loaded_identity(self):
        loaded=runtime.LOADED_FINGERPRINT
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"main.py"
            path.write_text("old_api=True",encoding="utf-8")
            before=runtime.source_fingerprint(directory)
            path.write_text("new_api=True",encoding="utf-8")
            self.assertNotEqual(before,runtime.source_fingerprint(directory))
            self.assertEqual(runtime.LOADED_FINGERPRINT,loaded)

    def test_fingerprint_is_order_independent_and_ignores_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/"b.py").write_text("b")
            (root/"a.py").write_text("a")
            before=runtime.source_fingerprint(root)
            (root/"__pycache__").mkdir()
            (root/"__pycache__"/"a.pyc").write_bytes(b"cache")
            self.assertEqual(runtime.source_fingerprint(root),before)

if __name__=="__main__":unittest.main()
