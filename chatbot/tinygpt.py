"""
TinyGPT inside the app: the small model trained from scratch in experiments/tiny-gpt.

Every other model in the app runs in Ollama. TinyGPT is different: it is our own
model, so this file runs it directly, with plain Python and nothing to install.
That works because it is tiny (about 0.8 million weights, a 3 MB file).

The math is the same as experiments/tiny-gpt/model.py, written out by hand.
One speed-up: it remembers each earlier character's keys and values (a "KV
cache") so each new character only needs one pass through the model.

It is experimental. It was trained only on Shakespeare and can't follow
questions; it continues whatever you type in the same style.
"""

import json
import math
import os
import random
import shutil
import struct
import threading
import urllib.request
from operator import mul

HERE = os.path.dirname(os.path.abspath(__file__))
FILE_NAME = "tinygpt-shakespeare.bin"
MODEL_DIR = os.path.join(os.path.expanduser("~"), ".local-ai-chat", "models")
MODEL_PATH = os.path.join(MODEL_DIR, FILE_NAME)
# Where the download comes from: the copy that ships with the app, or the GitHub repository.
LOCAL_COPY = os.path.join(HERE, "..", "experiments", "tiny-gpt", "release", FILE_NAME)
DOWNLOAD_URL = ("https://raw.githubusercontent.com/anishmallepally123-blip/Congressional-App-Challenge-AI/"
                "main/experiments/tiny-gpt/release/" + FILE_NAME)

ENTRY = {
    "name": "tinygpt-shakespeare", "label": "TinyGPT Shakespeare", "size_gb": 0.0033, "need_gb": 0.1,
    "tools": False, "experimental": True, "engine": "tinygpt",
    "about": "Our own model, built and trained from scratch on Shakespeare. It can't answer questions: "
             "type the start of a line, like ROMEO:, and it writes on in the same style.",
}


def installed():
    return os.path.exists(MODEL_PATH)


def download(progress):
    """Copy or download the model file. Calls progress(done_bytes, total_bytes) as it goes."""
    os.makedirs(MODEL_DIR, exist_ok=True)
    part = MODEL_PATH + ".part"
    if os.path.exists(LOCAL_COPY):
        total = os.path.getsize(LOCAL_COPY)
        progress(0, total)
        shutil.copyfile(LOCAL_COPY, part)
        progress(total, total)
    else:
        with urllib.request.urlopen(DOWNLOAD_URL, timeout=30) as resp, open(part, "wb") as f:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                block = resp.read(64 * 1024)
                if not block:
                    break
                f.write(block)
                done += len(block)
                progress(done, total)
    Model(part)  # make sure it is a real TinyGPT file before keeping it
    os.replace(part, MODEL_PATH)


def remove():
    global _model
    with _lock:
        _model = None
    if os.path.exists(MODEL_PATH):
        os.remove(MODEL_PATH)


_model = None
_loaded_at = None  # the file's modified time when it was loaded
_lock = threading.Lock()


def load():
    """The model, loaded once and again whenever the file changes
    (experiments/tiny-gpt/keep_training.py --export-for-app updates it)."""
    global _model, _loaded_at
    with _lock:
        stamp = os.path.getmtime(MODEL_PATH)
        if _model is None or stamp != _loaded_at:
            _model, _loaded_at = Model(MODEL_PATH), stamp
        return _model


# ---------- The model itself ----------

def matvec(rows, bias, x):
    """rows @ x + bias, where rows is a list of lists (one per output)."""
    return [sum(map(mul, row, x)) + b for row, b in zip(rows, bias)]


def layer_norm(x, w, b, eps=1e-5):
    mean = sum(x) / len(x)
    var = sum((v - mean) ** 2 for v in x) / len(x)
    s = 1.0 / math.sqrt(var + eps)
    return [(v - mean) * s * wi + bi for v, wi, bi in zip(x, w, b)]


def gelu(v):
    return 0.5 * v * (1.0 + math.erf(v / math.sqrt(2.0)))


class Model:
    def __init__(self, path):
        with open(path, "rb") as f:
            data = f.read()
        if data[:4] != b"TGPT":
            raise ValueError("That isn't a TinyGPT model file.")
        version, head_len = struct.unpack_from("<II", data, 4)
        if version != 1:
            raise ValueError("This TinyGPT file is from a newer version of the app.")
        try:
            header = json.loads(data[12:12 + head_len])
            expected = 12 + head_len + 4 * sum(math.prod(t["shape"]) for t in header["tensors"])
        except (ValueError, KeyError, TypeError):
            raise ValueError("The TinyGPT file is damaged.")
        if expected != len(data):
            raise ValueError("The TinyGPT file is damaged (wrong size).")
        cfg = header["config"]
        self.block_size, self.n_embd = cfg["block_size"], cfg["n_embd"]
        self.n_head, self.n_layer = cfg["n_head"], cfg["n_layer"]
        self.chars = header["chars"]
        self.stoi = {c: i for i, c in enumerate(self.chars)}
        self.info = {k: header.get(k) for k in ("trained_on", "steps", "val_loss")}

        offset = 12 + head_len
        w = {}
        for t in header["tensors"]:
            count = math.prod(t["shape"])
            flat = list(struct.unpack_from(f"<{count}f", data, offset))
            offset += 4 * count
            if len(t["shape"]) == 2:  # store matrices as a list of rows
                cols = t["shape"][1]
                flat = [flat[r * cols:(r + 1) * cols] for r in range(t["shape"][0])]
            w[t["name"]] = flat
        self.w = w

    def encode(self, text):
        return [self.stoi[c] for c in text if c in self.stoi]

    def step(self, token, pos, cache):
        """Run one character through the model. cache[layer] holds earlier keys and values."""
        w, C, H = self.w, self.n_embd, self.n_head
        hs = C // H
        scale = 1.0 / math.sqrt(hs)
        x = [a + b for a, b in zip(w["token_emb.weight"][token], w["pos_emb.weight"][pos])]
        for i in range(self.n_layer):
            p = f"blocks.{i}."
            h = layer_norm(x, w[p + "ln1.weight"], w[p + "ln1.bias"])
            qkv = matvec(w[p + "attn.qkv.weight"], w[p + "attn.qkv.bias"], h)
            q, k, v = qkv[:C], qkv[C:2 * C], qkv[2 * C:]
            keys, values = cache[i]
            keys.append(k)
            values.append(v)
            out = []
            for hd in range(H):
                a, b = hd * hs, (hd + 1) * hs
                qh = q[a:b]
                scores = [sum(map(mul, qh, kk[a:b])) * scale for kk in keys]
                top = max(scores)
                exps = [math.exp(s - top) for s in scores]
                total = sum(exps)
                mixed = [0.0] * hs
                for e, vv in zip(exps, values):
                    wgt = e / total
                    mixed = [m + wgt * val for m, val in zip(mixed, vv[a:b])]
                out += mixed
            x = [a + b for a, b in zip(x, matvec(w[p + "attn.proj.weight"], w[p + "attn.proj.bias"], out))]
            h = layer_norm(x, w[p + "ln2.weight"], w[p + "ln2.bias"])
            h = [gelu(v) for v in matvec(w[p + "ff.net.0.weight"], w[p + "ff.net.0.bias"], h)]
            x = [a + b for a, b in zip(x, matvec(w[p + "ff.net.2.weight"], w[p + "ff.net.2.bias"], h))]
        x = layer_norm(x, w["ln_f.weight"], w["ln_f.bias"])
        return matvec(w["head.weight"], w["head.bias"], x)

    def prime(self, ids):
        """Fill a fresh cache with ids (at most block_size of them) and return the last scores."""
        cache = [([], []) for _ in range(self.n_layer)]
        logits = None
        for pos, t in enumerate(ids):
            logits = self.step(t, pos, cache)
        return logits, cache

    def generate(self, prompt, max_chars=500, temperature=0.8, top_k=20, rng=random):
        """Yield new characters one at a time, continuing the prompt."""
        ids = self.encode(prompt) or [self.stoi.get("\n", 0)]
        window = self.block_size
        ids = ids[-window:]
        logits, cache = self.prime(ids)
        temperature = max(float(temperature), 0.05)
        for _ in range(max_chars):
            # Pick the next character: keep the top_k likeliest, soften by temperature, roll the dice.
            best = sorted(range(len(logits)), key=logits.__getitem__, reverse=True)[:top_k]
            top = logits[best[0]]
            weights = [math.exp((logits[i] - top) / temperature) for i in best]
            nxt = rng.choices(best, weights)[0]
            ids.append(nxt)
            yield self.chars[nxt]
            if len(cache[0][0]) >= window:
                # The model's memory is full. Start over from the newest half, so the
                # positions stay within what it was trained on.
                logits, cache = self.prime(ids[-(window // 2):])
            else:
                logits = self.step(nxt, len(cache[0][0]), cache)
