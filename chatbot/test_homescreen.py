"""Checks the files that let a phone add the app to its home screen."""
import json
import os
import re
import struct
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path + " is not a PNG"
    return struct.unpack(">II", head[16:24])


class HomeScreenTest(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(STATIC, "manifest.json")) as f:
            self.manifest = json.load(f)
        with open(os.path.join(STATIC, "index.html")) as f:
            self.page = f.read()

    def test_manifest_basics(self):
        self.assertEqual(self.manifest["start_url"], "/")
        self.assertEqual(self.manifest["display"], "standalone")
        self.assertTrue(self.manifest["name"] and self.manifest["short_name"])

    def test_icons_exist_with_their_listed_sizes(self):
        for icon in self.manifest["icons"]:
            path = os.path.join(STATIC, icon["src"].lstrip("/"))
            self.assertTrue(os.path.isfile(path), icon["src"])
            if icon["type"] == "image/png":
                w, h = png_size(path)
                self.assertEqual("%dx%d" % (w, h), icon["sizes"])

    def test_page_links_everything(self):
        for href in re.findall(r'(?:href|src)="(/(?:manifest\.json|icons/[^"]+))"', self.page):
            self.assertTrue(os.path.isfile(os.path.join(STATIC, href.lstrip("/"))), href)
        self.assertIn('rel="manifest"', self.page)
        self.assertIn('rel="apple-touch-icon"', self.page)
        self.assertEqual(png_size(os.path.join(STATIC, "icons", "apple-touch-icon.png")), (180, 180))


if __name__ == "__main__":
    unittest.main()
