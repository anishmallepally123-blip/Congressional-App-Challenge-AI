"""
generate.py - make your trained TinyGPT write something.

Run:
    python generate.py
    python generate.py --prompt "ROMEO:" --length 500
    python generate.py --temperature 1.2      # wilder
    python generate.py --temperature 0.5      # safer, more repetitive
"""

import argparse
import os

import torch

from model import TinyGPT


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="Generate text with a trained TinyGPT.")
    p.add_argument("--checkpoint", default=os.path.join(here, "out", "model.pt"))
    p.add_argument("--prompt", default="\n", help="text to start from")
    p.add_argument("--length", type=int, default=400, help="characters to write")
    p.add_argument("--temperature", type=float, default=0.8)
    p.add_argument("--top-k", type=int, default=20)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()

    if not os.path.exists(args.checkpoint):
        raise SystemExit("No trained model yet. Run: python train.py")
    if args.seed is not None:
        torch.manual_seed(args.seed)

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    chars = ckpt["chars"]
    stoi = {ch: i for i, ch in enumerate(chars)}
    model = TinyGPT(len(chars), **ckpt["config"])
    model.load_state_dict(ckpt["model"])
    model.eval()

    # The model only knows characters it saw in training; drop any others.
    unknown = sorted(set(c for c in args.prompt if c not in stoi))
    if unknown:
        print(f"(skipping characters the model never saw: {''.join(unknown)!r})")
    ids = [stoi[c] for c in args.prompt if c in stoi] or [0]

    out = model.generate(torch.tensor([ids]), args.length,
                         temperature=args.temperature, top_k=args.top_k)
    print("".join(chars[i] for i in out[0].tolist()))


if __name__ == "__main__":
    main()
