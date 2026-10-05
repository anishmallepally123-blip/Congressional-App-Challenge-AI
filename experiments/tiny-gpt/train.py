"""
train.py - teach TinyGPT to write like a text file.

Run:
    python train.py                       # quick CPU run on Shakespeare
    python train.py --data data/my.txt    # your own text
    python train.py --preset medium       # bigger model (GPU recommended)
    python train.py --max-iters 500       # change any setting from the command line

What happens:
  1. Read the text and build the "tokenizer": a list of every character used.
  2. Turn the whole text into a list of numbers.
  3. Keep 90% for training and hide 10% to check the model is really
     learning patterns, not memorising.
  4. Loop: grab random chunks, ask the model to predict each next character,
     measure how wrong it was (the loss), and nudge every weight a little in
     the direction that would have made it less wrong.
  5. Every so often, print the loss and a sample so you can watch it improve.
  6. Save everything to out/model.pt for generate.py.
"""

import argparse
import json
import os
import time

import torch

from model import TinyGPT

# ---------------------------------------------------------------------------
# Settings. Edit these, or override any of them on the command line.
# ---------------------------------------------------------------------------
PRESETS = {
    # ~0.8M parameters. Trains on a laptop CPU in a few minutes.
    "small": dict(block_size=128, n_embd=128, n_head=4, n_layer=4, dropout=0.1,
                  batch_size=32, learning_rate=1e-3, max_iters=2000),
    # ~10.8M parameters. Wants a GPU (or a lot of patience).
    "medium": dict(block_size=256, n_embd=384, n_head=6, n_layer=6, dropout=0.2,
                   batch_size=64, learning_rate=3e-4, max_iters=5000),
}

DEFAULTS = dict(
    data="data/shakespeare.txt",
    out_dir="out",
    preset="small",
    eval_every=250,    # how often to check progress
    eval_iters=50,     # how many batches to average when checking
    device="auto",     # auto picks cuda (NVIDIA), mps (Apple), or cpu
    seed=1337,         # same seed = same results each run
)


def parse_args():
    p = argparse.ArgumentParser(description="Train TinyGPT from scratch.")
    p.add_argument("--data", default=DEFAULTS["data"])
    p.add_argument("--out-dir", default=DEFAULTS["out_dir"])
    p.add_argument("--preset", default=DEFAULTS["preset"], choices=PRESETS)
    p.add_argument("--eval-every", type=int, default=DEFAULTS["eval_every"])
    p.add_argument("--eval-iters", type=int, default=DEFAULTS["eval_iters"])
    p.add_argument("--device", default=DEFAULTS["device"])
    p.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    # These default to whatever the preset says.
    for name, kind in [("block_size", int), ("n_embd", int), ("n_head", int),
                       ("n_layer", int), ("dropout", float), ("batch_size", int),
                       ("learning_rate", float), ("max_iters", int)]:
        p.add_argument("--" + name.replace("_", "-"), type=kind, default=None)
    args = vars(p.parse_args())
    for k, v in PRESETS[args["preset"]].items():
        if args[k] is None:
            args[k] = v
    return args


def pick_device(choice):
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    cfg = parse_args()
    torch.manual_seed(cfg["seed"])
    device = pick_device(cfg["device"])
    here = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(here, cfg["data"])
    out_dir = os.path.join(here, cfg["out_dir"])

    # 1. The tokenizer: every distinct character gets a number.
    with open(data_path, encoding="utf-8") as f:
        text = f.read()
    chars = sorted(set(text))
    stoi = {ch: i for i, ch in enumerate(chars)}  # "string to integer"
    print(f"Read {len(text):,} characters, {len(chars)} different ones, from {cfg['data']}")

    # 2. The whole text as one long list of numbers.
    data = torch.tensor([stoi[c] for c in text], dtype=torch.long)

    # 3. Train / validation split.
    n = int(0.9 * len(data))
    train_data, val_data = data[:n], data[n:]
    if len(val_data) <= cfg["block_size"] + 1:
        raise SystemExit("That text is too short. Use a bigger file or a smaller --block-size.")

    def get_batch(split):
        """Pick batch_size random chunks. The target for each character is
        simply the character after it, so y is x shifted left by one."""
        d = train_data if split == "train" else val_data
        starts = torch.randint(len(d) - cfg["block_size"] - 1, (cfg["batch_size"],))
        x = torch.stack([d[i:i + cfg["block_size"]] for i in starts])
        y = torch.stack([d[i + 1:i + 1 + cfg["block_size"]] for i in starts])
        return x.to(device), y.to(device)

    model = TinyGPT(len(chars), cfg["block_size"], cfg["n_embd"], cfg["n_head"],
                    cfg["n_layer"], cfg["dropout"]).to(device)
    print(f"Model has {model.num_params():,} parameters, training on {device}")

    # AdamW is the standard "how to nudge the weights" rule for transformers.
    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg["learning_rate"])

    @torch.no_grad()
    def estimate_loss():
        model.eval()  # turns dropout off while measuring
        out = {}
        for split in ("train", "val"):
            losses = torch.zeros(cfg["eval_iters"])
            for i in range(cfg["eval_iters"]):
                x, y = get_batch(split)
                losses[i] = model(x, y)[1].item()
            out[split] = losses.mean().item()
        model.train()
        return out

    def sample(n_chars=200):
        model.eval()
        start = torch.tensor([[stoi.get("\n", 0)]], device=device)
        ids = model.generate(start, n_chars, temperature=0.8, top_k=20)[0].tolist()
        model.train()
        return "".join(chars[i] for i in ids)

    def save(step, losses):
        os.makedirs(out_dir, exist_ok=True)
        torch.save({
            "model": model.state_dict(),
            "chars": chars,
            "config": {k: cfg[k] for k in ("block_size", "n_embd", "n_head", "n_layer", "dropout")},
            "step": step,
            "losses": losses,
            "data": cfg["data"],
        }, os.path.join(out_dir, "model.pt"))

    # 4. The training loop.
    history = []
    best_val = float("inf")
    t0 = time.time()
    for step in range(cfg["max_iters"] + 1):
        if step % cfg["eval_every"] == 0 or step == cfg["max_iters"]:
            losses = estimate_loss()
            history.append({"step": step, **losses})
            print(f"\nstep {step:5d} | train loss {losses['train']:.3f} | "
                  f"val loss {losses['val']:.3f} | {time.time() - t0:.0f}s")
            print("-" * 60 + "\n" + sample().strip() + "\n" + "-" * 60)
            # 6. Keep the version that did best on text it never trained on.
            if losses["val"] < best_val:
                best_val = losses["val"]
                save(step, losses)
        if step == cfg["max_iters"]:
            break

        x, y = get_batch("train")
        _, loss = model(x, y)          # how wrong was it?
        optimizer.zero_grad(set_to_none=True)
        loss.backward()                # work out which way to nudge each weight
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)  # no wild jumps
        optimizer.step()               # nudge them

    with open(os.path.join(out_dir, "history.json"), "w") as f:
        json.dump(history, f, indent=2)
    print(f"\nDone in {time.time() - t0:.0f}s. Best val loss {best_val:.3f}. "
          f"Saved to {os.path.relpath(out_dir, here)}/model.pt")
    print("Try it: python generate.py --prompt \"ROMEO:\"")


if __name__ == "__main__":
    main()
