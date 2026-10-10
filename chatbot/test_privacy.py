"""
Tests for Settings > Your data (privacy.py and the /api/privacy route).

Run them with:  python -m unittest test_privacy.py
"""

import json
import os
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()  # keep the real ~/.local-ai-chat untouched
os.environ.pop("OLLAMA_MODELS", None)

import personal  # noqa: E402
import privacy  # noqa: E402
import server  # noqa: E402


class ReportTests(unittest.TestCase):
    def test_sizes_files_and_folders_and_skips_missing_ones(self):
        root = tempfile.mkdtemp()
        with open(os.path.join(root, "a.json"), "w") as f:
            f.write("x" * 100)
        os.makedirs(os.path.join(root, "logs", "deep"))
        for name in ("one", "deep/two"):
            with open(os.path.join(root, "logs", name), "w") as f:
                f.write("y" * 50)
        out = privacy.report([
            ("🧠", "File", os.path.join(root, "a.json"), ""),
            ("🗂️", "Folder", os.path.join(root, "logs"), ""),
            ("📱", "Missing", os.path.join(root, "nope.json"), ""),
            ("🔌", "Not installed", None, ""),
        ], "http://localhost:11434")
        self.assertEqual([(p["name"], p["bytes"]) for p in out["places"]], [("File", 100), ("Folder", 100)])

    def test_network_summary(self):
        self.assertTrue(privacy.report([], "http://127.0.0.1:11434")["network"]["ollama_local"])
        self.assertTrue(privacy.report([], "http://localhost:11434")["network"]["ollama_local"])
        far = privacy.report([], "http://192.168.1.20:11434", phone_on=True, connectors_on=2)["network"]
        self.assertEqual(far, {"ollama": "192.168.1.20:11434", "ollama_local": False, "phone": True, "connectors": 2})


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = ThreadingHTTPServer(("127.0.0.1", 0), server.ChatHandler)
        threading.Thread(target=cls.app.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()

    def test_lists_personalize_data_with_its_path(self):
        personal.add_memory("My science fair project is about solar panels")
        with urllib.request.urlopen(f"http://127.0.0.1:{self.app.server_port}/api/privacy") as resp:
            data = json.load(resp)
        mine = next(p for p in data["places"] if p["name"] == "Personalize")
        self.assertEqual(mine["path"], os.path.abspath(personal.DATA_PATH))
        self.assertGreater(mine["bytes"], 0)
        self.assertIn("network", data)


if __name__ == "__main__":
    unittest.main()
