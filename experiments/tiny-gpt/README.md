# TinyGPT: a language model built from scratch

This folder is an experiment, separate from the main app. Instead of
downloading a premade model like Qwen or Gemma, it builds a small GPT-style
model in about 200 lines of PyTorch and trains it from random noise on a
text file. Every weight it ends up with was learned here.

## Be realistic about what it is

| | TinyGPT (small) | TinyGPT (rtx4070) | Qwen3 8B (in the app) |
|---|---|---|---|
| Parameters | 0.8 million | 25 million | 8,000 million |
| Training text | 1 MB of Shakespeare | same | trillions of words |
| Training time | ~7 min on a 4-core CPU | ~10-20 min on an RTX 4070 (estimate) | months on thousands of GPUs |
| What it can do | writes text that *looks* like Shakespeare | spells most words right, keeps the play format | answers questions, writes code |

It will not answer questions or hold a conversation. What it does show is
that it genuinely learns: it starts out typing random symbols and, within a
few minutes, picks up spelling, character names, line breaks and the shape
of a play, all from nothing but the raw text.

## Try it

You need Python 3.9+ and PyTorch.

```bash
cd experiments/tiny-gpt
pip install -r requirements.txt
python train.py
python generate.py --prompt "ROMEO:"
```

`train.py` prints a progress report every 250 steps. Here is what our test
run (4-core cloud CPU, default settings) printed:

**Step 0, before any training (loss 4.17):**
```
W&ujFlQJZEWvjxivEyJ&E$EiJgbzI:,,?$GD::GkASfUj kCLU  LZ a$BZrCLhGroUiNjUg
```

**Step 1000, about 3.5 minutes in (loss 1.84):**
```
LEO:
Fram is roum a made, the should last of the hols;
Them on thou came my his blance offlenced
```

**Step 2000, done (loss 1.67):**
```
DUKE VINCENTIO:
Present us no fair curse, and my neitle and from harms,
That me furth, his show chall at and the to consist of the killy,
```

The **loss** is how surprised the model is by the real next character. A
model guessing at random over the 65 characters in Shakespeare scores
ln(65) = 4.17, which is exactly where it starts. Lower is better.

## How it works, file by file

**`model.py`: the model.** Read it top to bottom; every part is commented.

1. **Tokenizer.** Each distinct character in the text gets a number
   (`a` = 39, `b` = 40 ...). This one is character-level, which keeps it
   simple. Big models use pieces of words instead.
2. **Embeddings.** Each number becomes a list of 128 numbers (a vector) the
   model learns. A second vector says where in the line the character is.
3. **Self-attention.** Each character looks back at the ones before it and
   decides which matter. In "To be or not to b", the last `b` should pay
   attention to the earlier "to be". A mask stops it peeking at the future.
4. **Feed-forward.** A small network per position that processes what
   attention gathered.
5. **Blocks.** Attention plus feed-forward is one layer. The small preset
   stacks 4.
6. **Head.** The final vector becomes a score for each of the 65 characters.
   The highest-scoring one is the model's guess.

**`train.py`: the learning.** It picks random 128-character chunks, asks the
model to predict each next character, measures the loss, and uses
backpropagation plus the AdamW optimizer to nudge all 826,433 weights a tiny
bit toward a better guess. Repeat 2,000 times. 10% of the text is held back
so you can see whether it is learning patterns (both losses drop) or just
memorising (train loss drops, val loss climbs).

**`generate.py`: the writing.** Feeds in your prompt, takes the model's
scores for the next character, rolls weighted dice to pick one, adds it, and
repeats.

## Things to change and try

All settings are at the top of `train.py`, and any of them can be set on
the command line.

- **Your own text.** Put any `.txt` file in `data/` and run
  `python train.py --data data/yourfile.txt`. Song lyrics, your own essays,
  a public-domain book from Project Gutenberg, or code all work. Aim for at
  least 200 KB; tiny files just get memorised.
- **Train longer.** `--max-iters 5000`. Watch whether val loss keeps falling.
- **Make it bigger.** `--n-layer 6 --n-embd 192` (n-embd must divide evenly
  by n-head). Bigger learns more but runs slower and memorises small files.
- **Other presets.** `--preset medium` (10.8M) is the size of the model in
  Andrej Karpathy's well-known "Let's build GPT" lesson.
- **Creativity.** `python generate.py --temperature 1.2` for wilder text,
  `0.5` for safer, more repetitive text.

Good experiments for a write-up: plot `out/history.json` (loss over time),
compare 2 vs 4 vs 8 layers, or train on two different authors and compare.

## Your PC: RTX 4070 + 32 GB RAM

There is a preset made for this machine, `rtx4070`: 8 layers, 512-wide
vectors, 8 attention heads, 256 characters of memory, about 25 million
parameters. It should use only 3-4 GB of the card's 12 GB, so you have room
to grow it. On that GPU `train.py` also does most of its math in bfloat16
(16-bit numbers), which RTX 40 cards run about twice as fast, and uses
PyTorch's fast "flash" attention.

**1. Install the GPU version of PyTorch.** Plain `pip install torch` on
Windows gives you the CPU-only version, which ignores the 4070. Use:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu126
```

Check it worked; this should print `True NVIDIA GeForce RTX 4070`:

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

**2. Train.** `python train.py` now picks `rtx4070` by itself when it finds
an NVIDIA GPU. The first line it prints should say
`Preset rtx4070: 25,417,793 parameters, training on cuda (NVIDIA GeForce RTX 4070, bfloat16)`.

**3. Push it further.** Things to try, one at a time so you can tell what
helped:
- `--n-layer 12` (about 38M parameters)
- `--batch-size 128` (uses more video memory, smoother learning)
- `--block-size 512` (remembers twice as far back)
- `--max-iters 10000`

Watch the two losses. 1 MB of Shakespeare is small for a 25M-parameter
model, so at some point val loss will stop falling and start rising while
train loss keeps dropping. That means it is memorising. `train.py` always
keeps the checkpoint with the best val loss, so overtraining won't ruin the
saved model. The real fix is more text (see "Ideas for later"); with
32 GB of RAM you can load a few hundred MB without trouble.

If you see `CUDA out of memory`, lower `--batch-size` or `--block-size`.

Other machines: `train.py` also uses an Apple Silicon GPU (`mps`) or falls
back to the CPU, where it picks the `small` preset. Force either with
`--device cpu` or `--preset small`.

## What was and wasn't tested

- Tested: the small preset, trained start to finish on a 4-core Linux CPU
  (7 min 14 s, final val loss 1.666), then `generate.py` on the result.
- Tested: the `rtx4070` preset builds and trains for 20 steps on CPU, and the
  fast attention gives the same answers as the step-by-step version.
- Not tested: any real GPU, including the RTX 4070 and its bfloat16 path,
  Windows, or macOS. The 4070 training time and memory use are estimates.

## Credits

The design follows the standard GPT architecture (Radford et al., 2018/2019)
and is modelled on Andrej Karpathy's open-source nanoGPT teaching code. The
training text is Shakespeare (public domain), from Karpathy's
"tinyshakespeare" file. This code was written with help from Claude, an AI
assistant; list that in your app challenge disclosure.

## Ideas for later

- **Bigger data.** A few hundred MB of public-domain books (Project
  Gutenberg) and the medium preset gets noticeably better.
- **Word-piece tokenizer.** Swap the character tokenizer for byte-pair
  encoding so it reads whole word chunks.
- **Run it in the app via Ollama.** Ollama loads GGUF files. That would mean
  rewriting the model to match a supported architecture (such as Llama) and
  converting the weights with llama.cpp's tools. Doable, but a project in
  itself.
