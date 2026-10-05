"""
Files connector: lets the AI list, read, search and save files in ONE folder you choose.

    python files_server.py <folder>

It can't see anything outside that folder. It reads plain text files and Word
documents (.docx); other files are listed but not opened. Saving a file always asks
first unless you chose "Always allow" for it.

Also used for Google Drive, OneDrive, Dropbox and iCloud: their desktop apps keep a
copy of your files in a folder on this computer, so pointing this at that folder lets
the AI read them with no sign-in.
"""

import datetime
import os
import re
import sys
import zipfile

from mcp_server import Server, ToolError, setup_error

MAX_READ = 20000
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".Trash", "$RECYCLE.BIN", ".venv"}
TEXT_EXT = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".py", ".js", ".ts", ".html", ".htm", ".css",
    ".xml", ".yaml", ".yml", ".ini", ".cfg", ".toml", ".log", ".java", ".c", ".cpp", ".h", ".cs", ".go",
    ".rs", ".rb", ".php", ".sh", ".bat", ".ps1", ".sql", ".tex", ".rtf", ".srt", ".ics",
}


def find_root():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        setup_error("Choose a folder: put its full path as the argument (for example ~/Documents).")
    root = os.path.realpath(os.path.expanduser(sys.argv[1].strip()))
    if not os.path.isdir(root):
        setup_error(f"The folder {root} doesn't exist. Change the argument to a folder on this computer.")
    return root


ROOT = find_root() if __name__ == "__main__" else None
server = Server("files")


def resolve(path):
    """Turn a path the model gave into a real path inside ROOT, or refuse."""
    path = (path or "").strip().strip('"')
    if path in ("", ".", "/", "\\"):
        return ROOT
    full = os.path.realpath(os.path.join(ROOT, os.path.expanduser(path)))
    if os.path.commonpath([full, ROOT]) != ROOT:
        raise ToolError(f"That's outside the folder this connector can use ({ROOT}).")
    return full


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def size_text(n):
    for unit in ("bytes", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "bytes" else f"{n:.1f} {unit}"
        n /= 1024


def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    for a, b in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&")):
        text = text.replace(a, b)
    return text


def read_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".docx":
        return docx_text(path)
    with open(path, "rb") as f:
        raw = f.read(MAX_READ * 4)
    if ext not in TEXT_EXT and b"\0" in raw[:4096]:
        raise ToolError(f"{rel(path)} isn't a text file, so it can't be read here.")
    return raw.decode("utf-8", "replace")


@server.tool("List a folder", read_only=True,
             description="List the files and folders inside a folder (default: the top folder).",
             params={"path": ("string", "Folder path relative to the top folder; leave empty for the top")})
def list_folder(path=""):
    folder = resolve(path)
    if not os.path.isdir(folder):
        raise ToolError(f"{path} isn't a folder.")
    rows = []
    for entry in sorted(os.scandir(folder), key=lambda e: (not e.is_dir(), e.name.lower())):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            rows.append(f"[folder] {entry.name}/")
        else:
            st = entry.stat()
            when = datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d")
            rows.append(f"{entry.name}  ({size_text(st.st_size)}, changed {when})")
        if len(rows) >= 200:
            rows.append("... (more not shown)")
            break
    where = rel(folder) if folder != ROOT else "the top folder"
    return f"In {where}:\n" + ("\n".join(rows) or "(empty)")


@server.tool("Read a file", read_only=True,
             description="Read a text file or Word document (.docx) and return its text.",
             params={"path": ("string", "File path relative to the top folder")}, required=["path"])
def read_file(path):
    full = resolve(path)
    if not os.path.isfile(full):
        raise ToolError(f"There's no file called {path}. Use list_folder or search_files to find it.")
    text = read_text(full)
    if len(text) > MAX_READ:
        text = text[:MAX_READ] + f"\n[... only the first {MAX_READ} characters are shown]"
    return text


@server.tool("Search files", read_only=True,
             description="Find files whose name or text contains some words. Searches all folders inside the top folder.",
             params={"query": ("string", "Words to look for"),
                     "names_only": ("boolean", "True to only match file names, not what's inside")},
             required=["query"])
def search_files(query, names_only=False):
    words = [w.lower() for w in query.split() if w]
    if not words:
        raise ToolError("Give some words to search for.")
    hits, checked = [], 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            path = os.path.join(dirpath, name)
            if all(w in name.lower() for w in words):
                hits.append(f"{rel(path)}  (name matches)")
            elif not names_only and checked < 3000:
                ext = os.path.splitext(name)[1].lower()
                if ext not in TEXT_EXT and ext != ".docx":
                    continue
                if os.path.getsize(path) > 2_000_000:
                    continue
                checked += 1
                try:
                    text = read_text(path).lower()
                except (OSError, ToolError, zipfile.BadZipFile, KeyError):
                    continue
                if all(w in text for w in words):
                    i = text.find(words[0])
                    snippet = " ".join(text[max(0, i - 60):i + 100].split())
                    hits.append(f"{rel(path)}: ...{snippet}...")
            if len(hits) >= 30:
                return "\n".join(hits) + "\n(stopped at 30 matches)"
    return "\n".join(hits) or f"No files contain: {query}"


@server.tool("Save a file",
             description="Create or replace a text file in the folder. Ask the user before replacing an existing file.",
             params={"path": ("string", "File path relative to the top folder, e.g. notes/todo.txt"),
                     "content": ("string", "The full text to save")},
             required=["path", "content"])
def write_file(path, content):
    full = resolve(path)
    if os.path.isdir(full):
        raise ToolError(f"{path} is a folder.")
    existed = os.path.exists(full)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    return f"{'Replaced' if existed else 'Created'} {rel(full)} ({len(content)} characters)."


if __name__ == "__main__":
    server.run()
