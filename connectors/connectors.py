"""
Connectors: third-party tools the chatbot's AI model can use.

This keeps the list of connectors (saved in a settings file), starts them when
they're needed, and runs the chat loop that lets a model call their tools:

    model asks for a tool  ->  the page asks the user  ->  the tool runs  ->  model answers

Settings are saved in the same {"mcpServers": {...}} format that Claude Desktop,
Cursor and VS Code use, so a connector's setup instructions work here too.
"""

import json
import os
import re
import sys
import threading

import mcp_client
from mcp_client import MCPError

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get(
    "CONNECTORS_CONFIG", os.path.join(os.path.expanduser("~"), ".local-ai-chat", "connectors.json")
)
MAX_RESULT_CHARS = 6000  # small local models have small memories; keep tool results short
APPROVAL_CHOICES = ("ask", "always", "off")

TOOLS_PROMPT = (
    "You can use tools to look things up or take actions for the user. Use a tool only "
    "when it helps answer the request. After a tool runs, answer the user in plain words "
    "using its result. If the user declines a tool, don't try it again; carry on without it."
)


# Ready-made connectors the settings page offers with one click. Most come from the
# official MCP servers project (github.com/modelcontextprotocol/servers).
PRESETS = [
    {"name": "Notes", "needs": "Nothing extra. Works offline.",
     "about": "An example connector included with this app: save notes and check the date and time.",
     "config": {"command": "python", "args": [os.path.join(HERE, "examples", "notes_server.py")]}},
    {"name": "Files", "needs": "Node.js (nodejs.org)",
     "about": "Read and search files in one folder you choose. Change the last argument to that folder.",
     "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"]}},
    {"name": "Web pages", "needs": "uv (docs.astral.sh/uv) and an internet connection",
     "about": "Fetch a web page and read it as text.",
     "config": {"command": "uvx", "args": ["mcp-server-fetch"]}},
    {"name": "Memory", "needs": "Node.js (nodejs.org)",
     "about": "Let the AI remember facts about you between chats.",
     "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}},
    {"name": "GitHub", "needs": "A GitHub access token and an internet connection",
     "about": "GitHub's own remote connector. Replace YOUR_TOKEN with a personal access token.",
     "config": {"url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer YOUR_TOKEN"}}},
]


class ConnectorError(Exception):
    """A problem with the user's request, in words a user can read."""


# ---------- Built-in connectors (features of this app, shown alongside MCP ones) ----------

def _load_organizer():
    """The Folder Organizer lives next to this folder; offer it as a tool if it's there."""
    path = os.path.join(HERE, "..", "organizer")
    if not os.path.isfile(os.path.join(path, "organizer.py")):
        return None
    if path not in sys.path:
        sys.path.insert(0, path)
    try:
        import organizer
    except ImportError:
        return None
    return organizer


def _organizer_call(organizer, arguments, model):
    text, plan = organizer.handle_tool_call(arguments, model)
    link = f"/organizer?plan={plan['id']}" if plan else None
    return text, plan is None, link


def builtin_connectors():
    found = {}
    organizer = _load_organizer()
    if organizer and hasattr(organizer, "TOOL_SPEC"):
        spec = organizer.TOOL_SPEC["function"]
        found["Folder Organizer"] = {
            "description": "Tidy a folder on this computer. You approve every change.",
            "tools": [{"name": spec["name"], "title": "Organize a folder", "description": spec["description"], "inputSchema": spec["parameters"]}],
            "call": lambda tool, args, model: _organizer_call(organizer, args, model),
        }
    return found


# ---------- Settings file ----------

def _clean_name(name):
    name = (name or "").strip()
    if not name or len(name) > 40 or not re.fullmatch(r"[\w .\-]+", name):
        raise ConnectorError("Give the connector a short name using letters, numbers, spaces, - or _.")
    return name


def _clean_server(cfg):
    """Check one connector's settings and keep only the fields this app understands."""
    if not isinstance(cfg, dict):
        raise ConnectorError("Each connector's settings must be an object.")
    out = {"enabled": cfg.get("enabled", True) is not False}
    if cfg.get("url"):
        url = str(cfg["url"]).strip()
        if not url.startswith(("http://", "https://")):
            raise ConnectorError("The URL must start with http:// or https://")
        out["url"] = url
        if cfg.get("headers"):
            out["headers"] = {str(k): str(v) for k, v in dict(cfg["headers"]).items()}
    elif cfg.get("command"):
        out["command"] = str(cfg["command"]).strip()
        args = cfg.get("args") or []
        if not isinstance(args, list):
            raise ConnectorError("Arguments must be a list.")
        out["args"] = [str(a) for a in args]
        if cfg.get("env"):
            out["env"] = {str(k): str(v) for k, v in dict(cfg["env"]).items()}
        if cfg.get("cwd"):
            out["cwd"] = str(cfg["cwd"])
    else:
        raise ConnectorError("A connector needs either a command to run or a URL.")
    approvals = cfg.get("approvals") or {}
    out["approvals"] = {str(k): v for k, v in dict(approvals).items() if v in APPROVAL_CHOICES}
    return out


def _tool_key(server, tool):
    """The name a model sees for a tool. Models only accept letters, numbers, _ and -."""
    key = re.sub(r"[^A-Za-z0-9_-]", "_", f"{server}__{tool}")
    return key[:64]


class Manager:
    """Owns the settings and the running connectors. One shared instance per app."""

    def __init__(self, config_path=CONFIG_PATH):
        self.config_path = config_path
        self.lock = threading.RLock()
        self.conns = {}    # name -> running connection
        self.tools = {}    # name -> tools it offers
        self.errors = {}   # name -> last error message
        self.builtins = builtin_connectors()
        self.config = self._load()

    # Settings

    def _load(self):
        try:
            with open(self.config_path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}
        except (OSError, ValueError):
            data = {}
        servers = {}
        for name, cfg in (data.get("mcpServers") or {}).items():
            try:
                servers[name] = _clean_server(cfg)
            except ConnectorError:
                continue
        builtins = data.get("builtins") or {}
        return {"mcpServers": servers, "builtins": {k: v for k, v in builtins.items() if isinstance(v, dict)}}

    def _save(self):
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        tmp = self.config_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=2)
        os.replace(tmp, self.config_path)

    def _builtin_cfg(self, name):
        return self.config["builtins"].setdefault(name, {"enabled": True, "approvals": {}})

    # Running connectors

    def _stop(self, name):
        conn = self.conns.pop(name, None)
        self.tools.pop(name, None)
        if conn:
            conn.close()

    def _ensure(self, name):
        """Start a connector if it's enabled and not running. Returns its tools."""
        if name in self.builtins:
            return self.builtins[name]["tools"]
        cfg = self.config["mcpServers"][name]
        conn = self.conns.get(name)
        if conn and conn.alive:
            return self.tools[name]
        self._stop(name)
        try:
            conn = mcp_client.connect(name, cfg)
            tools = conn.list_tools()
        except MCPError as e:
            if conn:
                conn.close()
            self.errors[name] = str(e)
            raise
        self.conns[name], self.tools[name] = conn, tools
        self.errors.pop(name, None)
        return tools

    def _cfg(self, name):
        if name in self.builtins:
            return self._builtin_cfg(name)
        if name not in self.config["mcpServers"]:
            raise ConnectorError(f"There is no connector called {name}.")
        return self.config["mcpServers"][name]

    def status(self, connect=True):
        """Every connector with its settings, state and tools, for the settings page."""
        with self.lock:
            rows = []
            for name, info in self.builtins.items():
                cfg = self._builtin_cfg(name)
                rows.append(self._row(name, cfg, "builtin", info["tools"], None, info["description"]))
            for name, cfg in self.config["mcpServers"].items():
                tools, error = [], None
                if cfg["enabled"] and connect:
                    try:
                        tools = self._ensure(name)
                    except MCPError as e:
                        error = str(e)
                kind = "remote" if cfg.get("url") else "local"
                rows.append(self._row(name, cfg, kind, tools, error, None))
            return rows

    @staticmethod
    def _row(name, cfg, kind, tools, error, description):
        settings = {k: v for k, v in cfg.items() if k not in ("enabled", "approvals")}
        return {
            "name": name, "kind": kind, "enabled": cfg["enabled"], "error": error,
            "description": description, "settings": settings,
            "tools": [{
                "name": t["name"],
                "title": t.get("title") or (t.get("annotations") or {}).get("title") or t["name"],
                "description": (t.get("description") or "").strip(),
                "approval": cfg["approvals"].get(t["name"], "ask"),
                "read_only": bool((t.get("annotations") or {}).get("readOnlyHint")),
            } for t in tools],
        }

    def add(self, name, cfg, replace=False):
        name = _clean_name(name)
        cfg = _clean_server(cfg)
        with self.lock:
            if name in self.builtins or (name in self.config["mcpServers"] and not replace):
                raise ConnectorError(f"A connector called {name} already exists.")
            old = self.config["mcpServers"].get(name)
            if old:
                cfg["approvals"] = {**old["approvals"], **cfg["approvals"]}
            self._stop(name)
            self.config["mcpServers"][name] = cfg
            self._save()
            error = None
            if cfg["enabled"]:
                try:
                    self._ensure(name)
                except MCPError as e:
                    error = str(e)
            return {"name": name, "error": error}

    def import_config(self, text):
        """Add every connector from a pasted {"mcpServers": {...}} block."""
        try:
            data = json.loads(text)
        except ValueError:
            raise ConnectorError("That isn't valid JSON. Paste the whole block, including the outer { }.")
        if not isinstance(data, dict):
            raise ConnectorError("Paste a JSON object like {\"mcpServers\": {...}}.")
        servers = data.get("mcpServers") or data.get("servers") or data
        added = []
        for name, cfg in servers.items():
            if isinstance(cfg, dict) and cfg.get("type") in ("sse",):
                raise ConnectorError(f"{name} uses the old SSE connection type, which this app doesn't support.")
            added.append(self.add(name, cfg, replace=True))
        if not added:
            raise ConnectorError("No connectors found in that text.")
        return added

    def remove(self, name):
        with self.lock:
            if name in self.builtins:
                raise ConnectorError("Built-in connectors can be turned off but not removed.")
            self._stop(name)
            self.config["mcpServers"].pop(name, None)
            self.errors.pop(name, None)
            self._save()

    def set_enabled(self, name, enabled):
        with self.lock:
            cfg = self._cfg(name)
            cfg["enabled"] = bool(enabled)
            self.errors.pop(name, None)
            if not enabled:
                self._stop(name)
            self._save()

    def set_approval(self, name, tool, choice):
        if choice not in APPROVAL_CHOICES:
            raise ConnectorError("Choose ask, always or off.")
        with self.lock:
            self._cfg(name)["approvals"][tool] = choice
            self._save()

    def reconnect(self, name):
        with self.lock:
            self._cfg(name)
            self._stop(name)
            self.errors.pop(name, None)

    def close_all(self):
        with self.lock:
            for name in list(self.conns):
                self._stop(name)

    # Tools for the model

    def model_tools(self):
        """Tools the model may use right now: (Ollama tool specs, key -> (connector, tool, title))."""
        specs, index = [], {}
        with self.lock:
            names = [n for n in self.builtins if self._builtin_cfg(n)["enabled"]]
            names += [n for n, c in self.config["mcpServers"].items() if c["enabled"]]
            for name in names:
                if name in self.errors:
                    continue  # failed last time; the settings page shows why and can retry
                try:
                    tools = self._ensure(name)
                except MCPError:
                    continue  # a broken connector shouldn't stop the chat; the settings page shows why
                approvals = self._cfg(name)["approvals"]
                for tool in tools:
                    if approvals.get(tool["name"]) == "off":
                        continue
                    key = _tool_key(name, tool["name"])
                    index[key] = (name, tool["name"], tool.get("title") or tool["name"])
                    specs.append({"type": "function", "function": {
                        "name": key,
                        "description": (f"[{name}] " + (tool.get("description") or ""))[:1024],
                        "parameters": tool.get("inputSchema") or {"type": "object", "properties": {}},
                    }})
        return specs, index

    def describe_call(self, key, index):
        name, tool, title = index[key]
        approval = self._cfg(name)["approvals"].get(tool, "ask")
        return {"connector": name, "tool": tool, "title": title, "approval": approval}

    def call(self, key, arguments, model=None):
        """Run a tool the user approved. Returns {"text", "is_error", "link"}."""
        _, index = self.model_tools()
        if key not in index:
            raise ConnectorError("That tool isn't available any more. It may have been turned off.")
        name, tool, _ = index[key]
        if name in self.builtins:
            text, is_error, link = self.builtins[name]["call"](tool, arguments, model)
        else:
            try:
                with self.lock:
                    self._ensure(name)
                    conn = self.conns[name]
                text, is_error = conn.call_tool(tool, arguments)
            except MCPError as e:
                text, is_error = f"The tool failed: {e}", True
            link = None
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS] + f"\n[... cut to the first {MAX_RESULT_CHARS} characters]"
        return {"text": text, "is_error": is_error, "link": link}


# ---------- Hooks for the chat server ----------

def clean_messages(messages):
    """Keep only the fields Ollama understands; the page stores extra display info."""
    out = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant", "tool"):
            continue
        msg = {"role": m["role"], "content": str(m.get("content") or "")}
        if m["role"] == "assistant" and isinstance(m.get("tool_calls"), list):
            msg["tool_calls"] = [{"function": {"name": str(c["function"].get("name", "")),
                                               "arguments": c["function"].get("arguments") or {}}}
                                 for c in m["tool_calls"] if isinstance(c, dict) and isinstance(c.get("function"), dict)]
        if m["role"] == "tool" and m.get("tool_name"):
            msg["tool_name"] = str(m["tool_name"])
        out.append(msg)
    return out


def add_tools(manager, payload, messages, capabilities):
    """
    Add the connectors' tools to an Ollama /api/chat payload whose first message is
    the system prompt. Returns events to send the page first (a notice when the
    chosen model can't use tools).
    """
    payload["messages"] = payload["messages"][:1] + clean_messages(messages)
    tools, _ = manager.model_tools()
    if not tools:
        return []
    if "tools" not in capabilities:
        return [{"type": "notice", "text": (
            "This model can't use connectors. To use them, pick a model that supports tools, "
            "such as Qwen 3 (install it with: ollama pull qwen3:8b).")}]
    payload["tools"] = tools
    payload["messages"][0] = {"role": "system", "content": payload["messages"][0]["content"] + "\n\n" + TOOLS_PROMPT}
    return []


def tool_calls_event(manager, calls):
    """Describe the tools a model asked for, so the page can show them and ask the user."""
    _, index = manager.model_tools()
    out = []
    for call in calls:
        fn = call.get("function", {})
        key, args = fn.get("name", ""), fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        entry = {"name": key, "arguments": args if isinstance(args, dict) else {}}
        if key in index:
            entry.update(manager.describe_call(key, index))
        else:
            entry.update({"connector": None, "tool": key, "title": key, "approval": "missing"})
        out.append(entry)
    return {"type": "tool_calls", "calls": out}
