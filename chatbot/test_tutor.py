"""
Tests for tutor mode (static/tutor.js): the chat server adds the tutor instructions only when asked.

Run them with:  python -m unittest test_tutor.py
"""

import json
import unittest
import urllib.request

from test_personal import FakeOllama, start  # also points HOME at a temporary folder

import server  # noqa: E402


class TutorModeTests(unittest.TestCase):
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
        FakeOllama.models = {"qwen3:4b": 2_500_000_000}
        FakeOllama.chats.clear()

    def system_prompt(self, **extra):
        body = dict({"model": "qwen3:4b", "messages": [{"role": "user", "content": "Solve 3x + 7 = 22"}]}, **extra)
        req = urllib.request.Request(self.url + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as resp:
            resp.read()
        return FakeOllama.chats[-1]["messages"][0]["content"]

    def test_tutor_mode_adds_the_tutor_instructions(self):
        system = self.system_prompt(tutor=True)
        self.assertIn(server.TUTOR_PROMPT, system)

    def test_normal_chats_are_unchanged(self):
        self.assertNotIn("Tutor mode", self.system_prompt())
        self.assertNotIn("Tutor mode", self.system_prompt(tutor="yes"))  # only a real true turns it on


if __name__ == "__main__":
    unittest.main()
