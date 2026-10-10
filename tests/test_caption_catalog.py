import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import captions, canvas_captions, reframe
from app.models import CaptionOverrides


class CaptionCatalogTests(unittest.TestCase):
    def test_all_styles_and_legacy_ass(self):
        catalog = captions.get_presets_for_api()
        self.assertEqual(len(catalog), 104)
        legacy = [p for p in catalog if p["engine"] == "ass"]
        self.assertEqual(len(legacy), 19)
        self.assertEqual(sum(p["category"] == "Premium" for p in catalog), 6)
        self.assertEqual(sum(p["category"] == "Multiline" for p in catalog), 15)
        with tempfile.TemporaryDirectory() as folder:
            for preset in legacy:
                target = pathlib.Path(folder) / (preset["id"] + ".ass")
                captions.build_ass(words=[{"word":"Caption","start":0,"end":1}],
                    style_preset=preset["id"],video_w=1080,video_h=1920,
                    out_path=target,clip_start=0,overrides=None,fit_mode="crop")
                self.assertIn("Dialogue:",target.read_text(encoding="utf-8"))

    def test_controls_recipe_and_reframe(self):
        overrides = CaptionOverrides(native_palette="coral",background_radius=20,
            pos_x=0,pos_y=100).model_dump(exclude_none=True)
        with tempfile.TemporaryDirectory() as folder:
            target = pathlib.Path(folder)/"captions.json"
            canvas_captions.write_recipe(target,style="studio:premium-stack",
                words=[{"word":"Hello","start":4,"end":5}],start=4,end=5,
                overrides=overrides,language="en")
            import json
            recipe = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(recipe["words"][0]["start"],0)
            self.assertEqual(recipe["overrides"]["pos_x"],0)
            reframe.save_recipe("test",0,source_mp4=pathlib.Path("video.mp4"),
                start=4,end=5,opts_kwargs={"caption_recipe":target,"background_blur":True,"blur_strength":73})
            saved = reframe.get_recipe("test",0)
            self.assertEqual(saved["opts_kwargs"]["caption_recipe"],target)
            self.assertEqual(saved["opts_kwargs"]["blur_strength"],73)


if __name__ == "__main__":
    unittest.main()
