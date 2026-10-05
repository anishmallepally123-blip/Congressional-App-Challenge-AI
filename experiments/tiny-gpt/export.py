"""
export.py - pack a trained TinyGPT into one small file the chat app can run.

Run (after train.py):
    python export.py                      # out/model.pt -> release/tinygpt-shakespeare.bin

The chat app has no PyTorch (it only uses Python's standard library), so it
can't open model.pt. This writes the same weights in a plain layout:

    4 bytes   b"TGPT"
    4 bytes   format version (1), little-endian
    4 bytes   length of the header
    header    JSON: the settings, the list of characters, and every weight's
              name and shape, in the order they follow
    the rest  every weight as 32-bit floats, little-endian, one after another

chatbot/tinygpt.py reads this file and runs the model itself.
"""

import argparse
import json
import os
import struct

import torch

# The weights the app needs, per layer, in the order it reads them.
LAYER_PARTS = ["ln1.weight", "ln1.bias", "attn.qkv.weight", "attn.qkv.bias",
               "attn.proj.weight", "attn.proj.bias", "ln2.weight", "ln2.bias",
               "ff.net.0.weight", "ff.net.0.bias", "ff.net.2.weight", "ff.net.2.bias"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="Export a trained TinyGPT for the chat app.")
    p.add_argument("--checkpoint", default=os.path.join(here, "out", "model.pt"))
    p.add_argument("--output", default=os.path.join(here, "release", "tinygpt-shakespeare.bin"))
    args = p.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    state, cfg = ckpt["model"], ckpt["config"]
    names = ["token_emb.weight", "pos_emb.weight"]
    for i in range(cfg["n_layer"]):
        names += [f"blocks.{i}.{part}" for part in LAYER_PARTS]
    names += ["ln_f.weight", "ln_f.bias", "head.weight", "head.bias"]

    header = {
        "config": {k: cfg[k] for k in ("block_size", "n_embd", "n_head", "n_layer")},
        "chars": ckpt["chars"],
        "tensors": [{"name": n, "shape": list(state[n].shape)} for n in names],
        "trained_on": ckpt.get("data"),
        "steps": ckpt.get("step"),
        "val_loss": (ckpt.get("losses") or {}).get("val"),
    }
    head = json.dumps(header).encode("utf-8")
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(b"TGPT" + struct.pack("<II", 1, len(head)) + head)
        for n in names:
            f.write(state[n].detach().float().contiguous().numpy().astype("<f4").tobytes())
    size = os.path.getsize(args.output)
    print(f"Wrote {os.path.relpath(args.output, here)} ({size / 1e6:.1f} MB, "
          f"{sum(state[n].numel() for n in names):,} weights)")


if __name__ == "__main__":
    main()
