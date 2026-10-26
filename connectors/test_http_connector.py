"""
Tests for connectors at a web address (MCP's Streamable HTTP transport), using a
small fake MCP server on this computer.

Run them with:  python -m unittest test_http_connector.py
"""

import json
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mcp_client


class FakeMCP(BaseHTTPRequestHandler):
    sessions = set()  # forgetting these is what a server restart looks like
    sse = False  # answer as Server-Sent Events instead of plain JSON
    trailing_blank = True  # end each event with the blank line SSE expects

    def log_message(self, *args):
        pass

    def do_POST(self):
        msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        sid = self.headers.get("Mcp-Session-Id")
        if msg["method"] == "initialize":
            sid = uuid.uuid4().hex
            FakeMCP.sessions.add(sid)
        elif sid not in FakeMCP.sessions:
            self.send_response(404)
            self.end_headers()
            return
        if "id" not in msg:  # a notification
            self.send_response(202)
            self.end_headers()
            return
        result = {
            "initialize": {"serverInfo": {"name": "fake"}},
            "tools/list": {"tools": [{"name": "echo", "inputSchema": {"type": "object"}}]},
            "tools/call": {"content": [{"type": "text", "text": f"echo {msg.get('params', {}).get('arguments')}"}]},
        }[msg["method"]]
        reply = json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result})
        body = (f"data: {reply}\n" + ("\n" if FakeMCP.trailing_blank else "")) if FakeMCP.sse else reply
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if FakeMCP.sse else "application/json")
        self.send_header("Mcp-Session-Id", sid)
        self.send_header("Content-Length", str(len(body.encode())))
        self.end_headers()
        self.wfile.write(body.encode())


class HttpConnectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeMCP)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.httpd.server_port}/mcp"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def setUp(self):
        FakeMCP.sse, FakeMCP.trailing_blank = False, True

    def test_lists_and_calls_tools(self):
        conn = mcp_client.connect("fake", {"url": self.url})
        self.assertEqual([t["name"] for t in conn.list_tools()], ["echo"])
        self.assertEqual(conn.call_tool("echo", {"x": 1}), ("echo {'x': 1}", False))

    def test_server_restart_starts_a_new_session(self):
        conn = mcp_client.connect("fake", {"url": self.url})
        FakeMCP.sessions.clear()  # the server restarted and forgot every session
        self.assertEqual(conn.call_tool("echo", {"x": 2}), ("echo {'x': 2}", False))
        self.assertIn(conn.session_id, FakeMCP.sessions)

    def test_reads_server_sent_events(self):
        FakeMCP.sse = True
        conn = mcp_client.connect("fake", {"url": self.url})
        self.assertEqual(conn.call_tool("echo", {}), ("echo {}", False))

    def test_last_event_without_blank_line_is_still_read(self):
        FakeMCP.sse, FakeMCP.trailing_blank = True, False
        conn = mcp_client.connect("fake", {"url": self.url})
        self.assertEqual([t["name"] for t in conn.list_tools()], ["echo"])


if __name__ == "__main__":
    unittest.main()
