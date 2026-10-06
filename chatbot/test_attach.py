"""
Tests that text files attached with the 📎 button reach the model. A fake Ollama
stands in for the real one, so these don't need Ollama or a model installed.

Run them with:  python -m unittest test_attach.py
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
    last = None  # the last /api/chat request the app sent

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
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/api/show":
            return self.reply({"capabilities": ["completion"]})
        FakeOllama.last = body
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"message": {"content": "It is about bees."}, "done": true}\n')


def start(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


class AttachTests(unittest.TestCase):
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

    def chat(self, messages):
        body = json.dumps({"model": "qwen3:4b", "messages": messages}).encode()
        req = urllib.request.Request(self.url + "/api/chat", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as resp:
            resp.read()
        return FakeOllama.last

    def test_attached_file_is_sent_to_the_model(self):
        sent = self.chat([{"role": "user", "content": "What is this about?",
                           "files": [{"name": "notes.txt", "text": "Bees make honey."}]}])
        question = sent["messages"][-1]
        self.assertEqual(question["role"], "user")
        self.assertTrue(question["content"].startswith("What is this about?"))
        self.assertIn("--- Attached file: notes.txt ---\nBees make honey.\n--- End of notes.txt ---", question["content"])
        self.assertNotIn("files", question)
        self.assertGreaterEqual(sent["options"]["num_ctx"], 8192)  # more room for the file

    def test_long_files_are_trimmed_and_limited(self):
        files = [{"name": f"f{i}.txt", "text": "x" * 50_000} for i in range(5)]
        content = self.chat([{"role": "user", "content": "hi", "files": files}])["messages"][-1]["content"]
        self.assertEqual(content.count("--- Attached file:"), server.MAX_FILES)
        self.assertLess(len(content), server.MAX_FILES * (server.FILE_CHARS + 100))

    def test_chat_without_files_is_unchanged(self):
        sent = self.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(sent["messages"][-1], {"role": "user", "content": "hi"})
        self.assertEqual(sent["options"]["num_ctx"], 4096)

    def test_bad_files_are_ignored(self):
        content = self.chat([{"role": "user", "content": "hi", "files": [None, {"name": "x"}, "oops"]}])["messages"][-1]["content"]
        self.assertEqual(content, "hi")


if __name__ == "__main__":
    unittest.main()
