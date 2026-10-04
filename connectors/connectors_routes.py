"""
Web routes for Connectors, written so the chatbot server can reuse them.

Inside a request handler (like ChatHandler in chatbot/server.py), call:

    if connectors_routes.handle(self):
        return

and, in the chat route, before and after talking to Ollama:

    events = connectors_routes.add_tools(payload, messages, capabilities)
    ...
    connectors_routes.tool_calls_event(calls)   # when the model asked for tools

It answers these and returns True, or returns False for any other path:

    GET  /connectors                     the settings page
    GET  /connectors/<file>              the page's script and styles, and tool-chat.js for the chat page
    GET  /api/connectors                 -> {"connectors": [...], "presets": [...]}
    POST /api/connectors/add             {"name", "config", "replace"} -> {"name", "error"}
    POST /api/connectors/import          {"text"} -> {"added": [...]}
    POST /api/connectors/remove          {"name"}
    POST /api/connectors/enable          {"name", "enabled"}
    POST /api/connectors/approval        {"name", "tool", "approval": "ask" | "always" | "off"}
    POST /api/connectors/reconnect       {"name"}
    GET  /api/connectors/summary         -> {"connectors": n} turned on (without starting them)
    POST /api/tools/call                 {"name", "arguments", "model"} -> {"text", "is_error", "link"}
"""

import json
import mimetypes
import os

import connectors

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PAGE_FILES = {"connectors.js", "connectors.css", "tool-chat.js", "tool-chat.css"}
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")

manager = connectors.Manager()


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


def _trusted(handler):
    """
    Connectors can run programs, so only this app's own page may use these routes.
    The Host check stops other websites reaching us through a renamed address, and
    the Origin check stops them sending requests from their own pages.
    """
    host = handler.headers.get("Host", "")
    if host.rsplit(":", 1)[0] not in LOCAL_HOSTS:
        return False
    origin = handler.headers.get("Origin")
    return not origin or origin in (f"http://{host}", f"https://{host}")


def add_tools(payload, messages, capabilities):
    return connectors.add_tools(manager, payload, messages, capabilities)


def tool_calls_event(calls):
    return connectors.tool_calls_event(manager, calls)


def handle(handler):
    path = handler.path.split("?", 1)[0]
    method = handler.command

    if method == "GET" and path in ("/connectors", "/connectors/"):
        _send_file(handler, "connectors.html")
        return True
    if method == "GET" and path.startswith("/connectors/") and path[len("/connectors/"):] in PAGE_FILES:
        _send_file(handler, path[len("/connectors/"):])
        return True
    if not path.startswith(("/api/connectors", "/api/tools/")):
        return False
    if not _trusted(handler):
        _send_json(handler, 403, {"error": "Requests must come from the app's own page."})
        return True

    try:
        if method == "GET" and path == "/api/connectors":
            _send_json(handler, 200, {"connectors": manager.status(), "presets": connectors.PRESETS})
        elif method == "GET" and path == "/api/connectors/summary":
            rows = [r for r in manager.status(connect=False) if r["enabled"]]
            _send_json(handler, 200, {"connectors": len(rows)})
        elif method == "POST":
            data = _read_json(handler)
            action = path.rsplit("/", 1)[1]
            if path == "/api/tools/call":
                args = data.get("arguments") or {}
                if not isinstance(args, dict):
                    raise ValueError
                _send_json(handler, 200, manager.call(data["name"], args, data.get("model")))
            elif action == "add":
                _send_json(handler, 200, manager.add(data.get("name"), data.get("config") or {},
                                                     replace=bool(data.get("replace"))))
            elif action == "import":
                _send_json(handler, 200, {"added": manager.import_config(data.get("text", ""))})
            elif action == "remove":
                manager.remove(data["name"])
                _send_json(handler, 200, {"ok": True})
            elif action == "enable":
                manager.set_enabled(data["name"], data.get("enabled"))
                _send_json(handler, 200, {"ok": True})
            elif action == "approval":
                manager.set_approval(data["name"], data["tool"], data.get("approval"))
                _send_json(handler, 200, {"ok": True})
            elif action == "reconnect":
                manager.reconnect(data["name"])
                _send_json(handler, 200, {"ok": True})
            else:
                _send_json(handler, 404, {"error": "Not found"})
        else:
            _send_json(handler, 404, {"error": "Not found"})
    except connectors.ConnectorError as e:
        _send_json(handler, 400, {"error": str(e)})
    except (ValueError, KeyError, TypeError):
        _send_json(handler, 400, {"error": "Bad request"})
    return True
