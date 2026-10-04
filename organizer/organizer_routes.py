"""
Web routes for the Folder Organizer, written so the chatbot server can reuse them.

Inside a request handler (like ChatHandler in chatbot/server.py), call:

    if organizer_routes.handle(self):
        return

It answers these and returns True, or returns False for any other path:

    GET  /organizer               the review page
    GET  /organizer/<file>        the page's script and styles
    POST /api/organizer/plan      {"folder", "model", "request"} -> plan
    GET  /api/organizer/plan/<id> -> plan
    POST /api/organizer/apply     {"plan_id", "approved": [names]} -> run log
    POST /api/organizer/undo      {"run_id"} -> report
    GET  /api/organizer/runs      -> recent runs, newest first

    GET  /files                   the page for sharing folders with the AI
    GET  /api/files/status        -> shared folders and how many files were read
    POST /api/files/share         {"folder"} -> that folder's status
    POST /api/files/unshare       {"folder"}
    POST /api/files/rescan        re-reads every shared folder
    POST /api/files/search        {"query"} -> matching passages (what the AI would see)
"""

import json
import mimetypes
import os

import organizer
import shared_files

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PAGE_FILES = {"organizer.js", "organizer.css", "files.js"}


def _send_json(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _send_file(handler, name):
    path = os.path.join(STATIC_DIR, name)
    with open(path, "rb") as f:
        body = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler):
    length = int(handler.headers.get("Content-Length", 0))
    data = json.loads(handler.rfile.read(length) or b"{}")
    if not isinstance(data, dict):
        raise ValueError
    return data


def _same_origin(handler):
    """Only accept changes from this app's own page, not from other websites."""
    origin = handler.headers.get("Origin")
    if not origin:
        return True
    host = handler.headers.get("Host", "")
    return origin in (f"http://{host}", f"https://{host}")


def handle(handler):
    path = handler.path.split("?", 1)[0]
    method = handler.command

    if method == "GET" and path in ("/organizer", "/organizer/"):
        _send_file(handler, "organizer.html")
        return True
    if method == "GET" and path.startswith("/organizer/") and path[len("/organizer/"):] in PAGE_FILES:
        _send_file(handler, path[len("/organizer/"):])
        return True
    if method == "GET" and path in ("/files", "/files/"):
        _send_file(handler, "files.html")
        return True
    if path.startswith("/api/files/"):
        return _handle_files(handler, method, path[len("/api/files/"):])
    if not path.startswith("/api/organizer/"):
        return False

    action = path[len("/api/organizer/"):]
    try:
        if method == "GET" and action == "runs":
            _send_json(handler, 200, {"runs": organizer.list_runs()})
        elif method == "GET" and action.startswith("plan/"):
            _send_json(handler, 200, organizer.get_plan(action[len("plan/"):]))
        elif method == "POST":
            if not _same_origin(handler):
                _send_json(handler, 403, {"error": "Requests must come from the app's own page."})
                return True
            data = _read_json(handler)
            if action == "plan":
                plan = organizer.make_plan(data.get("folder", ""), data.get("model"), data.get("request", ""))
                _send_json(handler, 200, plan)
            elif action == "apply":
                _send_json(handler, 200, organizer.apply_plan(data.get("plan_id", ""), data.get("approved")))
            elif action == "undo":
                _send_json(handler, 200, organizer.undo_run(data.get("run_id", "")))
            else:
                _send_json(handler, 404, {"error": "Not found"})
        else:
            _send_json(handler, 404, {"error": "Not found"})
    except organizer.OrganizerError as e:
        _send_json(handler, 400, {"error": str(e)})
    except (ValueError, KeyError):
        _send_json(handler, 400, {"error": "Bad request"})
    return True


def _handle_files(handler, method, action):
    try:
        if method == "GET" and action == "status":
            _send_json(handler, 200, {"folders": shared_files.status()})
        elif method == "POST":
            if not _same_origin(handler):
                _send_json(handler, 403, {"error": "Requests must come from the app's own page."})
                return True
            data = _read_json(handler)
            if action == "share":
                _send_json(handler, 200, shared_files.share(data.get("folder", "")))
            elif action == "unshare":
                shared_files.unshare(data.get("folder", ""))
                _send_json(handler, 200, {"folders": shared_files.status()})
            elif action == "rescan":
                shared_files.refresh(max_age=0)
                _send_json(handler, 200, {"folders": shared_files.status()})
            elif action == "search":
                _send_json(handler, 200, {"results": shared_files.search(str(data.get("query", "")))})
            else:
                _send_json(handler, 404, {"error": "Not found"})
        else:
            _send_json(handler, 404, {"error": "Not found"})
    except organizer.OrganizerError as e:
        _send_json(handler, 400, {"error": str(e)})
    except (ValueError, KeyError):
        _send_json(handler, 400, {"error": "Bad request"})
    return True
