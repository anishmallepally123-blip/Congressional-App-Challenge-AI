"""
Tests that the chat reports how fast this computer wrote each answer. A fake Ollama
stands in for the real one, so these don't need Ollama or a model installed.

Run them with:  python -m unittest test_stats.py
"""

import json
import os
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()  # keep the real ~/.local-ai-chat untouched

import hardware  # noqa: E402
import server  # noqa: E402

hardware.detect = lambda: {"ram_gb": 16, "vram_gb": 0, "unified_memory": False, "disk_free_gb": 100, "gpu": None}


class FakeOllama(BaseHTTPRequestHandler):
    done = {"done": True, "done_reason": "stop", "eval_count": 120, "eval_duration": 4_000_000_000}

    def log_message(self, *args):
        pass

    def reply(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/tags":
            return self.reply({"models": [{"name": "qwen3:4b", "size": 2_500_000_000}]})
        self.reply({"version": "0.12.0"})

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/api/show":
            return self.reply({"capabilities": ["completion"]})
        self.send_response(200)
        self.end_headers()
        lines = [{"message": {"content": "Hello there."}}, FakeOllama.done]
        self.wfile.write("".join(json.dumps(x) + "\n" for x in lines).encode())


def start(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


class SpeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ollama = start(FakeOllama)
        server.OLLAMA_URL = f"http://127.0.0.1:{cls.ollama.server_port}"
        cls.app = start(server.ChatHandler)
        cls.url = f"http://127.0.0.1:{cls.app.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.ollama.shutdown()

    def chat(self):
        body = json.dumps({"model": "qwen3:4b", "messages": [{"role": "user", "content": "hi"}]}).encode()
        req = urllib.request.Request(self.url + "/api/chat", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as resp:
            return [json.loads(line) for line in resp.read().decode().splitlines() if line]

    def test_answer_ends_with_its_speed(self):
        FakeOllama.done = {"done": True, "done_reason": "stop", "eval_count": 120, "eval_duration": 4_000_000_000}
        stats = [e for e in self.chat() if e["type"] == "stats"]
        self.assertEqual(stats, [{"type": "stats", "tokens": 120, "seconds": 4.0}])

    def test_no_speed_when_ollama_does_not_time_it(self):
        FakeOllama.done = {"done": True, "done_reason": "stop"}
        self.assertFalse([e for e in self.chat() if e["type"] == "stats"])


if __name__ == "__main__":
    unittest.main()
