"""
A small Model Context Protocol (MCP) client using only Python's standard library.

MCP is the open standard that Claude, ChatGPT, Cursor and many other AI apps use to
plug in third-party tools ("connectors"). A connector is an MCP server, and it
comes in one of two shapes:

  * a local program the app starts and talks to over stdin/stdout
    (for example `npx -y @modelcontextprotocol/server-filesystem ~/Documents`)
  * a remote web address that speaks "Streamable HTTP"
    (for example https://example.com/mcp)

Both carry the same JSON-RPC 2.0 messages. This file only needs three of them:
initialize, tools/list and tools/call.
"""

import itertools
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from collections import deque

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "local-ai-chat", "version": "1.0"}
START_TIMEOUT = 120  # the first `npx -y ...` run downloads the package, which can be slow
CALL_TIMEOUT = 120


class MCPError(Exception):
    """Anything that went wrong talking to a connector, in words a user can read."""


def _tool_result_text(result):
    """Turn a tools/call result into plain text the model can read."""
    parts = []
    for item in result.get("content") or []:
        kind = item.get("type")
        if kind == "text":
            parts.append(item.get("text", ""))
        elif kind == "resource":
            res = item.get("resource", {})
            parts.append(res.get("text") or f"[file: {res.get('uri', '')}]")
        elif kind == "resource_link":
            parts.append(f"[link: {item.get('name') or ''} {item.get('uri', '')}]".strip())
        elif kind in ("image", "audio"):
            parts.append(f"[{kind} returned by the tool; it can't be shown to this model]")
    if not parts and result.get("structuredContent") is not None:
        parts.append(json.dumps(result["structuredContent"], indent=2))
    return "\n".join(parts).strip() or "(the tool returned nothing)"


class _Connection:
    """Shared request logic. Subclasses supply _send() and _request()."""

    def __init__(self, name):
        self.name = name
        self._ids = itertools.count(1)
        self.server_info = {}

    def start(self):
        result = self._request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": CLIENT_INFO,
        }, timeout=START_TIMEOUT)
        self.server_info = result.get("serverInfo", {})
        self._notify("notifications/initialized")

    def list_tools(self):
        tools, cursor = [], None
        while True:
            result = self._request("tools/list", {"cursor": cursor} if cursor else {})
            tools.extend(result.get("tools", []))
            cursor = result.get("nextCursor")
            if not cursor:
                return tools

    def call_tool(self, tool, arguments):
        """Run a tool. Returns (text, is_error)."""
        result = self._request("tools/call", {"name": tool, "arguments": arguments or {}}, timeout=CALL_TIMEOUT)
        return _tool_result_text(result), bool(result.get("isError"))

    def close(self):
        pass


class StdioConnection(_Connection):
    """A connector that is a program on this computer, talked to over stdin/stdout."""

    def __init__(self, name, command, args=None, env=None, cwd=None):
        super().__init__(name)
        self._pending = {}
        self._lock = threading.Lock()
        self._stderr = deque(maxlen=20)
        self._proc = None
        self._closed = False
        self._spawn(command, args or [], env or {}, cwd)

    def _spawn(self, command, args, env, cwd):
        # "python" works the same on every computer: use the Python running this app.
        if command in ("python", "python3", "py"):
            exe = sys.executable
        else:
            # On Windows, `npx` is really `npx.cmd`; which() finds it.
            exe = shutil.which(command) or command
        full_env = {**os.environ, **{k: str(v) for k, v in env.items()}}
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        try:
            self._proc = subprocess.Popen(
                [exe, *[os.path.expanduser(str(a)) for a in args]],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=full_env, cwd=cwd, creationflags=flags,
            )
        except OSError as e:
            raise MCPError(f"Could not start `{command}`: {e.strerror or e}. Is it installed?") from e
        threading.Thread(target=self._read_stdout, daemon=True).start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()

    def _read_stderr(self):
        try:
            for line in self._proc.stderr:
                self._stderr.append(line.decode("utf-8", "replace").rstrip())
        except (OSError, ValueError):
            pass  # closed

    def _read_stdout(self):
        try:
            self._read_messages()
        except (OSError, ValueError):
            pass  # closed
        # The program exited: wake everyone still waiting.
        with self._lock:
            waiters, self._pending = list(self._pending.values()), {}
        for waiter in waiters:
            waiter["event"].set()

    def _read_messages(self):
        for line in self._proc.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue  # some servers print log lines to stdout; skip them
            if not isinstance(msg, dict):
                continue
            if "method" in msg and "id" in msg:
                self._answer_server_request(msg)
            elif "id" in msg:
                with self._lock:
                    waiter = self._pending.pop(msg["id"], None)
                if waiter:
                    waiter["msg"] = msg
                    waiter["event"].set()
            # Notifications (no id) such as log messages are ignored.

    def _answer_server_request(self, msg):
        if msg["method"] == "ping":
            self._write({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
        else:
            self._write({"jsonrpc": "2.0", "id": msg["id"],
                         "error": {"code": -32601, "message": "Not supported by this app"}})

    def _write(self, msg):
        try:
            self._proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
            self._proc.stdin.flush()
        except (OSError, ValueError) as e:
            raise MCPError(self._exit_message()) from e

    def _exit_message(self):
        try:
            self._proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        self._stderr_thread.join(timeout=1)  # so its last words are in the message
        detail = "\n".join(list(self._stderr)[-5:])
        msg = f"The connector program stopped (exit code {self._proc.poll()})."
        return f"{msg}\n{detail}" if detail else msg

    def _notify(self, method, params=None):
        self._write({"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})})

    def _request(self, method, params, timeout=CALL_TIMEOUT):
        msg_id = next(self._ids)
        waiter = {"event": threading.Event(), "msg": None}
        with self._lock:
            self._pending[msg_id] = waiter
        self._write({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params})
        if not waiter["event"].wait(timeout):
            with self._lock:
                self._pending.pop(msg_id, None)
            raise MCPError(f"The connector took longer than {timeout} seconds to answer.")
        reply = waiter["msg"]
        if reply is None:
            raise MCPError(self._exit_message())
        if "error" in reply:
            raise MCPError(reply["error"].get("message", "The connector reported an error."))
        return reply.get("result", {})

    @property
    def alive(self):
        return self._proc.poll() is None

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._proc.stdin.close()
            self._proc.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            self._proc.kill()
            self._proc.wait()
        for pipe in (self._proc.stdout, self._proc.stderr):
            pipe.close()


class HttpConnection(_Connection):
    """A connector at a web address, using MCP's Streamable HTTP transport."""

    def __init__(self, name, url, headers=None):
        super().__init__(name)
        self.url = url
        self.headers = dict(headers or {})
        self.session_id = None
        self.alive = True

    def _post(self, msg, timeout):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            **self.headers,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(self.url, data=json.dumps(msg).encode("utf-8"), headers=headers, method="POST")
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise MCPError("The connector refused access. Check the access token in its settings.") from e
            detail = e.read().decode("utf-8", "replace")[:300]
            raise MCPError(f"The connector answered with error {e.code}. {detail}".strip()) from e
        except (urllib.error.URLError, OSError) as e:
            reason = getattr(e, "reason", e)
            raise MCPError(f"Could not reach {self.url}: {reason}") from e

    def _notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})}
        self._post(msg, 30).close()

    def _request(self, method, params, timeout=CALL_TIMEOUT):
        msg_id = next(self._ids)
        msg = {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}
        with self._post(msg, timeout) as resp:
            if resp.headers.get("Mcp-Session-Id"):
                self.session_id = resp.headers["Mcp-Session-Id"]
            kind = resp.headers.get("Content-Type", "")
            if "text/event-stream" in kind:
                reply = self._read_sse(resp, msg_id)
            else:
                reply = json.loads(resp.read() or b"{}")
        if isinstance(reply, list):  # a batch; pick ours
            reply = next((m for m in reply if m.get("id") == msg_id), {})
        if not reply:
            raise MCPError("The connector closed the connection without answering.")
        if "error" in reply:
            raise MCPError(reply["error"].get("message", "The connector reported an error."))
        return reply.get("result", {})

    @staticmethod
    def _read_sse(resp, msg_id):
        """Read Server-Sent Events until the reply to our request arrives."""
        data = []
        for raw in resp:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line.startswith("data:"):
                data.append(line[5:].lstrip())
            elif not line and data:
                try:
                    msg = json.loads("\n".join(data))
                except ValueError:
                    msg = None
                data = []
                if isinstance(msg, dict) and msg.get("id") == msg_id and "method" not in msg:
                    return msg
        return None

    def close(self):
        if self.session_id:
            req = urllib.request.Request(self.url, method="DELETE",
                                         headers={**self.headers, "Mcp-Session-Id": self.session_id})
            try:
                urllib.request.urlopen(req, timeout=5).close()
            except (urllib.error.URLError, OSError):
                pass
        self.alive = False


def connect(name, config):
    """Start a connector from its settings and return a ready connection."""
    if config.get("url"):
        conn = HttpConnection(name, config["url"], config.get("headers"))
    elif config.get("command"):
        conn = StdioConnection(name, config["command"], config.get("args"), config.get("env"), config.get("cwd"))
    else:
        raise MCPError("A connector needs either a command to run or a URL.")
    try:
        conn.start()
    except MCPError:
        conn.close()
        raise
    return conn
