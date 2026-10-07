"""
Tests that the chat warns when a conversation outgrows the model's memory, since
Ollama then quietly forgets the start. A fake Ollama stands in for the real one.

Run them with:  python -m unittest test_long_chat.py
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
            return self.reply({"capabilities": ["completion", "tools"]})
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"message": {"content": "OK."}, "done": true, "done_reason": "stop"}\n')


def start(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


class LongChatTests(unittest.TestCase):
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

    def notices(self, messages, settings=None):
        body = json.dumps({"model": "qwen3:4b", "messages": messages,
                           "settings_by_model": {"qwen3:4b": settings or {}}}).encode()
        req = urllib.request.Request(self.url + "/api/chat", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as resp:
            events = [json.loads(line) for line in resp.read().decode().splitlines() if line]
        return [e["text"] for e in events if e["type"] == "notice"]

    def long_chat(self, chars):
        turns = []
        for i in range(10):
            turns += [{"role": "user", "content": f"Question {i}"}, {"role": "assistant", "content": "x" * (chars // 10)}]
        return turns + [{"role": "user", "content": "And one more thing?"}]

    def test_short_chat_has_no_warning(self):
        self.assertEqual(self.notices([{"role": "user", "content": "hi"}]), [])

    def test_chat_longer_than_memory_warns(self):
        notes = self.notices(self.long_chat(20_000))  # about 5,000 tokens, more than the 4,096 default
        self.assertEqual(len(notes), 1)
        self.assertIn("4,096 tokens", notes[0])
        self.assertIn("forgotten", notes[0])

    def test_more_memory_means_no_warning(self):
        self.assertEqual(self.notices(self.long_chat(20_000), {"num_ctx": 8192}), [])


if __name__ == "__main__":
    unittest.main()
