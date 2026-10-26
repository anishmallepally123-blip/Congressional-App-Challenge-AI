"""
Folder Organizer - lets the local AI tidy up a messy folder (like the Desktop) safely.

How it works:
  1. scan_folder()  looks at the files in a folder (names, types, sizes, dates).
  2. make_plan()    asks the local model (through Ollama) to propose a plan of
                    moves and renames. If the model is unavailable or gives a bad
                    answer, a simple "sort by file type" plan is used instead.
  3. The user reviews the plan in the web page. Nothing on disk changes until
     they press Apply.
  4. apply_plan()   carries out the approved moves and writes a log of every move.
  5. undo_run()     reads that log and puts every file back where it was.

Safety rules, enforced in code no matter what the model says:
  - Files are only ever moved or renamed, never deleted or overwritten.
  - Every destination must stay inside the folder being organized.
  - System folders and the home folder itself are refused.

Like the chatbot server, this only uses Python's standard library.
"""

import json
import os
import re
import shutil
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
DATA_DIR = os.environ.get(
    "ORGANIZER_DATA_DIR",
    os.path.join(os.path.expanduser("~"), ".local-ai-chat", "organizer"),
)
PLANS_DIR = os.path.join(DATA_DIR, "plans")
RUNS_DIR = os.path.join(DATA_DIR, "runs")

MAX_FILES = 300  # keep the prompt small enough for a local model

# Fallback categories used when the model can't make a plan.
CATEGORIES = {
    "Images": {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".svg", ".tif", ".tiff"},
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".md", ".pages"},
    "Spreadsheets": {".xls", ".xlsx", ".csv", ".ods", ".numbers"},
    "Presentations": {".ppt", ".pptx", ".odp", ".key"},
    "Videos": {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"},
    "Audio": {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg"},
    "Archives": {".zip", ".rar", ".7z", ".tar", ".gz"},
    "Installers": {".dmg", ".pkg", ".exe", ".msi", ".deb", ".appimage"},
    "Code": {".py", ".js", ".html", ".css", ".java", ".c", ".cpp", ".ipynb", ".json", ".sh"},
}

PLAN_PROMPT = """You are organizing a folder on the user's computer.
Here are the files in it (name, size, last modified, and the start of the text
inside when the user has shared this folder with you):

{listing}

Existing subfolders: {subfolders}

The user's request: {request}

Propose a tidy layout. Rules:
- Only move or rename files from the list above. Never delete anything.
- Group files into a small number of clearly named subfolders (reuse existing ones when they fit).
- Rename a file only when its name is unclear (like "IMG_2041.jpg" or "Untitled 3.docx") and a better name is obvious. Keep the file extension.
- Leave a file where it is if you are not sure.
- Paths are relative to the folder, using "/" between folder and file name.

Reply with JSON only, in exactly this shape:
{{"summary": "one sentence describing the new layout",
  "moves": [{{"from": "old name.ext", "to": "Subfolder/new name.ext", "reason": "short reason"}}]}}
"""


class OrganizerError(Exception):
    """A problem worth showing to the user as-is."""


# ---------- Checking which folders are allowed ----------

def _norm(p):
    return os.path.normcase(os.path.realpath(p))


def _blocked_folders():
    """Returns (folders refused exactly, folders refused along with everything inside them)."""
    home = os.path.expanduser("~")
    exact = {_norm("/"), _norm(home)}
    whole_tree = {
        "/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr",
        "/System", "/Library", "/Applications",
        os.path.join(home, "Library"), os.path.join(home, "AppData"),
    }
    for var in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"):
        if os.environ.get(var):
            whole_tree.add(os.environ[var])
    return exact, {_norm(p) for p in whole_tree}


def check_folder(path):
    """Return the folder's full path, or raise OrganizerError if it can't be organized."""
    if not path or not str(path).strip():
        raise OrganizerError("Tell me which folder to organize.")
    full = os.path.realpath(os.path.expanduser(str(path).strip()))
    if not os.path.isdir(full):
        raise OrganizerError(f"I can't find a folder at {full}.")
    key = os.path.normcase(full)
    exact, whole_tree = _blocked_folders()
    if key in exact or any(key == b or key.startswith(b.rstrip(os.sep) + os.sep) for b in whole_tree):
        raise OrganizerError(f"{full} is a system or home folder, so I won't reorganize it. Try a folder inside it, like Desktop.")
    if os.path.ismount(full):
        raise OrganizerError(f"{full} is the top of a drive, so I won't reorganize it.")
    return full


def _inside(root, relative):
    """Full path for a relative path, or None if it would escape the root folder."""
    if not relative or os.path.isabs(relative) or re.match(r"^[A-Za-z]:", relative):
        return None
    parts = re.split(r"[\\/]+", relative.strip())
    if any(p in ("", ".", "..") for p in parts):
        return None
    full = os.path.normpath(os.path.join(root, *parts))
    if os.path.commonpath([root, full]) != root:
        return None
    return full


# ---------- Step 1: scanning ----------

def _human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def scan_folder(path):
    """List the files sitting directly in a folder (hidden files are skipped)."""
    root = check_folder(path)
    files, subfolders = [], []
    for entry in sorted(os.scandir(root), key=lambda e: e.name.lower()):
        if entry.name.startswith(".") or entry.name.lower() in ("desktop.ini", "thumbs.db"):
            continue
        if entry.is_dir(follow_symlinks=False):
            subfolders.append(entry.name)
        elif entry.is_file(follow_symlinks=False):
            stat = entry.stat(follow_symlinks=False)
            files.append({
                "name": entry.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d"),
            })
    return {"folder": root, "files": files, "subfolders": subfolders}


# ---------- Step 2: making a plan ----------

def _ask_model(model, prompt):
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.2},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.load(resp)
    return json.loads(data["message"]["content"])


def _describe(root, f, preview_chars):
    """One line per file for the model. Shared folders also include a peek at the contents."""
    line = f"- {f['name']} ({_human_size(f['size'])}, {f['modified']})"
    if preview_chars < 40:
        return line
    import shared_files  # imported here because shared_files imports this module
    preview = shared_files.peek(os.path.join(root, f["name"]), preview_chars)
    return line + (f'\n  starts with: "{preview}"' if preview else "")


def _type_plan(scan):
    """Simple fallback: sort files into folders by their file type."""
    moves = []
    for f in scan["files"]:
        ext = os.path.splitext(f["name"])[1].lower()
        folder = next((name for name, exts in CATEGORIES.items() if ext in exts), None)
        if folder:
            moves.append({"from": f["name"], "to": f"{folder}/{f['name']}", "reason": f"{folder.lower()} file"})
    return {"summary": "Files sorted into folders by type.", "moves": moves}


def _folder_names(scan, raw_moves):
    """Names that mean a folder, lowercased, mapped to how they're spelled: existing
    subfolders first, then folders other moves use, then the type folders."""
    folders = {}
    for name in scan.get("subfolders", []):
        folders.setdefault(name.lower(), name)
    for m in raw_moves:
        dst = str(m.get("to", "")).strip().replace("\\", "/").rstrip("/")
        while "/" in dst:
            dst = dst.rsplit("/", 1)[0]
            folders.setdefault(dst.lower(), dst)
        if str(m.get("to", "")).strip().endswith("/") and dst:
            folders.setdefault(dst.lower(), dst)
    for name in CATEGORIES:
        folders.setdefault(name.lower(), name)
    return folders


def _clean_moves(root, scan, raw_moves):
    """Keep only safe, sensible moves. Returns (moves, skipped notes)."""
    names = {f["name"] for f in scan["files"]}
    raw_moves = [m for m in raw_moves if isinstance(m, dict)] if isinstance(raw_moves, list) else []
    folders = _folder_names(scan, raw_moves)
    moves, skipped, used_from, used_to = [], [], set(), set()
    for m in raw_moves:
        src, dst = str(m.get("from", "")).strip(), str(m.get("to", "")).strip().replace("\\", "/")
        reason = str(m.get("reason", "")).strip()[:200]
        if src not in names:
            skipped.append(f"{src or '(blank)'}: not a file in this folder")
            continue
        if src in used_from:
            continue
        # Small models often name just the folder ("Images" or "Images/"): keep the file's name.
        folder = dst.rstrip("/")
        if folder and (dst.endswith("/") or folder.lower() in folders):
            dst = folders.get(folder.lower(), folder) + "/" + src
        if _inside(root, dst) is None:
            skipped.append(f"{src}: destination {dst or '(blank)'} is outside the folder")
            continue
        if dst == src:
            continue
        # Keep the original extension so files still open with the right app.
        src_ext, dst_ext = os.path.splitext(src)[1], os.path.splitext(dst)[1]
        if src_ext.lower() != dst_ext.lower():
            dst += src_ext
        if dst.lower() in used_to:
            skipped.append(f"{src}: another file is already going to {dst}")
            continue
        used_from.add(src)
        used_to.add(dst.lower())
        moves.append({"from": src, "to": dst, "reason": reason})
    return moves, skipped


def make_plan(path, model=None, request=""):
    """Scan a folder and propose a plan. Saves it so the web page can show it for approval."""
    scan = scan_folder(path)
    root = scan["folder"]
    if not scan["files"]:
        raise OrganizerError(f"There are no files to organize in {root}.")

    source, note = "type", ""
    files = scan["files"][:MAX_FILES]
    if len(scan["files"]) > MAX_FILES:
        note = f"Only the first {MAX_FILES} files were considered."
    raw = None
    if model:
        # Keep previews short enough that the whole prompt fits a small local model.
        preview_chars = min(200, 12_000 // len(files))
        listing = "\n".join(_describe(root, f, preview_chars) for f in files)
        prompt = PLAN_PROMPT.format(
            listing=listing,
            subfolders=", ".join(scan["subfolders"]) or "none",
            request=request.strip() or "Make this folder tidy and easy to browse.",
        )
        try:
            raw = _ask_model(model, prompt)
            source = "model"
        except (urllib.error.URLError, OSError, ValueError, KeyError):
            note = (note + " The AI model couldn't make a plan, so files were sorted by type instead.").strip()

    if not isinstance(raw, dict):
        raw = _type_plan(scan)
        source = "type"
    moves, skipped = _clean_moves(root, {"files": files, "subfolders": scan["subfolders"]}, raw.get("moves"))
    if source == "model" and not moves:
        raw = _type_plan(scan)
        moves, skipped = _clean_moves(root, {"files": files, "subfolders": scan["subfolders"]}, raw.get("moves"))
        source = "type"
        note = (note + " The AI model's plan had no usable moves, so files were sorted by type instead.").strip()

    plan = {
        "id": uuid.uuid4().hex[:12],
        "folder": root,
        "created": time.time(),
        "model": model if source == "model" else None,
        "request": request,
        "summary": str(raw.get("summary", ""))[:300],
        "note": note,
        "moves": moves,
        "skipped": skipped,
        "status": "pending",
    }
    _save(PLANS_DIR, plan["id"], plan)
    return plan


# ---------- Saving plans and logs ----------

def _save(directory, item_id, data):
    os.makedirs(directory, exist_ok=True)
    tmp = os.path.join(directory, item_id + ".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, os.path.join(directory, item_id + ".json"))


def _load(directory, item_id):
    if not re.fullmatch(r"[0-9a-f]{12}", item_id or ""):
        raise OrganizerError("Unknown plan or run.")
    try:
        with open(os.path.join(directory, item_id + ".json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise OrganizerError("Unknown plan or run.")


def get_plan(plan_id):
    return _load(PLANS_DIR, plan_id)


def list_runs(limit=20):
    """Most recent runs first, for an "Undo" list in the page."""
    if not os.path.isdir(RUNS_DIR):
        return []
    runs = []
    for name in os.listdir(RUNS_DIR):
        if name.endswith(".json"):
            try:
                run = _load(RUNS_DIR, name[:-5])
            except (OrganizerError, ValueError):
                continue
            runs.append({k: run[k] for k in ("id", "folder", "applied", "status")} | {"count": len(run["moves"])})
    return sorted(runs, key=lambda r: r["applied"], reverse=True)[:limit]


# ---------- Step 3: applying and undoing ----------

def _free_name(full):
    """Never overwrite: "report.pdf" becomes "report (2).pdf" if the name is taken."""
    if not os.path.lexists(full):
        return full
    base, ext = os.path.splitext(full)
    n = 2
    while os.path.lexists(f"{base} ({n}){ext}"):
        n += 1
    return f"{base} ({n}){ext}"


def _make_dirs(root, folder, created):
    """Create a folder (and its parents) inside root, remembering which ones are new."""
    missing = []
    while folder != root and not os.path.isdir(folder):
        missing.append(folder)
        folder = os.path.dirname(folder)
    for d in reversed(missing):
        os.mkdir(d)
        created.append(d)


def apply_plan(plan_id, approved=None):
    """
    Carry out an approved plan. `approved` is the list of "from" names the user
    kept ticked; None means all of them. Returns the run log.
    """
    plan = get_plan(plan_id)
    if plan["status"] != "pending":
        raise OrganizerError("This plan was already used. Make a new plan to organize again.")
    root = check_folder(plan["folder"])
    keep = None if approved is None else set(approved)

    run = {
        "id": uuid.uuid4().hex[:12],
        "plan_id": plan_id,
        "folder": root,
        "applied": time.time(),
        "status": "applied",
        "moves": [],
        "created_folders": [],
        "problems": [],
    }
    for m in plan["moves"]:
        if keep is not None and m["from"] not in keep:
            continue
        src, dst = _inside(root, m["from"]), _inside(root, m["to"])
        if src is None or dst is None or not os.path.isfile(src):
            run["problems"].append(f"{m['from']}: no longer there, skipped")
            continue
        try:
            _make_dirs(root, os.path.dirname(dst), run["created_folders"])
            dst = _free_name(dst)
            os.rename(src, dst)
        except OSError as e:
            run["problems"].append(f"{m['from']}: {e.strerror or e}")
            continue
        run["moves"].append({"from": os.path.relpath(src, root), "to": os.path.relpath(dst, root)})
        # Write the log after every move so a crash still leaves an accurate undo record.
        _save(RUNS_DIR, run["id"], run)

    run["created_folders"] = [os.path.relpath(d, root) for d in run["created_folders"]]
    _save(RUNS_DIR, run["id"], run)
    plan["status"] = "applied"
    plan["run_id"] = run["id"]
    _save(PLANS_DIR, plan_id, plan)
    return run


def undo_run(run_id):
    """Put every file from a run back where it was. Returns a short report."""
    run = _load(RUNS_DIR, run_id)
    if run["status"] == "undone":
        raise OrganizerError("That change was already undone.")
    root = check_folder(run["folder"])
    restored, problems = 0, []
    for m in reversed(run["moves"]):
        now, before = _inside(root, m["to"]), _inside(root, m["from"])
        if now is None or before is None or not os.path.isfile(now):
            problems.append(f"{m['to']}: not found any more, left as is")
            continue
        target = _free_name(before)
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            os.rename(now, target)
            restored += 1
        except OSError as e:
            problems.append(f"{m['to']}: {e.strerror or e}")
    # Remove folders this run created, but only if they are now empty.
    for rel in sorted(run.get("created_folders", []), key=len, reverse=True):
        folder = _inside(root, rel)
        if folder and os.path.isdir(folder) and not os.listdir(folder):
            os.rmdir(folder)
    run["status"] = "undone"
    run["undone"] = time.time()
    run["undo_problems"] = problems
    _save(RUNS_DIR, run_id, run)
    return {"restored": restored, "problems": problems}


# ---------- Hooking into the chatbot as a tool ----------

# Give this to Ollama in the "tools" list of /api/chat so the model can call it.
TOOL_SPEC = {
    "type": "function",
    "function": {
        "name": "organize_folder",
        "description": (
            "Propose a plan to tidy a folder on the user's computer by moving files into "
            "subfolders and giving unclear files better names. Nothing changes until the "
            "user approves the plan on screen."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Folder to organize, e.g. ~/Desktop or ~/Downloads"},
                "instructions": {"type": "string", "description": "How the user wants it organized, if they said"},
            },
            "required": ["path"],
        },
    },
}


def handle_tool_call(arguments, model):
    """Run the organize_folder tool. Returns (text for the model, plan or None)."""
    try:
        plan = make_plan(arguments.get("path", ""), model=model, request=arguments.get("instructions", ""))
    except OrganizerError as e:
        return str(e), None
    text = (
        f"A plan with {len(plan['moves'])} moves for {plan['folder']} is ready and is "
        "being shown to the user for approval. Tell them to review it and press Apply; "
        "nothing has changed yet."
    )
    return text, plan
