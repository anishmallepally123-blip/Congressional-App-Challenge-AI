"""
Checks that the website's "Will it run on my computer?" checker (docs/fit.js) still matches
the app's model list and memory rules in models.py, so the website never promises a model
the app would block.

Run them with:  python -m unittest test_site_models.py
"""

import json
import os
import re
import shutil
import subprocess
import unittest

import models

FIT_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "fit.js")


class SiteModelsTests(unittest.TestCase):
    def setUp(self):
        with open(FIT_JS, encoding="utf-8") as f:
            self.source = f.read()

    def test_catalog_matches_the_app(self):
        site = json.loads(re.search(r"^const CATALOG = (\[.*\]);$", self.source, re.M).group(1))
        app = [{k: m[k] for k in ("name", "label", "size_gb", "need_gb", "tools")} | ({"coding": True} if m.get("coding") else {})
               for m in models.CATALOG]
        self.assertEqual(site, app, "docs/fit.js is out of date: copy the CATALOG from models.py again")

    def test_os_reserve_matches(self):
        self.assertIn(f"const OS_RESERVE_GB = {models.OS_RESERVE_GB:g};", self.source)

    @unittest.skipUnless(shutil.which("node"), "needs Node.js to run the website's code")
    def test_ratings_and_picks_match_the_app(self):
        computers = [{"ram_gb": ram, "vram_gb": vram, "unified_memory": mac}
                     for ram in (4, 8, 16, 24, 32, 64) for vram in (0, 6, 12, 24) for mac in (False, True)
                     if not (mac and vram)]
        script = ("const f = require(process.argv[1]); const hws = JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(hws.map((hw) => ({rates: f.CATALOG.map((m) => f.rate(m.need_gb, hw)),"
                  "chat: f.recommend(hw)?.name ?? null, coder: f.recommend(hw, true)?.name ?? null}))));")
        out = subprocess.run(["node", "-e", script, os.path.abspath(FIT_JS), json.dumps(computers)],
                             capture_output=True, text=True, check=True).stdout
        for hw, site in zip(computers, json.loads(out)):
            self.assertEqual(site["rates"], [models.rate(m["need_gb"], hw)["speed"] for m in models.CATALOG], hw)
            self.assertEqual(site["chat"], models.recommend(hw), hw)
            self.assertEqual(site["coder"], models.recommend(hw, coding=True), hw)


if __name__ == "__main__":
    unittest.main()
