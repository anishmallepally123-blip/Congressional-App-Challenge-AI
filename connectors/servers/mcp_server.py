"""
A tiny framework for writing connectors (MCP servers) in plain Python.

Every connector in this folder uses it, so each one only has to describe its tools
and say what they do. Nothing to install: it uses Python's standard library only.

    server = Server("weather")

    @server.tool("Check the weather", read_only=True,
                 params={"city": ("string", "A city name")}, required=["city"])
    def weather(city):
        return f"It's sunny in {city}."

    server.run()

A tool returns text for the model. To report a problem, raise ToolError("message").
To stop a connector that can't work (say, a missing access token), call
setup_error("message"): the Connectors page shows that message.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "LocalAIChat/1.0 (a student project; https://github.com/anishmallepally123-blip/Congressional-App-Challenge-AI)"


class ToolError(Exception):
    """A tool couldn't do what was asked. The message goes back to the model and the user."""


def setup_error(message):
    """Stop a connector that can't start, with a message the Connectors page shows."""
    sys.stderr.write(message.strip() + "\n")
    sys.stderr.flush()
    sys.exit(1)


def need_env(name, how):
    """Read a required setting (like an access token), or stop with instructions."""
    value = os.environ.get(name, "").strip()
    if not value or value.lower().startswith(("paste", "your")):
        setup_error(f"This connector needs {name}. {how}")
    return value


def http_json(url, method="GET", body=None, headers=None, form=None, timeout=30, service="The service"):
    """
    Call a web API and return its JSON answer. Errors become ToolError with readable text.
    Pass `body` for a JSON request body or `form` for a form-encoded one.
    """
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            info = json.loads(detail)
            err = info.get("error")
            detail = info.get("message") or (err.get("message") if isinstance(err, dict) else err) or detail
        except (ValueError, AttributeError):
            pass
        if e.code in (401, 403):
            raise ToolError(f"{service} refused access (error {e.code}): {str(detail)[:200]}. "
                            "Check the access token in this connector's settings.") from e
        if e.code == 404:
            raise ToolError(f"{service} couldn't find that (error 404). It may not exist, or it hasn't been shared with this connector.") from e
        if e.code == 429:
            raise ToolError(f"{service} says too many requests. Wait a minute and try again.") from e
        raise ToolError(f"{service} answered with error {e.code}: {str(detail)[:200]}") from e
    except (urllib.error.URLError, OSError) as e:
        raise ToolError(f"Couldn't reach {service}: {getattr(e, 'reason', e)}. Check the internet connection.") from e
    try:
        return json.loads(raw or b"{}")
    except ValueError as e:
        raise ToolError(f"{service} sent an answer that isn't JSON.") from e


class Server:
    def __init__(self, name, version="1.0"):
        self.name = name
        self.version = version
        self.tools = {}

    def tool(self, title, description=None, params=None, required=None, read_only=False):
        """
        Register a function as a tool. `params` maps each argument name to
        (type, description) or (type, description, extra_schema_fields).
        """
        def wrap(fn):
            props = {}
            for key, spec in (params or {}).items():
                prop = {"type": spec[0], "description": spec[1]}
                if len(spec) > 2:
                    prop.update(spec[2])
                props[key] = prop
            self.tools[fn.__name__] = {
                "fn": fn,
                "spec": {
                    "name": fn.__name__,
                    "title": title,
                    "description": (description or fn.__doc__ or title).strip(),
                    "inputSchema": {"type": "object", "properties": props, **({"required": required} if required else {})},
                    "annotations": {"title": title, "readOnlyHint": read_only},
                },
            }
            return fn
        return wrap

    def _call(self, name, args):
        tool = self.tools.get(name)
        if not tool:
            return {"content": [{"type": "text", "text": f"Unknown tool {name}"}], "isError": True}
        known = tool["spec"]["inputSchema"]["properties"]
        args = {k: v for k, v in (args or {}).items() if k in known and v is not None}
        try:
            text = tool["fn"](**args)
            return {"content": [{"type": "text", "text": str(text)}]}
        except ToolError as e:
            return {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except TypeError as e:
            return {"content": [{"type": "text", "text": f"Missing or wrong details for {name}: {e}"}], "isError": True}
        except Exception as e:  # a bug in a tool shouldn't stop the connector
            return {"content": [{"type": "text", "text": f"The tool failed: {type(e).__name__}: {e}"}], "isError": True}

    def _answer(self, msg):
        method, params = msg.get("method"), msg.get("params") or {}
        if method == "initialize":
            return {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": self.name, "version": self.version}}
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": [t["spec"] for t in self.tools.values()]}
        if method == "tools/call":
            return self._call(params.get("name"), params.get("arguments"))
        raise LookupError(method)

    def handle(self, msg):
        """Answer one JSON-RPC message (a dict). Returns the reply, or None for notifications."""
        if "id" not in msg:
            return None
        try:
            return {"jsonrpc": "2.0", "id": msg["id"], "result": self._answer(msg)}
        except LookupError:
            return {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Method not found"}}

    def run(self):
        """Talk MCP over stdin/stdout until the app closes the connection."""
        # Windows consoles default to a legacy code page; MCP messages are UTF-8.
        stdin = open(sys.stdin.fileno(), encoding="utf-8", errors="replace", closefd=False)
        stdout = open(sys.stdout.fileno(), "w", encoding="utf-8", closefd=False)
        for line in stdin:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            reply = self.handle(msg)
            if reply is not None:
                stdout.write(json.dumps(reply) + "\n")
                stdout.flush()
