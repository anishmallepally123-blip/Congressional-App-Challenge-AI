"""
Makes QR codes, so a phone can open the app by pointing its camera at the screen
instead of typing an address and a code. Standard library only.

It follows the QR Code standard (ISO 18004) for short text: byte mode, medium
error correction (about 15% of the code can be smudged or covered), versions 1
to 6 (up to 106 characters, plenty for a web address). The approach follows
Project Nayuki's well-known public-domain QR generator.
"""

# Error-correction codewords per block and number of blocks for level M, versions 1-6.
ECC_PER_BLOCK = [None, 10, 16, 26, 18, 24, 16]
NUM_BLOCKS = [None, 1, 1, 1, 2, 2, 4]
FORMAT_LEVEL_M = 0  # the 2 bits that mean "level M" in the format information


def _raw_modules(version):
    """How many squares in this version hold data (everything but the fixed patterns)."""
    n = (16 * version + 128) * version + 64
    if version >= 2:
        align = version // 7 + 2
        n -= (25 * align - 10) * align - 55
    return n


def _data_capacity(version):
    return _raw_modules(version) // 8 - ECC_PER_BLOCK[version] * NUM_BLOCKS[version]


# ---------- Reed-Solomon error correction ----------

def _gf_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


# ---------- Building the code ----------

def _codewords(data, version):
    """The message bytes plus error correction, interleaved the way the standard says."""
    bits = [0, 1, 0, 0] + [(len(data) >> i) & 1 for i in reversed(range(8))]  # byte mode + length
    for b in data:
        bits += [(b >> i) & 1 for i in reversed(range(8))]
    capacity = _data_capacity(version) * 8
    bits += [0] * min(4, capacity - len(bits))  # terminator
    bits += [0] * (-len(bits) % 8)
    words = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = 0xEC
    while len(words) < capacity // 8:
        words.append(pad)
        pad ^= 0xEC ^ 0x11

    blocks_n, ecc_len = NUM_BLOCKS[version], ECC_PER_BLOCK[version]
    raw = _raw_modules(version) // 8
    short_n = blocks_n - raw % blocks_n
    short_len = raw // blocks_n
    divisor = _rs_divisor(ecc_len)
    blocks, k = [], 0
    for i in range(blocks_n):
        dat = words[k:k + short_len - ecc_len + (0 if i < short_n else 1)]
        k += len(dat)
        ecc = _rs_remainder(dat, divisor)
        if i < short_n:
            dat = dat + [0]
        blocks.append(dat + ecc)
    out = []
    for i in range(len(blocks[0])):
        for j, block in enumerate(blocks):
            if i != short_len - ecc_len or j >= short_n:
                out.append(block[i])
    return out


MASKS = [
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
]


class _Grid:
    def __init__(self, version):
        self.size = version * 4 + 17
        self.dark = [[False] * self.size for _ in range(self.size)]
        self.fixed = [[False] * self.size for _ in range(self.size)]  # finder, timing, format...
        self._draw_fixed(version)

    def set(self, x, y, dark):
        self.dark[y][x] = dark
        self.fixed[y][x] = True

    def _draw_fixed(self, version):
        size = self.size
        for i in range(size):
            self.set(6, i, i % 2 == 0)
            self.set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (size - 4, 3), (3, size - 4)):  # the three big corner squares
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < size and 0 <= y < size:
                        self.set(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        if version >= 2:  # one small alignment square (versions up to 6 have just one)
            pos = [6, size - 7]
            for i, ax in enumerate(pos):
                for j, ay in enumerate(pos):
                    if (i, j) in ((0, 0), (0, 1), (1, 0)):
                        continue
                    for dy in range(-2, 3):
                        for dx in range(-2, 3):
                            self.set(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format(0)  # reserve the format areas; drawn for real once the mask is chosen

    def draw_format(self, mask):
        data = FORMAT_LEVEL_M << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        bit = lambda i: (bits >> i) & 1 == 1  # noqa: E731
        size = self.size
        for i in range(6):
            self.set(8, i, bit(i))
        self.set(8, 7, bit(6))
        self.set(8, 8, bit(7))
        self.set(7, 8, bit(8))
        for i in range(9, 15):
            self.set(14 - i, 8, bit(i))
        for i in range(8):
            self.set(size - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self.set(8, size - 15 + i, bit(i))
        self.set(8, size - 8, True)  # always dark

    def draw_data(self, words):
        size, i = self.size, 0
        right = size - 1
        while right >= 1:  # two columns at a time, zigzagging up and down
            if right == 6:
                right = 5
            for vert in range(size):
                for j in range(2):
                    x = right - j
                    y = size - 1 - vert if (right + 1) & 2 == 0 else vert
                    if not self.fixed[y][x] and i < len(words) * 8:
                        self.dark[y][x] = (words[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            right -= 2

    def apply_mask(self, mask):
        for y in range(self.size):
            for x in range(self.size):
                if not self.fixed[y][x] and MASKS[mask](x, y):
                    self.dark[y][x] = not self.dark[y][x]

    def penalty(self):
        """How hard this pattern is for cameras to read (the standard's scoring rules)."""
        size, score = self.size, 0
        lines = self.dark + [list(col) for col in zip(*self.dark)]
        for line in lines:
            run = 1
            for a, b in zip(line, line[1:] + [None]):
                if a == b:
                    run += 1
                else:
                    if run >= 5:
                        score += run - 2
                    run = 1
            text = "".join("1" if d else "0" for d in line)
            for pattern in ("10111010000", "00001011101"):
                score += 40 * sum(1 for i in range(len(text) - 10) if text[i:i + 11] == pattern)
        for y in range(size - 1):
            for x in range(size - 1):
                c = self.dark[y][x]
                if c == self.dark[y][x + 1] == self.dark[y + 1][x] == self.dark[y + 1][x + 1]:
                    score += 3
        dark = sum(map(sum, self.dark))
        total = size * size
        score += max(0, (abs(dark * 20 - total * 10) + total - 1) // total - 1) * 10  # far from half dark
        return score


def matrix(text, mask=None):
    """The QR code for some text, as rows of True (dark) and False (light) squares.
    The mask (0-7) is normally picked automatically, choosing the easiest one to scan."""
    data = text.encode("utf-8")
    version = next((v for v in range(1, 7) if len(data) + 2 <= _data_capacity(v)), None)
    if version is None:
        raise ValueError("Text is too long for a QR code here (106 characters at most).")
    words = _codewords(data, version)
    best = None
    for m in range(8) if mask is None else [mask]:
        grid = _Grid(version)
        grid.draw_data(words)
        grid.apply_mask(m)
        grid.draw_format(m)
        score = grid.penalty()
        if best is None or score < best[0]:
            best = (score, grid)
    return best[1].dark


def svg(text, border=4):
    """The QR code as an SVG picture, with the light margin cameras need around it."""
    rows = matrix(text)
    size = len(rows) + border * 2
    path = "".join(f"M{x + border},{y + border}h1v1h-1z" for y, row in enumerate(rows) for x, d in enumerate(row) if d)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
            f'<rect width="100%" height="100%" fill="#fff"/><path d="{path}" fill="#000"/></svg>')
