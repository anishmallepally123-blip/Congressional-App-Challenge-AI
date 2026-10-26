"""
Shared Files - lets the user share folders (like the Desktop) so the local AI can
read them, answer questions about them, and make better organizing plans.

How it works:
  1. The user opts in by sharing a folder on the /files page. Nothing is read before that.
  2. index_folder() reads the text out of the files (documents, slides, spreadsheets,
     PDFs, notes, code) and keeps it in a small index on this computer.
  3. context_for() finds the passages that match the user's chat message, so the
     chatbot can hand them to the model along with the question.
  4. Unsharing deletes the index for that folder. The files themselves are untouched.

Privacy and safety:
  - Opt-in per folder, and the same system-folder rules as the organizer apply.
  - Read-only: this module never changes, moves or deletes the user's files.
  - Everything stays on this computer. Text goes only to the local Ollama model.
  - Files that look private (passwords, keys, wallets) are listed by name but never read.

Standard library only. If the optional "pypdf" package is installed, PDFs are read
more accurately; without it, a simple built-in reader handles most PDFs.
"""

import html
import json
import math
import os
import re
import threading
import time
import zipfile
import zlib
from collections import Counter
from datetime import datetime

import organizer

DATA_DIR = os.path.join(organizer.DATA_DIR, "files")
CONFIG_PATH = os.path.join(DATA_DIR, "shared.json")
INDEX_PATH = os.path.join(DATA_DIR, "index.json")

MAX_FILES = 3000              # per shared folder
MAX_DEPTH = 4                 # how many subfolders deep to look
MAX_FILE_BYTES = 25_000_000   # bigger files are listed but not read
MAX_TEXT = 20_000             # characters kept per file
RESCAN_AFTER = 60             # seconds before a chat message triggers a quick re-check
CONTEXT_CHARS = 4_000         # how much file text goes to the model per question

TEXT_EXTS = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".log", ".xml", ".yaml", ".yml", ".ini",
    ".html", ".htm", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".cs",
    ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".sql", ".sh", ".bat", ".tex", ".rtf",
}
PRIVATE_NAME = re.compile(r"password|passwd|secret|id_rsa|id_ed25519|recovery.?code|seed.?phrase|\.env$", re.I)
PRIVATE_EXTS = {".pem", ".key", ".p12", ".pfx", ".kdbx", ".keychain", ".wallet", ".gpg", ".asc", ".ovpn"}
SKIP_DIRS = {"node_modules", "__pycache__", "venv", ".venv", "$RECYCLE.BIN", "System Volume Information"}

_lock = threading.Lock()
_search_cache = {"stamp": None, "chunks": [], "df": Counter(), "avg": 1.0}


# ---------- Getting text out of files ----------

def _xml_text(data, para_tag):
    """Text from Office XML: keeps paragraph breaks, drops all tags."""
    text = data.decode("utf-8", "replace")
    text = re.sub(rf"</{para_tag}>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text)


def _read_docx(path):
    with zipfile.ZipFile(path) as z:
        return _xml_text(z.read("word/document.xml"), "w:p")


def _read_pptx(path):
    with zipfile.ZipFile(path) as z:
        slides = sorted(
            (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        return "\n\n".join(f"[Slide {i}]\n" + _xml_text(z.read(n), "a:p") for i, n in enumerate(slides, 1))


def _read_xlsx(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            xml = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
            for si in re.findall(r"<si>(.*?)</si>", xml, re.S):
                shared.append(html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
        out = []
        sheets = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        for n in sheets:
            xml = z.read(n).decode("utf-8", "replace")
            out.append(f"[{os.path.basename(n)[:-4]}]")
            for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
                cells = []
                for attrs, body in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
                    v = re.search(r"<v>(.*?)</v>", body, re.S)
                    inline = re.search(r"<t[^>]*>(.*?)</t>", body, re.S)
                    if 't="s"' in attrs and v and v.group(1).isdigit() and int(v.group(1)) < len(shared):
                        cells.append(shared[int(v.group(1))])
                    elif inline:
                        cells.append(html.unescape(inline.group(1)))
                    elif v:
                        cells.append(v.group(1))
                if cells:
                    out.append(" | ".join(cells))
        return "\n".join(out)


def _read_odf(path):
    with zipfile.ZipFile(path) as z:
        return _xml_text(z.read("content.xml"), "text:p")


def _read_pdf(path):
    try:
        import pypdf  # optional, more accurate
        reader = pypdf.PdfReader(path)
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:50])
        if text.strip():
            return text
    except Exception:  # not installed, or it couldn't parse this file
        pass
    # Simple built-in reader: unpack the page streams and collect the text drawing commands.
    with open(path, "rb") as f:
        raw = f.read()
    pieces = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S):
        data = m.group(1)
        try:
            data = zlib.decompress(data)
        except zlib.error:
            pass
        for block in re.findall(rb"BT(.*?)ET", data, re.S):
            line = []
            for s in re.findall(rb"\((.*?)(?<!\\)\)", block, re.S):
                s = re.sub(rb"\\([nrt()\\])", lambda e: {b"n": b"\n", b"r": b"", b"t": b"\t"}.get(e.group(1), e.group(1)), s)
                line.append(s.decode("latin-1"))
            if line:
                pieces.append("".join(line))
    text = "\n".join(pieces)
    # Fonts that store text as codes come out as gibberish; keep only readable results.
    readable = sum(c.isalnum() or c.isspace() for c in text)
    return text if text and readable / len(text) > 0.8 else ""


def _read_plain(path):
    with open(path, "rb") as f:
        data = f.read(MAX_TEXT * 4)
    text = data.decode("utf-8", "replace")
    ext = os.path.splitext(path)[1].lower()
    if ext in (".html", ".htm", ".xml"):
        text = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", text)))
    elif ext == ".rtf":
        text = re.sub(r"\\[a-z]+-?\d* ?|[{}]", "", text)
    return text


def _read_notebook(path):
    with open(path, encoding="utf-8") as f:
        nb = json.load(f)
    return "\n\n".join("".join(c.get("source", "")) for c in nb.get("cells", []))


READERS = {
    ".docx": _read_docx, ".pptx": _read_pptx, ".xlsx": _read_xlsx, ".pdf": _read_pdf,
    ".odt": _read_odf, ".odp": _read_odf, ".ods": _read_odf, ".ipynb": _read_notebook,
}


def is_private(name):
    return bool(PRIVATE_NAME.search(name)) or os.path.splitext(name)[1].lower() in PRIVATE_EXTS


def extract_text(path):
    """Readable text from a file, or "" if it can't be read (pictures, apps, private files)."""
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    if is_private(name):
        return ""
    reader = READERS.get(ext) or (_read_plain if ext in TEXT_EXTS else None)
    if reader is None:
        return ""
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return ""
        text = reader(path)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, zlib.error, RecursionError):
        return ""
    except Exception:  # a damaged file must never break the app
        return ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return text[:MAX_TEXT]


# ---------- Which folders are shared ----------

def _load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def _save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def shared_folders():
    return _load_json(CONFIG_PATH, {"folders": []})["folders"]


def share(path):
    """Opt a folder in and read it. Returns its status."""
    root = organizer.check_folder(path)
    with _lock:
        folders = shared_folders()
        if root not in folders:
            folders.append(root)
            _save_json(CONFIG_PATH, {"folders": folders})
    index_folder(root)
    return next(s for s in status() if s["folder"] == root)


def unshare(path):
    """Stop sharing a folder and forget everything read from it."""
    root = os.path.realpath(os.path.expanduser(path))
    with _lock:
        _save_json(CONFIG_PATH, {"folders": [f for f in shared_folders() if f != root]})
        index = _load_json(INDEX_PATH, {})
        index.pop(root, None)
        _save_json(INDEX_PATH, index)
        _search_cache["stamp"] = None


def is_shared(path):
    full = os.path.realpath(path)
    return any(full == f or full.startswith(f.rstrip(os.sep) + os.sep) for f in shared_folders())


# ---------- Reading a shared folder into the index ----------

def _walk(root):
    """Yield (full path, depth) for files under root, skipping hidden and system clutter."""
    stack = [(root, 0)]
    while stack:
        folder, depth = stack.pop()
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name.lower())
        except OSError:
            continue
        for e in entries:
            if e.name.startswith(".") or e.name in SKIP_DIRS or e.name.lower() in ("desktop.ini", "thumbs.db"):
                continue
            if e.is_dir(follow_symlinks=False):
                if depth < MAX_DEPTH and not e.name.endswith((".app", ".photoslibrary")):
                    stack.append((e.path, depth + 1))
            elif e.is_file(follow_symlinks=False):
                yield e


def index_folder(root):
    """(Re)read a shared folder. Unchanged files reuse what was read last time, so this is quick."""
    with _lock:
        index = _load_json(INDEX_PATH, {})
        old = {f["rel"]: f for f in index.get(root, {}).get("files", [])}
        files, truncated = [], False
        for e in _walk(root):
            if len(files) >= MAX_FILES:
                truncated = True
                break
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            rel = os.path.relpath(e.path, root).replace(os.sep, "/")
            prev = old.get(rel)
            if prev and prev["size"] == st.st_size and prev["mtime"] == st.st_mtime:
                files.append(prev)
                continue
            files.append({
                "rel": rel,
                "size": st.st_size,
                "mtime": st.st_mtime,
                "private": is_private(e.name),
                "text": extract_text(e.path),
            })
        index[root] = {"scanned": time.time(), "files": files, "truncated": truncated}
        _save_json(INDEX_PATH, index)
        _search_cache["stamp"] = None
    return index[root]


def refresh(max_age=RESCAN_AFTER):
    """Re-check shared folders that haven't been looked at recently."""
    index = _load_json(INDEX_PATH, {})
    for root in shared_folders():
        if not os.path.isdir(root):
            continue
        if time.time() - index.get(root, {}).get("scanned", 0) > max_age:
            index_folder(root)


def status():
    index = _load_json(INDEX_PATH, {})
    out = []
    for root in shared_folders():
        entry = index.get(root, {"files": [], "scanned": None})
        files = entry["files"]
        out.append({
            "folder": root,
            "files": len(files),
            "read": sum(1 for f in files if f["text"]),
            "private": sum(1 for f in files if f.get("private")),
            "scanned": entry.get("scanned"),
            "truncated": entry.get("truncated", False),
            "missing": not os.path.isdir(root),
        })
    return out


# ---------- Finding the right passages ----------

WORD = re.compile(r"[a-z0-9]+")
STOP = set(
    "a an and are as at be but by can do does for from has have how i if in is it its me my of on or so "
    "that the their them there these this to was what when where which who why will with you your about "
    "any all file files folder desktop find show tell please did get got".split()
)


def _tokens(text):
    out = []
    for w in WORD.findall(text.lower()):
        if w in STOP or len(w) < 2:
            continue
        # light stemming so "essays" matches "essay" and "notes" matches "note"
        if len(w) > 4:
            if w.endswith("ing"):
                w = w[:-3]
            elif w.endswith(("sses", "xes", "zes", "ches", "shes")):
                w = w[:-2]  # classes, boxes, quizzes, sketches
            elif w.endswith("s") and not w.endswith("ss"):
                w = w[:-1]
        out.append(w)
    return out


def _chunks(root, f):
    """Split a file into ~700 character passages. The file name is part of every passage."""
    label = f"{os.path.basename(root)}/{f['rel']}"
    name_words = " ".join(re.split(r"[\W_]+", f["rel"]))
    text = f["text"]
    if not text:
        return [(label, "", name_words)]
    paras, chunks, cur = text.split("\n\n"), [], ""
    for p in paras:
        if len(cur) + len(p) > 700 and cur:
            chunks.append(cur)
            cur = ""
        cur += p[:2000] + "\n\n"
    if cur.strip():
        chunks.append(cur)
    return [(label, c.strip(), name_words) for c in chunks]


def _build_search():
    stamp = os.path.getmtime(INDEX_PATH) if os.path.exists(INDEX_PATH) else None
    if stamp == _search_cache["stamp"]:
        return _search_cache
    index = _load_json(INDEX_PATH, {})
    chunks, df = [], Counter()
    for root in shared_folders():
        for f in index.get(root, {}).get("files", []):
            for label, text, name_words in _chunks(root, f):
                # file name words count three times: names are often the best clue
                toks = Counter(_tokens(text) + _tokens(name_words) * 3)
                chunks.append({"label": label, "text": text, "tf": toks, "len": sum(toks.values()) or 1,
                               "mtime": f["mtime"], "size": f["size"]})
                df.update(toks.keys())
    _search_cache.update(stamp=stamp, chunks=chunks, df=df,
                         avg=sum(c["len"] for c in chunks) / max(len(chunks), 1))
    return _search_cache


def search(query, limit=6):
    """Best matching passages for a question (BM25 ranking, the classic search-engine formula)."""
    s = _build_search()
    q = set(_tokens(query))
    if not q or not s["chunks"]:
        return []
    n = len(s["chunks"])
    scored = []
    for c in s["chunks"]:
        score = 0.0
        for t in q:
            tf = c["tf"].get(t)
            if tf:
                idf = math.log(1 + (n - s["df"][t] + 0.5) / (s["df"][t] + 0.5))
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * c["len"] / s["avg"]))
        if score > 0:
            scored.append((score, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    results, per_file = [], Counter()
    for score, c in scored:
        if per_file[c["label"]] >= 2:  # at most two passages from one file
            continue
        per_file[c["label"]] += 1
        results.append({"file": c["label"], "text": c["text"], "score": round(score, 2)})
        if len(results) >= limit:
            break
    return results


def overview(limit=40):
    """A short description of what's shared: counts by type and the newest files."""
    index = _load_json(INDEX_PATH, {})
    lines, kinds, recent = [], Counter(), []
    for root in shared_folders():
        files = index.get(root, {}).get("files", [])
        lines.append(f"- {root}: {len(files)} files")
        for f in files:
            kinds[os.path.splitext(f["rel"])[1].lower() or "(no extension)"] += 1
            recent.append((f["mtime"], f"{os.path.basename(root)}/{f['rel']}", f["size"]))
    if not lines:
        return ""
    recent.sort(reverse=True)
    lines.append("File types: " + ", ".join(f"{k} x{v}" for k, v in kinds.most_common(12)))
    lines.append(f"Most recently changed files (newest first, up to {limit}):")
    for mtime, label, size in recent[:limit]:
        lines.append(f"- {label} ({organizer._human_size(size)}, {datetime.fromtimestamp(mtime):%Y-%m-%d})")
    return "\n".join(lines)


def context_for(messages):
    """
    Text to add to the chatbot's system prompt so the model can use the shared files.
    Returns (text, list of source file names). Returns ("", []) when nothing is shared.
    """
    if not shared_folders():
        return "", []
    try:
        refresh()
    except OSError:
        pass
    question = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
    hits, used, budget = search(question), [], CONTEXT_CHARS
    excerpts = []
    for h in hits:
        if budget <= 0:
            break
        text = h["text"][:budget] if h["text"] else "(no readable text; only the name matched)"
        budget -= len(text)
        excerpts.append(f"[{h['file']}]\n{text}")
        if h["file"] not in used:
            used.append(h["file"])
    parts = [
        "The user has shared some folders from this computer with you, read-only. "
        "Use them when the question is about the user's files, and say which file "
        "an answer came from. If the files don't contain the answer, say so. "
        "You can't open, change, move or delete files yourself; for tidying up, "
        "suggest the Organize a folder page.",
        "Shared folders:\n" + overview(),
    ]
    if excerpts:
        parts.append("Passages from files that match the user's latest message:\n\n" + "\n\n".join(excerpts))
    return "\n\n".join(parts), used


def peek(path, chars=300):
    """A short preview of a file's text, only if it is inside a shared folder (used by the organizer)."""
    if not is_shared(path):
        return ""
    text = extract_text(path)
    return re.sub(r"\s+", " ", text)[:chars]
