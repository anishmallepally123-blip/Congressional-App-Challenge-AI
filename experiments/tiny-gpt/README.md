# TinyGPT: a language model built from scratch

This folder is an experiment, separate from the main app. Instead of
downloading a premade model like Qwen or Gemma, it builds a small GPT-style
model in about 200 lines of PyTorch and trains it from random noise on a
text file. Every weight it ends up with was learned here.

## Be realistic about what it is

| | TinyGPT (small) | TinyGPT (medium) | Qwen3 8B (in the app) |
|---|---|---|---|
| Parameters | 0.8 million | 10.8 million | 8,000 million |
| Training text | 1 MB of Shakespeare | same | trillions of words |
| Training time | ~7 min on a 4-core CPU | ~1 hour on a GPU (estimate) | months on thousands of GPUs |
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
- **The medium preset.** `--preset medium` is the size of the model in
  Andrej Karpathy's well-known "Let's build GPT" lesson. Use it on a GPU.
- **Creativity.** `python generate.py --temperature 1.2` for wilder text,
  `0.5` for safer, more repetitive text.

Good experiments for a write-up: plot `out/history.json` (loss over time),
compare 2 vs 4 vs 8 layers, or train on two different authors and compare.

## GPU

`train.py` uses an NVIDIA GPU (`cuda`) or an Apple Silicon GPU (`mps`)
automatically if PyTorch can see one, otherwise the CPU. Force one with
`--device cpu`. The free GPU in Google Colab works: upload this folder and
run the same commands.

## What was and wasn't tested

- Tested: the small preset, trained start to finish on a 4-core Linux CPU
  (7 min 14 s, final val loss 1.666), then `generate.py` on the result.
- Not tested: NVIDIA or Apple GPUs, Windows, macOS, the medium preset's full
  run. Times for those are estimates.

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
