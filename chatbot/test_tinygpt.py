"""
Tests for TinyGPT in the app (tinygpt.py and its server routes). They build a
small model file full of random weights, so they don't need PyTorch or the
real trained model. (experiments/tiny-gpt checks the math against PyTorch.)

Run them with:  python -m unittest test_tinygpt.py
"""

import json
import os
import random
import struct
import tempfile
import unittest

from test_personal import FakeOllama, ServerTests, start  # sets a temporary home folder first

import server  # noqa: E402
import tinygpt  # noqa: E402

CHARS = list("\n !',.:;?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")


def write_random_model(path, block_size=16, n_embd=8, n_head=2, n_layer=2):
    rng = random.Random(0)
    V, C = len(CHARS), n_embd
    shapes = [("token_emb.weight", [V, C]), ("pos_emb.weight", [block_size, C])]
    for i in range(n_layer):
        p = f"blocks.{i}."
        shapes += [(p + "ln1.weight", [C]), (p + "ln1.bias", [C]), (p + "attn.qkv.weight", [3 * C, C]),
                   (p + "attn.qkv.bias", [3 * C]), (p + "attn.proj.weight", [C, C]), (p + "attn.proj.bias", [C]),
                   (p + "ln2.weight", [C]), (p + "ln2.bias", [C]), (p + "ff.net.0.weight", [4 * C, C]),
                   (p + "ff.net.0.bias", [4 * C]), (p + "ff.net.2.weight", [C, 4 * C]), (p + "ff.net.2.bias", [C])]
    shapes += [("ln_f.weight", [C]), ("ln_f.bias", [C]), ("head.weight", [V, C]), ("head.bias", [V])]
    header = json.dumps({"config": {"block_size": block_size, "n_embd": C, "n_head": n_head, "n_layer": n_layer},
                         "chars": CHARS, "tensors": [{"name": n, "shape": s} for n, s in shapes]}).encode()
    with open(path, "wb") as f:
        f.write(b"TGPT" + struct.pack("<II", 1, len(header)) + header)
        for _, shape in shapes:
            count = shape[0] * (shape[1] if len(shape) > 1 else 1)
            f.write(struct.pack(f"<{count}f", *(rng.gauss(0, 0.5) for _ in range(count))))


class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = os.path.join(tempfile.mkdtemp(), "tiny.bin")
        write_random_model(cls.path)
        cls.model = tinygpt.Model(cls.path)

    def test_writes_the_asked_length_past_its_memory(self):
        out = "".join(self.model.generate("ROMEO:", 60, rng=random.Random(1)))
        self.assertEqual(len(out), 60)  # longer than block_size, so the memory refills along the way
        self.assertTrue(set(out) <= set(CHARS))

    def test_same_seed_same_text(self):
        a = "".join(self.model.generate("Hi", 30, rng=random.Random(7)))
        b = "".join(self.model.generate("Hi", 30, rng=random.Random(7)))
        self.assertEqual(a, b)

    def test_peek_shows_its_top_guesses_without_changing_the_text(self):
        plain = "".join(self.model.generate("Hi", 40, rng=random.Random(3)))
        peeked = list(self.model.generate("Hi", 40, rng=random.Random(3), peek=True))
        self.assertEqual("".join(ch for ch, _ in peeked), plain)
        for _, guesses in peeked:
            self.assertEqual(len(guesses), tinygpt.PEEK_GUESSES)
            chances = [p for _, p in guesses]
            self.assertEqual(chances, sorted(chances, reverse=True))
            self.assertLessEqual(sum(chances), 1.001)
            self.assertTrue(all(c in CHARS for c, _ in guesses))

    def test_cached_steps_match_a_fresh_pass(self):
        ids = self.model.encode("To be or not")
        _, cache = self.model.prime(ids[:-1])
        stepped = self.model.step(ids[-1], len(ids) - 1, cache)
        fresh, _ = self.model.prime(ids)
        self.assertEqual(stepped, fresh)

    def test_rejects_other_files(self):
        bad = self.path + ".bad"
        with open(bad, "wb") as f:
            f.write(b"not a model")
        with self.assertRaises(ValueError):
            tinygpt.Model(bad)
        with open(self.path, "rb") as f:
            data = f.read()
        with open(bad, "wb") as f:
            f.write(data[:-4])  # cut short
        with self.assertRaises(ValueError):
            tinygpt.Model(bad)


class TinyGPTServerTests(unittest.TestCase):
    """Download, chat with and remove TinyGPT through the app's own routes."""
    post, get = ServerTests.post, ServerTests.get

    @classmethod
    def setUpClass(cls):
        cls.ollama = start(FakeOllama)
        server.OLLAMA_URL = f"http://127.0.0.1:{cls.ollama.server_port}"
        cls.app = start(server.ChatHandler)
        cls.url = f"http://127.0.0.1:{cls.app.server_port}"
        tinygpt.LOCAL_COPY = os.path.join(tempfile.mkdtemp(), tinygpt.FILE_NAME)
        write_random_model(tinygpt.LOCAL_COPY)

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.ollama.shutdown()

    def setUp(self):
        FakeOllama.models = {"qwen3:4b": 2_500_000_000}
        FakeOllama.chats.clear()
        tinygpt.remove()

    def test_download_chat_and_remove(self):
        name = tinygpt.ENTRY["name"]
        listing = json.loads(self.get("/api/models"))
        card = listing["experimental"][0]
        self.assertTrue(card["experimental"])
        self.assertFalse(card["installed"])
        self.assertNotIn(name, listing["models"])  # the organizer reads this; TinyGPT can't use tools

        status, events = self.post("/api/pull", {"model": name})
        self.assertEqual(status, 200)
        self.assertEqual(events[-1], {"type": "done"})
        self.assertEqual(events[-2]["completed"], events[-2]["total"])
        self.assertTrue(json.loads(self.get("/api/models"))["experimental"][0]["installed"])

        status, events = self.post("/api/chat", {"model": name, "settings_by_model": {name: {"num_predict": 512}},
                                                 "messages": [{"role": "user", "content": "ROMEO: 123"}]})
        self.assertEqual(status, 200)
        self.assertEqual(events[0]["name"], name)
        text = "".join(e["text"] for e in events if e["type"] == "text")
        self.assertGreaterEqual(len(text), 512)
        guesses = [g for e in events if e["type"] == "peek" for g in e["guesses"]]
        self.assertEqual(len(guesses), len(text))  # one list of guesses per character written
        notice = next(e for e in events if e["type"] == "notice")["text"]
        self.assertIn("Experimental", notice)
        self.assertIn("skipped characters", notice)
        self.assertEqual(FakeOllama.chats, [])  # it never went to Ollama

        status, result = self.post("/api/title", {"model": name, "question": "ROMEO:"})
        self.assertEqual(result, {"title": ""})

        self.post("/api/delete", {"model": name})
        self.assertFalse(tinygpt.installed())
        status, _ = self.post("/api/chat", {"model": name, "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(status, 404)

if __name__ == "__main__":
    unittest.main()
