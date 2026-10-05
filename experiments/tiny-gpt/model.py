"""
model.py - a tiny GPT-style language model, written from scratch.

A language model does one job: given some text, guess what comes next.
This one works one character at a time. It reads, say, "To be or not to b"
and outputs a score for every possible next character ("e" should win).
Generating text is just doing that over and over.

The pieces, from the bottom up:

    characters -> numbers (the tokenizer, in train.py)
    numbers    -> vectors (embeddings)
    vectors    -> vectors that "know" about earlier characters (Blocks)
    vectors    -> a score for every possible next character (the head)

Only PyTorch is used. Nothing here is downloaded or borrowed from a premade
model: every weight starts as random noise and is learned in train.py.
"""

import math

import torch
import torch.nn as nn
from torch.nn import functional as F


class SelfAttention(nn.Module):
    """Lets every character look back at the characters before it.

    For each position the model makes three vectors:
      query - "what am I looking for?"
      key   - "what do I contain?"
      value - "what will I pass on if someone looks at me?"
    A position compares its query with every earlier key. Good matches get a
    big weight, and the position takes a weighted mix of those values.

    "Multi-head" means we do this several times in parallel with smaller
    vectors, so different heads can learn to track different things
    (one might follow vowels, another line breaks, another names).
    """

    def __init__(self, n_embd, n_head, block_size, dropout):
        super().__init__()
        assert n_embd % n_head == 0, "n_embd must divide evenly by n_head"
        self.n_head = n_head
        # One linear layer makes query, key and value all at once.
        self.qkv = nn.Linear(n_embd, 3 * n_embd)
        # After mixing, one more linear layer blends the heads back together.
        self.proj = nn.Linear(n_embd, n_embd)
        self.dropout = nn.Dropout(dropout)
        # The "causal mask": a lower-triangle of ones. Position 5 may look at
        # positions 0..5 but never 6+, otherwise it could cheat by peeking at
        # the answer it is supposed to predict.
        mask = torch.tril(torch.ones(block_size, block_size))
        self.register_buffer("mask", mask.view(1, 1, block_size, block_size))

    def forward(self, x):
        B, T, C = x.shape  # batch size, sequence length, embedding size
        q, k, v = self.qkv(x).split(C, dim=2)
        # Split each vector into n_head smaller pieces: (B, heads, T, C/heads)
        hs = C // self.n_head
        q = q.view(B, T, self.n_head, hs).transpose(1, 2)
        k = k.view(B, T, self.n_head, hs).transpose(1, 2)
        v = v.view(B, T, self.n_head, hs).transpose(1, 2)

        # How well does each query match each key? Dividing by sqrt(size)
        # keeps the numbers from getting huge as vectors get longer.
        scores = (q @ k.transpose(-2, -1)) / math.sqrt(hs)
        # Hide the future: set scores for later positions to -infinity so
        # softmax turns them into a weight of exactly 0.
        scores = scores.masked_fill(self.mask[:, :, :T, :T] == 0, float("-inf"))
        weights = F.softmax(scores, dim=-1)  # each row now sums to 1
        weights = self.dropout(weights)

        out = weights @ v  # weighted mix of values
        out = out.transpose(1, 2).contiguous().view(B, T, C)  # glue heads back
        return self.dropout(self.proj(out))


class FeedForward(nn.Module):
    """A small two-layer network applied to each position on its own.

    Attention moves information between positions; this part "thinks" about
    what was gathered. It widens to 4x the size, applies a non-linearity
    (GELU), and narrows back down.
    """

    def __init__(self, n_embd, dropout):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_embd, 4 * n_embd),
            nn.GELU(),
            nn.Linear(4 * n_embd, n_embd),
            nn.Dropout(dropout),
        )

    def forward(self, x):
        return self.net(x)


class Block(nn.Module):
    """One transformer layer: attention, then feed-forward.

    Two tricks make deep stacks of these trainable:
      - LayerNorm keeps the numbers in a steady range before each step.
      - "Residual" connections (x = x + ...) mean each layer only has to
        learn a small correction, and the signal can always flow straight
        through.
    """

    def __init__(self, n_embd, n_head, block_size, dropout):
        super().__init__()
        self.ln1 = nn.LayerNorm(n_embd)
        self.attn = SelfAttention(n_embd, n_head, block_size, dropout)
        self.ln2 = nn.LayerNorm(n_embd)
        self.ff = FeedForward(n_embd, dropout)

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        x = x + self.ff(self.ln2(x))
        return x


class TinyGPT(nn.Module):
    """The whole model.

    vocab_size  how many different characters exist in the training text
    block_size  how many characters it can look back at (its "memory")
    n_embd      how long each character's vector is (bigger = smarter, slower)
    n_head      attention heads per layer
    n_layer     how many Blocks are stacked
    dropout     fraction of signals randomly zeroed during training, which
                stops it memorising the text word for word
    """

    def __init__(self, vocab_size, block_size, n_embd, n_head, n_layer, dropout=0.0):
        super().__init__()
        self.block_size = block_size
        # Each character gets a learned vector ("what letter is this?")...
        self.token_emb = nn.Embedding(vocab_size, n_embd)
        # ...and each position gets one too ("where in the line am I?").
        # Attention by itself has no sense of order, so this supplies it.
        self.pos_emb = nn.Embedding(block_size, n_embd)
        self.drop = nn.Dropout(dropout)
        self.blocks = nn.Sequential(
            *[Block(n_embd, n_head, block_size, dropout) for _ in range(n_layer)]
        )
        self.ln_f = nn.LayerNorm(n_embd)
        # The "head": turns each final vector into one score per character.
        self.head = nn.Linear(n_embd, vocab_size)
        self.apply(self._init_weights)

    def _init_weights(self, module):
        # Start every weight as small random noise. Training shapes it.
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
        if isinstance(module, nn.Linear) and module.bias is not None:
            nn.init.zeros_(module.bias)

    def num_params(self):
        return sum(p.numel() for p in self.parameters())

    def forward(self, idx, targets=None):
        """idx: (batch, time) tensor of character ids.

        Returns scores ("logits") for the next character at every position,
        and, if targets are given, the loss: how surprised the model was by
        the real next characters. Training is nothing more than nudging the
        weights to make this number go down.
        """
        B, T = idx.shape
        assert T <= self.block_size, f"input is {T} long, block_size is {self.block_size}"
        pos = torch.arange(T, device=idx.device)
        x = self.drop(self.token_emb(idx) + self.pos_emb(pos))
        x = self.blocks(x)
        logits = self.head(self.ln_f(x))

        loss = None
        if targets is not None:
            # Cross-entropy: low when the model gave the right character a
            # high probability. A model guessing at random over 65 characters
            # scores about ln(65) = 4.17; lower is better.
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens, temperature=1.0, top_k=None):
        """Write new text one character at a time.

        temperature  below 1 = safer, more repetitive; above 1 = wilder
        top_k        only pick among the k most likely characters
        """
        for _ in range(max_new_tokens):
            # Only the last block_size characters fit in the model's memory.
            idx_cond = idx[:, -self.block_size:]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :] / temperature  # scores for the next char
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = float("-inf")
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)  # roll the dice
            idx = torch.cat((idx, next_id), dim=1)
        return idx
