"""
keep_training.py - keep TinyGPT learning in the background, for as long as you like.

Run:
    python keep_training.py                     # train until you stop it
    python keep_training.py --only-when-idle 5  # only while nobody has touched
                                                # the mouse or keyboard for 5 min (Windows)
    python keep_training.py --gpu-share 50      # train half the time, rest for you

On Windows, keep-training-windows.ps1 sets this up to start by itself when
you log in. See the README section "Keep it training".

How it differs from train.py:
  - It picks up where it left off. Every check it saves out/last.pt (the
    weights plus the optimizer's memory), and the next run resumes from it.
  - It never stops on its own. Stop it with Ctrl+C, the STOP file, or the
    Windows script. Make a file called PAUSE in the out folder to pause it.
  - It reads every .txt file in data/, and looks again at each check, so you
    can feed it new text while it runs by dropping files into that folder.
  - It runs at low priority, so the PC stays responsive.

A warning: more training on the same text does not keep making it better.
After a while it starts memorising the text instead of learning patterns
(val loss goes up). It will say so in the log. The fix is more, different
text in data/, not more hours.
"""

import argparse
import contextlib
import glob
import json
import os
import shutil
import subprocess
import sys
import time

import torch

from model import TinyGPT
from train import PRESETS, pick_device

HERE = os.path.dirname(os.path.abspath(__file__))
APP_MODEL = os.path.join(os.path.expanduser("~"), ".local-ai-chat", "models", "tinygpt-shakespeare.bin")


def parse_args():
    p = argparse.ArgumentParser(description="Keep training TinyGPT, resuming each time.")
    p.add_argument("--data", default="data", help="a .txt file, or a folder of them")
    p.add_argument("--out-dir", default="out")
    p.add_argument("--preset", default="auto", choices=["auto", *PRESETS],
                   help="only used when starting fresh; a resumed model keeps its size")
    p.add_argument("--device", default="auto")
    p.add_argument("--eval-every", type=int, default=500, help="steps between checks and saves")
    p.add_argument("--eval-iters", type=int, default=50)
    p.add_argument("--only-when-idle", type=float, default=0, metavar="MINUTES",
                   help="pause while the PC is in use (Windows only; 0 = always train)")
    p.add_argument("--gpu-share", type=int, default=100, metavar="PERCENT",
                   help="rest between steps so training only uses about this much of the time")
    p.add_argument("--export-for-app", action="store_true",
                   help="after each improvement, update the copy the chat app uses")
    return vars(p.parse_args())


def log(msg, path):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    print(line, flush=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def lower_priority():
    """Ask the operating system to run us after everything else."""
    try:
        if sys.platform == "win32":
            import ctypes
            BELOW_NORMAL = 0x4000
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), BELOW_NORMAL)
        else:
            os.nice(10)
    except (OSError, AttributeError):
        pass


def idle_minutes():
    """Minutes since the last mouse or keyboard input, or None if we can't tell."""
    if sys.platform != "win32":
        return None
    import ctypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return None
    millis = (ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF
    return millis / 60000


def read_text(data):
    """All the training text: one file, or every .txt file in a folder (sorted by name)."""
    path = os.path.join(HERE, data)
    files = sorted(glob.glob(os.path.join(path, "**", "*.txt"), recursive=True)) if os.path.isdir(path) else [path]
    parts = []
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            parts.append(fh.read())
    return "\n\n".join(parts), files


def main():
    cfg = parse_args()
    device = pick_device(cfg["device"])
    out_dir = os.path.join(HERE, cfg["out_dir"])
    os.makedirs(out_dir, exist_ok=True)
    log_path = os.path.join(out_dir, "keep-training.log")
    last_path, best_path = os.path.join(out_dir, "last.pt"), os.path.join(out_dir, "model.pt")
    pause_file, stop_file = os.path.join(out_dir, "PAUSE"), os.path.join(out_dir, "STOP")
    if os.path.exists(stop_file):
        os.remove(stop_file)  # a STOP left over from last time shouldn't stop this run
    lower_priority()
    if cfg["only_when_idle"] and idle_minutes() is None:
        log("--only-when-idle only works on Windows, so it will train all the time.", log_path)

    use_bf16 = device == "cuda" and torch.cuda.is_bf16_supported()
    autocast = (lambda: torch.autocast("cuda", dtype=torch.bfloat16)) if use_bf16 else contextlib.nullcontext

    # Resume from the last save, or the best model, or start fresh.
    resume = next((p for p in (last_path, best_path) if os.path.exists(p)), None)
    text, files = read_text(cfg["data"])
    if resume:
        ckpt = torch.load(resume, map_location="cpu")
        chars, mcfg = ckpt["chars"], ckpt["config"]
        step, history = ckpt.get("step", 0), ckpt.get("history", [])
        best_val = ckpt.get("best_val", (ckpt.get("losses") or {}).get("val", float("inf")))
        preset = ckpt.get("preset", "?")
        train_cfg = ckpt.get("train", PRESETS.get(preset, PRESETS["small"]))
    else:
        ckpt, chars, step, history, best_val = None, sorted(set(text)), 0, [], float("inf")
        preset = cfg["preset"] if cfg["preset"] != "auto" else ("rtx4070" if device == "cuda" else "small")
        train_cfg = dict(PRESETS[preset])
        mcfg = {k: train_cfg[k] for k in ("block_size", "n_embd", "n_head", "n_layer", "dropout")}
    stoi = {c: i for i, c in enumerate(chars)}

    model = TinyGPT(len(chars), **mcfg).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=train_cfg["learning_rate"])
    if ckpt:
        model.load_state_dict(ckpt["model"])
        if "optimizer" in ckpt:
            optimizer.load_state_dict(ckpt["optimizer"])
    log(f"{'Resuming from ' + os.path.basename(resume) + f' at step {step}' if resume else 'Starting fresh'}: "
        f"preset {preset}, {model.num_params():,} parameters, on {device}", log_path)

    data_files = None

    def load_data():
        """(Re)read data/. The model's alphabet is fixed once trained, so new characters are skipped."""
        nonlocal data_files, train_data, val_data
        text, files = read_text(cfg["data"])
        stamp = [(f, os.path.getmtime(f)) for f in files]
        if stamp == data_files:
            return
        data_files = stamp
        ids = [stoi[c] for c in text if c in stoi]
        skipped = len(text) - len(ids)
        d = torch.tensor(ids, dtype=torch.long)
        n = int(0.9 * len(d))
        train_data, val_data = d[:n], d[n:]
        log(f"Training text: {len(files)} file(s), {len(ids):,} characters"
            + (f" ({skipped:,} skipped: characters the model has never seen)" if skipped else ""), log_path)
        if len(val_data) <= mcfg["block_size"] + 1:
            raise SystemExit("Not enough text to train on.")

    train_data = val_data = None
    load_data()

    def get_batch(split):
        d = train_data if split == "train" else val_data
        starts = torch.randint(len(d) - mcfg["block_size"] - 1, (train_cfg["batch_size"],))
        x = torch.stack([d[i:i + mcfg["block_size"]] for i in starts])
        y = torch.stack([d[i + 1:i + 1 + mcfg["block_size"]] for i in starts])
        return x.to(device), y.to(device)

    @torch.no_grad()
    def estimate_loss():
        model.eval()
        out = {}
        for split in ("train", "val"):
            losses = torch.zeros(cfg["eval_iters"])
            for i in range(cfg["eval_iters"]):
                x, y = get_batch(split)
                with autocast():
                    losses[i] = model(x, y)[1].item()
            out[split] = losses.mean().item()
        model.train()
        return out

    def save(path, losses):
        torch.save({
            "model": model.state_dict(), "optimizer": optimizer.state_dict(), "chars": chars, "config": mcfg,
            "step": step, "losses": losses, "history": history, "best_val": best_val, "preset": preset,
            "train": train_cfg, "data": cfg["data"],
        }, path + ".tmp")
        os.replace(path + ".tmp", path)  # never leave a half-written file if the PC turns off

    def export_for_app():
        tmp = os.path.join(out_dir, "app-export.bin")
        r = subprocess.run([sys.executable, os.path.join(HERE, "export.py"), "--checkpoint", best_path,
                            "--output", tmp], capture_output=True, text=True)
        if r.returncode == 0:
            os.makedirs(os.path.dirname(APP_MODEL), exist_ok=True)
            shutil.copyfile(tmp, APP_MODEL + ".part")
            os.replace(APP_MODEL + ".part", APP_MODEL)  # swap in one go, so the app never reads half a file
            os.remove(tmp)
            log("Updated the model the chat app uses.", log_path)
        else:
            log("Couldn't export for the app: " + r.stderr.strip().splitlines()[-1], log_path)

    if cfg["export_for_app"] and model.num_params() > 2_000_000:
        log("Note: the chat app runs TinyGPT in plain Python, so a model this size will be very slow there.",
            log_path)

    paused_reason = None
    stale = 0  # checks in a row without a new best val loss
    try:
        while True:
            # Pause while asked to, or while someone is using the PC.
            reason = None
            if os.path.exists(stop_file):
                log("Found the STOP file, stopping.", log_path)
                break
            if os.path.exists(pause_file):
                reason = "the PAUSE file is there"
            elif cfg["only_when_idle"]:
                idle = idle_minutes()
                if idle is not None and idle < cfg["only_when_idle"]:
                    reason = "the PC is in use"
            if reason:
                if reason != paused_reason:
                    log(f"Paused: {reason}.", log_path)
                    if device == "cuda":
                        torch.cuda.empty_cache()  # hand video memory back while paused
                paused_reason = reason
                time.sleep(10)
                continue
            if paused_reason:
                log("Resumed.", log_path)
                paused_reason = None

            t = time.time()
            x, y = get_batch("train")
            with autocast():
                _, loss = model(x, y)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            step += 1
            if cfg["gpu_share"] < 100:
                time.sleep((time.time() - t) * (100 / max(cfg["gpu_share"], 1) - 1))

            if step % cfg["eval_every"] == 0:
                losses = estimate_loss()
                history.append({"step": step, **losses, "time": time.strftime("%Y-%m-%d %H:%M")})
                better = losses["val"] < best_val
                log(f"step {step} | train loss {losses['train']:.3f} | val loss {losses['val']:.3f}"
                    + (" | new best" if better else ""), log_path)
                if better:
                    best_val, stale = losses["val"], 0
                    save(best_path, losses)
                    if cfg["export_for_app"]:
                        export_for_app()
                else:
                    stale += 1
                    if stale == 10:
                        log("Val loss hasn't improved in 10 checks: it is memorising this text now. "
                            "Add more, different .txt files to data/ to keep it learning.", log_path)
                save(last_path, losses)
                with open(os.path.join(out_dir, "history.json"), "w") as f:
                    json.dump(history, f, indent=2)
                load_data()  # pick up any new files in data/
    except KeyboardInterrupt:
        log("Stopped with Ctrl+C.", log_path)
    save(last_path, history[-1] if history else {})
    log(f"Saved at step {step}. Run again to carry on from here.", log_path)


if __name__ == "__main__":
    main()
