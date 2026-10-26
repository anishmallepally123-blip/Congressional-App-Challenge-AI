"""
Tests for checking the settings the page sends (models.clean_settings).

Run them with:  python -m unittest test_models.py
"""

import unittest

import models

HW = {"os": "Windows", "ram_gb": 16, "cpu_cores": 8, "gpus": [], "vram_gb": 0, "unified_memory": False, "disk_free_gb": 100}


class CleanSettingsTests(unittest.TestCase):
    def clean(self, raw):
        return models.clean_settings(raw, 3, HW)[0]

    def test_odd_memory_sizes_fall_back_to_the_default(self):
        for odd in ("8192", None, [8192], {"size": 1}, True, 4096.5):
            with self.subTest(num_ctx=odd):
                self.assertEqual(self.clean({"num_ctx": odd})["num_ctx"], 4096)

    def test_normal_memory_sizes_still_work(self):
        self.assertEqual(self.clean({"num_ctx": 8192})["num_ctx"], 8192)
        self.assertEqual(self.clean({"num_ctx": 10 ** 12})["num_ctx"], max(
            o["value"] for o in models.context_options(3, HW) if o["ok"]))

    def test_other_odd_values(self):
        out = self.clean({"temperature": "hot", "num_predict": "long"})
        self.assertEqual((out["temperature"], out["num_predict"]), (0.7, -1))


if __name__ == "__main__":
    unittest.main()
