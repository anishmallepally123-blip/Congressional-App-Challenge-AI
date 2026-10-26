"""
Tests for "In memory now" in the Models window: which models Ollama has loaded
(/api/running) and freeing one (/api/unload).

Run them with:  python -m unittest test_running.py
"""

import json
import unittest

from test_personal import FakeOllama, ServerTests, start  # sets a temporary home folder first

import server  # noqa: E402


class LoadedOllama(FakeOllama):
    """A fake Ollama with models in memory, which /api/generate with keep_alive 0 unloads."""
    loaded = []

    def do_GET(self):
        if self.path == "/api/ps":
            return self.reply({"models": LoadedOllama.loaded})
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/generate":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if body.get("keep_alive") != 0:
                return self.reply({"error": "unexpected"}, 400)
            before = len(LoadedOllama.loaded)
            LoadedOllama.loaded = [m for m in LoadedOllama.loaded if m["name"] != body["model"]]
            if len(LoadedOllama.loaded) == before:
                return self.reply({"error": f"model '{body['model']}' not found"}, 404)
            return self.reply({"model": body["model"], "done": True, "done_reason": "unload"})
        super().do_POST()


class RunningTests(unittest.TestCase):
    post, get = ServerTests.post, ServerTests.get

    @classmethod
    def setUpClass(cls):
        cls.ollama = start(LoadedOllama)
        server.OLLAMA_URL = f"http://127.0.0.1:{cls.ollama.server_port}"
        cls.app = start(server.ChatHandler)
        cls.url = f"http://127.0.0.1:{cls.app.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.ollama.shutdown()

    def setUp(self):
        LoadedOllama.loaded = [
            {"name": "qwen3:4b", "size": 3_200_000_000, "size_vram": 3_200_000_000, "expires_at": "2026-10-09T10:30:00Z"},
            {"name": "gemma3:12b", "size": 9_000_000_000, "size_vram": 3_000_000_000, "expires_at": "2026-10-09T10:31:00Z"},
            {"name": "qwen3:0.6b", "size": 1_000_000_000, "size_vram": 0, "expires_at": "2026-10-09T10:32:00Z"},
        ]

    def test_lists_loaded_models_with_memory_and_graphics_card_share(self):
        models = json.loads(self.get("/api/running"))["models"]
        self.assertEqual([m["name"] for m in models], ["qwen3:4b", "gemma3:12b", "qwen3:0.6b"])
        self.assertEqual([m["gb"] for m in models], [3.2, 9.0, 1.0])
        self.assertEqual([m["gpu_percent"] for m in models], [100, 33, 0])

    def test_free_memory_unloads_the_model(self):
        status, result = self.post("/api/unload", {"model": "gemma3:12b"})
        self.assertEqual((status, result), (200, {"ok": True}))
        models = json.loads(self.get("/api/running"))["models"]
        self.assertEqual([m["name"] for m in models], ["qwen3:4b", "qwen3:0.6b"])

    def test_unload_errors(self):
        self.assertEqual(self.post("/api/unload", {"model": "nope:1b"})[0], 404)
        self.assertEqual(self.post("/api/unload", {})[0], 400)

    def test_ollama_not_running(self):
        server.OLLAMA_URL = "http://127.0.0.1:9"
        try:
            with self.assertRaises(Exception) as caught:
                self.get("/api/running")
            self.assertEqual(caught.exception.code, 503)
            self.assertEqual(self.post("/api/unload", {"model": "qwen3:4b"})[0], 503)
        finally:
            server.OLLAMA_URL = f"http://127.0.0.1:{self.ollama.server_port}"


if __name__ == "__main__":
    unittest.main()
