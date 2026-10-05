"""
Tests for Personalize (personal.py) and how the chat server uses it. A fake Ollama
stands in for the real one, so these don't need Ollama or a model installed.

Run them with:  python -m unittest test_personal.py
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
import personal  # noqa: E402
import server  # noqa: E402

HW = {"ram_gb": 16, "vram_gb": 0, "unified_memory": False, "disk_free_gb": 100, "gpu": None}
hardware.detect = lambda: HW


class FakeOllama(BaseHTTPRequestHandler):
    """Answers like Ollama and remembers what it was sent."""
    models = {}
    chats = []
    created = []

    def log_message(self, *args):
        pass

    def reply(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/tags":
            return self.reply({"models": [{"name": n, "size": s} for n, s in self.models.items()]})
        self.reply({"version": "0.12.0"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/api/show":
            return self.reply({"capabilities": ["completion", "tools"]})
        if self.path == "/api/create":
            FakeOllama.created.append(body)
            FakeOllama.models[body["model"] + ":latest"] = FakeOllama.models[body["from"]]
            return self.reply({"status": "success"})
        if self.path == "/api/chat":
            FakeOllama.chats.append(body)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"message":{"content":"Got it."}}\n{"done":true,"done_reason":"stop"}\n')
            return
        self.reply({"error": "not found"}, 404)

    def do_DELETE(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if FakeOllama.models.pop(body["model"] + ":latest", None) is None:
            return self.reply({"error": "not found"}, 404)
        self.reply({})


def start(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


class PersonalTests(unittest.TestCase):
    def setUp(self):
        if os.path.exists(personal.DATA_PATH):
            os.remove(personal.DATA_PATH)

    def test_remember_requests(self):
        self.assertEqual(personal.remember_request("Remember that my dog is named Max."), "my dog is named Max")
        self.assertEqual(personal.remember_request("please remember: I'm allergic to peanuts"), "I'm allergic to peanuts")
        self.assertEqual(personal.remember_request("Can you remember I take AP Bio?"), "I take AP Bio")
        self.assertIsNone(personal.remember_request("Do you remember what I said?"))
        self.assertIsNone(personal.remember_request("remember when we talked about Rome?"))
        self.assertIsNone(personal.remember_request("How do I remember the planets?"))

    def test_memory_is_saved_once_and_can_be_deleted(self):
        personal.add_memory("My essay is due Friday")
        data = personal.add_memory("my essay is due friday")
        self.assertEqual(len(data["memories"]), 1)
        data = personal.delete_memory(data["memories"][0]["id"])
        self.assertEqual(data["memories"], [])
        with self.assertRaises(personal.PersonalError):
            personal.add_memory("   ")

    def test_context_has_profile_memory_and_matching_examples(self):
        personal.set_profile({"name": "Sam", "about": "10th grade", "style": "Short answers"})
        personal.add_memory("Plays basketball")
        personal.add_example("What is photosynthesis?", "Plants making food from light.")
        personal.add_example("Write a poem about rain", "Drip, drop...")
        system, examples = personal.context_for([{"role": "user", "content": "explain photosynthesis again"}])
        self.assertIn("Their name is Sam.", system)
        self.assertIn("Short answers", system)
        self.assertIn("- Plays basketball", system)
        self.assertEqual(examples[0], {"role": "user", "content": "What is photosynthesis?"})

        personal.set_options(enabled=False)
        self.assertEqual(personal.context_for([{"role": "user", "content": "hi"}]), ("", []))

    def test_export_is_one_conversation_per_line(self):
        personal.add_example("Q1", "A1")
        personal.add_example("Q2", "A2")
        lines = personal.export_jsonl().strip().split("\n")
        self.assertEqual(len(lines), 2)
        convo = json.loads(lines[0])["messages"]
        self.assertEqual([m["role"] for m in convo], ["user", "assistant"])

    def test_assistant_names_are_checked(self):
        record, payload = personal.assistant_request("History Tutor!", "qwen3:4b", "Be a tutor", 5, set())
        self.assertEqual(record["name"], "history-tutor")
        self.assertEqual(payload["parameters"]["temperature"], 2.0)
        with self.assertRaises(personal.PersonalError):
            personal.assistant_request("qwen3", "qwen3:4b", "x", 0.7, {"qwen3:latest"})
        with self.assertRaises(personal.PersonalError):
            personal.assistant_request("x", "qwen3:4b", "x", 0.7, set())


class ServerTests(unittest.TestCase):
    """The chat server with a fake Ollama behind it."""

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

    def setUp(self):
        if os.path.exists(personal.DATA_PATH):
            os.remove(personal.DATA_PATH)
        FakeOllama.models = {"qwen3:4b": 2_500_000_000}
        FakeOllama.chats.clear()
        FakeOllama.created.clear()

    def post(self, path, body):
        req = urllib.request.Request(self.url + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as resp:
                text = resp.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())
        if "ndjson" in resp.headers.get("Content-Type", ""):
            return resp.status, [json.loads(line) for line in text.splitlines() if line]
        return resp.status, json.loads(text)

    def get(self, path):
        with urllib.request.urlopen(self.url + path) as resp:
            return resp.read().decode()

    def test_remember_command_saves_memory_and_reaches_the_model(self):
        status, events = self.post("/api/chat", {"model": "qwen3:4b", "messages": [
            {"role": "user", "content": "Remember that my favorite subject is chemistry"}]})
        self.assertEqual(status, 200)
        self.assertTrue(any(e.get("action") == "personal" for e in events))
        self.assertEqual(personal.load()["memories"][0]["text"], "my favorite subject is chemistry")
        system = FakeOllama.chats[-1]["messages"][0]["content"]
        self.assertIn("- my favorite subject is chemistry", system)

    def test_examples_go_between_instructions_and_conversation(self):
        self.post("/api/personal/example/add", {"prompt": "What is gravity?", "answer": "A pull between masses."})
        self.post("/api/chat", {"model": "qwen3:4b", "messages": [{"role": "user", "content": "what is gravity on mars"}]})
        sent = FakeOllama.chats[-1]["messages"]
        self.assertEqual([m["role"] for m in sent], ["system", "user", "assistant", "user"])
        self.assertEqual(sent[1]["content"], "What is gravity?")
        self.assertEqual(sent[-1]["content"], "what is gravity on mars")

    def test_custom_assistant_is_created_used_and_deleted(self):
        status, result = self.post("/api/personal/assistant/create", {
            "name": "chem-tutor", "base": "qwen3:4b", "instructions": "You are a chemistry tutor.", "temperature": 0.3})
        self.assertEqual(status, 200, result)
        self.assertEqual(FakeOllama.created[-1]["from"], "qwen3:4b")
        self.assertEqual(FakeOllama.created[-1]["system"], "You are a chemistry tutor.")

        models_list = json.loads(self.get("/api/models"))
        self.assertIn("chem-tutor:latest", models_list["models"])
        mine = next(m for m in models_list["others"] if m["name"] == "chem-tutor:latest")
        self.assertTrue(mine["custom"])

        self.post("/api/chat", {"model": "chem-tutor:latest", "messages": [{"role": "user", "content": "hi"}]})
        sent = FakeOllama.chats[-1]
        self.assertIn("You are a chemistry tutor.", sent["messages"][0]["content"])
        self.assertEqual(sent["options"]["temperature"], 0.3)

        status, _ = self.post("/api/personal/assistant/create", {
            "name": "chem-tutor", "base": "qwen3:4b", "instructions": "again"})
        self.assertEqual(status, 400)  # name taken

        status, result = self.post("/api/personal/assistant/delete", {"name": "chem-tutor"})
        self.assertEqual(result["data"]["assistants"], [])
        self.assertNotIn("chem-tutor:latest", FakeOllama.models)

    def test_page_and_export_load(self):
        self.assertIn("Personalize your AI", self.get("/personal"))
        self.post("/api/personal/example/add", {"prompt": "Q", "answer": "A"})
        self.assertIn('"content": "Q"', self.get("/api/personal/export"))
        data = json.loads(self.get("/api/personal"))
        self.assertEqual(data["bases"][0]["name"], "qwen3:4b")


if __name__ == "__main__":
    unittest.main()
