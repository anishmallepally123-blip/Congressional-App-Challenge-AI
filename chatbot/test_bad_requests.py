"""
Requests with missing or wrong-typed fields get a clear error from the server instead of
a dropped connection (which the page reports as "Lost connection to the app").

Run them with:  python -m unittest test_bad_requests.py
"""

import json
import unittest
import urllib.request

from test_personal import FakeOllama, start  # also points HOME at a temporary folder

import server  # noqa: E402


class BadRequestTests(unittest.TestCase):
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

    def post(self, path, body):
        req = urllib.request.Request(self.url + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_wrong_types_get_an_error_not_a_dropped_connection(self):
        paths = ["/api/chat", "/api/title", "/api/personal/preview", "/api/personal/assistant/create",
                 "/api/organizer/apply", "/api/organizer/undo", "/api/files/unshare", "/api/connectors/add"]
        fields = ["model", "messages", "question", "name", "base", "folder", "plan_id", "run_id", "config", "approved"]
        for path in paths:
            for value in (123, [1, 2], {"a": 1}, True):
                with self.subTest(path=path, value=value):
                    status, _ = self.post(path, {f: value for f in fields})  # raises if the connection drops
                    self.assertIn(status, (200, 400, 404))

    def test_empty_message_text_still_chats(self):
        # A saved chat can hold a message whose text is null.
        status, body = self.post("/api/chat", {"model": "qwen3:4b", "messages": [
            {"role": "user", "content": "hi"}, {"role": "assistant", "content": None}, {"role": "user"}]})
        self.assertEqual(status, 200, body)
        self.assertEqual([m["content"] for m in FakeOllama.chats[-1]["messages"][1:]], ["hi", "", ""])

    def test_chat_needs_messages(self):
        self.assertEqual(self.post("/api/chat", {"model": "qwen3:4b", "messages": []})[0], 400)
        self.assertEqual(self.post("/api/chat", {"model": "qwen3:4b", "messages": ["hi"]})[0], 400)


if __name__ == "__main__":
    unittest.main()
