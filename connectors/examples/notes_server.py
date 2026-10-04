"""
Example connector: a tiny notebook the AI can read and write.

It's a complete MCP server in one file with no downloads, so it works offline and
shows how any program can become a connector. Add it on the Connectors page with:

    Command:    python
    Arguments:  <path to this file>

Notes are saved in ~/.local-ai-chat/notes.json.
"""

import datetime
import json
import os
import sys

NOTES_PATH = os.environ.get("NOTES_PATH", os.path.join(os.path.expanduser("~"), ".local-ai-chat", "notes.json"))

TOOLS = [
    {
        "name": "add_note",
        "title": "Save a note",
        "description": "Save a short note for the user, such as a reminder, idea or to-do.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "A few words naming the note"},
                "text": {"type": "string", "description": "What the note says"},
            },
            "required": ["title", "text"],
        },
    },
    {
        "name": "list_notes",
        "title": "Read notes",
        "description": "List the user's saved notes, newest first. Optionally only those containing a word.",
        "inputSchema": {
            "type": "object",
            "properties": {"search": {"type": "string", "description": "Only notes containing this text"}},
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "current_time",
        "title": "Check the date and time",
        "description": "Get the current date, time and weekday on this computer.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
]


def load_notes():
    try:
        with open(NOTES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def save_notes(notes):
    os.makedirs(os.path.dirname(NOTES_PATH), exist_ok=True)
    with open(NOTES_PATH, "w", encoding="utf-8") as f:
        json.dump(notes, f, indent=2)


def run_tool(name, args):
    if name == "add_note":
        notes = load_notes()
        notes.append({"title": args.get("title", "Untitled"), "text": args.get("text", ""),
                      "saved": datetime.datetime.now().isoformat(timespec="minutes")})
        save_notes(notes)
        return f"Saved the note \"{notes[-1]['title']}\". There are now {len(notes)} notes."
    if name == "list_notes":
        word = (args.get("search") or "").lower()
        notes = [n for n in reversed(load_notes()) if word in (n["title"] + " " + n["text"]).lower()]
        if not notes:
            return "No notes found."
        return "\n".join(f"- {n['title']} ({n['saved']}): {n['text']}" for n in notes[:30])
    if name == "current_time":
        return datetime.datetime.now().strftime("%A, %B %d, %Y, %I:%M %p")
    raise KeyError(name)


def answer(msg):
    method, params = msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "example-notes", "version": "1.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        try:
            text = run_tool(params.get("name"), params.get("arguments") or {})
            return {"content": [{"type": "text", "text": text}]}
        except KeyError:
            return {"content": [{"type": "text", "text": f"Unknown tool {params.get('name')}"}], "isError": True}
    raise LookupError(method)


def main():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" not in msg:
            continue  # a notification such as notifications/initialized; nothing to answer
        try:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": answer(msg)}
        except LookupError:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Method not found"}}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
