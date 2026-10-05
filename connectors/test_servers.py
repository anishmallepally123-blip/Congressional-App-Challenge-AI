"""
Tests for the built-in connectors in servers/. Run from this folder with:
    python -m unittest test_servers

The ones that talk to online services (Weather, Wikipedia, Notion, Slack, Google) are
pointed at a small stand-in web server on this computer, so no accounts are needed.
"""

import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
import zipfile
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import connectors  # noqa: E402
import mcp_client  # noqa: E402

SERVERS = os.path.join(HERE, "servers")


class FakeAPI:
    """A stand-in web server. `routes` maps "METHOD /path" to a JSON answer or a function."""

    def __init__(self, routes):
        self.routes, self.requests = routes, []
        api = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _answer(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode() if length else ""
                path = urllib.parse.urlsplit(self.path).path
                api.requests.append({"method": self.command, "path": self.path, "body": body, "headers": dict(self.headers)})
                answer = api.routes.get(f"{self.command} {path}")
                if callable(answer):
                    answer = answer(self, body)
                status, payload = (200, answer) if not isinstance(answer, tuple) else answer
                if payload is None:
                    status, payload = 404, {"message": "not found"}
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "text/plain" if isinstance(payload, str) else "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_PATCH = _answer

            def log_message(self, *args):
                pass

        self.httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conns = []

    def tearDown(self):
        for c in self.conns:
            c.close()
        self.tmp.cleanup()

    def start(self, script, *args, env=None):
        cfg = {"command": "python", "args": [os.path.join(SERVERS, script), *args], "env": env or {}}
        conn = mcp_client.connect(script, cfg)
        self.conns.append(conn)
        return conn

    def tools(self, conn):
        return {t["name"] for t in conn.list_tools()}

    def call(self, conn, tool, **args):
        return conn.call_tool(tool, args)


class FilesTests(ServerTestCase):
    def setUp(self):
        super().setUp()
        self.root = os.path.join(self.tmp.name, "docs")
        os.makedirs(os.path.join(self.root, "school"))
        with open(os.path.join(self.root, "school", "essay.txt"), "w") as f:
            f.write("My essay is about photosynthesis in plants.")
        with zipfile.ZipFile(os.path.join(self.root, "report.docx"), "w") as z:
            z.writestr("word/document.xml", "<w:document><w:p><w:r><w:t>Lab report &amp; results</w:t></w:r></w:p></w:document>")
        with open(os.path.join(self.tmp.name, "secret.txt"), "w") as f:
            f.write("outside")
        self.conn = self.start("files_server.py", self.root)

    def test_tools(self):
        self.assertEqual(self.tools(self.conn), {"list_folder", "read_file", "search_files", "write_file"})

    def test_list_read_search(self):
        text, err = self.call(self.conn, "list_folder")
        self.assertFalse(err)
        self.assertIn("school/", text)
        self.assertIn("report.docx", text)
        self.assertIn("photosynthesis", self.call(self.conn, "read_file", path="school/essay.txt")[0])
        self.assertIn("Lab report & results", self.call(self.conn, "read_file", path="report.docx")[0])
        self.assertIn("school/essay.txt", self.call(self.conn, "search_files", query="photosynthesis")[0])
        self.assertIn("report.docx", self.call(self.conn, "search_files", query="results")[0])

    def test_cannot_leave_the_folder(self):
        for path in ("../secret.txt", os.path.join(self.tmp.name, "secret.txt")):
            text, err = self.call(self.conn, "read_file", path=path)
            self.assertTrue(err)
            self.assertIn("outside", text)
        text, err = self.call(self.conn, "write_file", path="../evil.txt", content="x")
        self.assertTrue(err)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "evil.txt")))

    def test_write(self):
        text, err = self.call(self.conn, "write_file", path="notes/todo.txt", content="buy milk")
        self.assertFalse(err, text)
        with open(os.path.join(self.root, "notes", "todo.txt")) as f:
            self.assertEqual(f.read(), "buy milk")

    def test_missing_folder_is_a_clear_error(self):
        with self.assertRaises(mcp_client.MCPError) as ctx:
            self.start("files_server.py", os.path.join(self.tmp.name, "nope"))
        self.assertIn("doesn't exist", str(ctx.exception).split("\n")[0])


class MemoryTests(ServerTestCase):
    def test_remember_recall_forget(self):
        conn = self.start("memory_server.py", env={"MEMORY_PATH": os.path.join(self.tmp.name, "m.json")})
        self.assertIn("#1", self.call(conn, "remember", fact="The user's favorite subject is biology.")[0])
        self.assertEqual(self.call(conn, "remember", fact="the user's favorite subject is biology.")[0], "Already remembered.")
        self.assertIn("biology", self.call(conn, "recall", search="subject")[0])
        self.assertIn("Forgot", self.call(conn, "forget", id=1)[0])
        self.assertEqual(self.call(conn, "recall")[0], "Nothing saved yet.")
        self.assertTrue(self.call(conn, "forget", id=9)[1])


class WebTests(ServerTestCase):
    def test_html_to_text(self):
        sys.path.insert(0, SERVERS)
        import web_server
        title, text = web_server.html_to_text(
            "<html><head><title>Hi</title><script>x()</script></head><body><h1>Big</h1><p>One &amp; two</p>"
            "<ul><li>a</li></ul><footer>skip me</footer></body></html>")
        self.assertEqual(title, "Hi")
        self.assertIn("## Big", text)
        self.assertIn("One & two", text)
        self.assertIn("- a", text)
        self.assertNotIn("x()", text)
        self.assertNotIn("skip me", text)

    def test_refuses_local_addresses(self):
        conn = self.start("web_server.py")
        for url in ("http://127.0.0.1:8000/api/connectors", "http://localhost/", "http://192.168.1.1/", "file:///etc/passwd"):
            text, err = self.call(conn, "fetch_page", url=url)
            self.assertTrue(err, url)


class OnlineServiceTests(ServerTestCase):
    def setUp(self):
        super().setUp()
        self.api = None

    def tearDown(self):
        super().tearDown()
        if self.api:
            self.api.close()

    def fake(self, routes):
        self.api = FakeAPI(routes)
        return self.api.url

    def test_weather(self):
        url = self.fake({
            "GET /geo": {"results": [
                {"name": "Springfield", "admin1": "Missouri", "country": "United States", "latitude": 37.2, "longitude": -93.3},
                {"name": "Springfield", "admin1": "Illinois", "admin1_code": "IL", "country": "United States", "latitude": 39.8, "longitude": -89.6},
            ]},
            "GET /forecast": {"current": {"temperature_2m": 61, "apparent_temperature": 60, "relative_humidity_2m": 50,
                                          "weather_code": 2, "wind_speed_10m": 5},
                              "daily": {"time": ["2026-10-05"], "weather_code": [61], "temperature_2m_max": [70],
                                        "temperature_2m_min": [50], "precipitation_probability_max": [40]}},
        })
        conn = self.start("weather_server.py", env={"WEATHER_GEO_API": url + "/geo", "WEATHER_API": url + "/forecast"})
        text, err = self.call(conn, "get_weather", place="Springfield, Illinois")
        self.assertFalse(err, text)
        self.assertIn("Illinois", text)
        self.assertIn("partly cloudy, 61°F", text)
        self.assertIn("light rain, high 70°F", text)
        self.assertIn("latitude=39.8", self.api.requests[-1]["path"])

    def test_wikipedia(self):
        def answer(handler, body):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
            if q.get("list") == ["search"]:
                return {"query": {"search": [{"title": "Photosynthesis", "snippet": "how <b>plants</b> make food"}]}}
            return {"query": {"pages": [{"title": "Photosynthesis", "extract": "Plants use light."}]}}
        url = self.fake({"GET /w/api.php": answer})
        conn = self.start("wikipedia_server.py", env={"WIKIPEDIA_API": url + "/w/api.php"})
        self.assertIn("Photosynthesis: how plants make food", self.call(conn, "search_wikipedia", query="plants")[0])
        text = self.call(conn, "read_article", title="Photosynthesis")[0]
        self.assertIn("Plants use light.", text)
        self.assertIn("en.wikipedia.org/wiki/Photosynthesis", text)

    def test_notion(self):
        pid = "0123456789abcdef0123456789abcdef"
        url = self.fake({
            "GET /v1/users/me": {"object": "user"},
            "POST /v1/search": {"results": [{"object": "page", "id": pid, "last_edited_time": "2026-10-01T00:00:00Z",
                                             "properties": {"Name": {"type": "title", "title": [{"plain_text": "Homework"}]}}}]},
            f"GET /v1/pages/{pid}": {"id": pid, "url": "https://notion.so/x",
                                     "properties": {"t": {"type": "title", "title": [{"plain_text": "Homework"}]}}},
            f"GET /v1/blocks/{pid}/children": {"results": [
                {"type": "to_do", "to_do": {"checked": False, "rich_text": [{"plain_text": "Math p. 42"}]}}], "has_more": False},
            f"PATCH /v1/blocks/{pid}/children": {"results": []},
        })
        conn = self.start("notion_server.py", env={"NOTION_API": url + "/v1", "NOTION_TOKEN": "ntn_test"})
        self.assertIn(f"Homework (page, edited 2026-10-01) id: {pid}", self.call(conn, "search_notion", query="home")[0])
        self.assertIn("[ ] Math p. 42", self.call(conn, "read_page", page=f"https://www.notion.so/Homework-{pid}")[0])
        self.assertIn("Added 2 blocks", self.call(conn, "append_to_page", page=pid, text="Done\n- item")[0])
        sent = json.loads(self.api.requests[-1]["body"])
        self.assertEqual([c["type"] for c in sent["children"]], ["paragraph", "bulleted_list_item"])
        self.assertEqual(self.api.requests[-1]["headers"]["Authorization"], "Bearer ntn_test")

    def test_notion_bad_token_stops_with_message(self):
        url = self.fake({"GET /v1/users/me": (401, {"message": "API token is invalid."})})
        with self.assertRaises(mcp_client.MCPError) as ctx:
            self.start("notion_server.py", env={"NOTION_API": url + "/v1", "NOTION_TOKEN": "bad"})
        self.assertIn("Notion refused access", str(ctx.exception))

    def test_slack(self):
        url = self.fake({
            "GET /api/auth.test": {"ok": True},
            "GET /api/conversations.list": {"ok": True, "channels": [{"id": "C0123456789", "name": "general", "is_member": True}]},
            "GET /api/conversations.history": {"ok": True, "messages": [{"ts": "1759600000.0", "user": "U1", "text": "hello"}]},
            "GET /api/users.info": {"ok": True, "user": {"real_name": "Ana"}},
            "POST /api/chat.postMessage": {"ok": False, "error": "not_in_channel"},
        })
        conn = self.start("slack_server.py", env={"SLACK_API": url + "/api", "SLACK_BOT_TOKEN": "xoxb-test"})
        self.assertIn("#general", self.call(conn, "list_channels")[0])
        self.assertIn("Ana: hello", self.call(conn, "read_channel", channel="#general")[0])
        text, err = self.call(conn, "post_message", channel="general", text="hi")
        self.assertTrue(err)
        self.assertIn("/invite", text)

    def test_missing_tokens_say_what_to_do(self):
        for script, key in (("notion_server.py", "NOTION_TOKEN"), ("slack_server.py", "SLACK_BOT_TOKEN"),
                            ("google_server.py", "GOOGLE_CLIENT_ID")):
            with self.assertRaises(mcp_client.MCPError) as ctx:
                self.start(script, env={key: ""})
            self.assertIn(key, str(ctx.exception).split("\n")[0], script)

    def google_env(self, url, service_path):
        token_path = os.path.join(self.tmp.name, "google.json")
        return token_path, {
            "GOOGLE_CLIENT_ID": "abc.apps.googleusercontent.com", "GOOGLE_CLIENT_SECRET": "s",
            "GOOGLE_TOKEN_PATH": token_path, "GOOGLE_TOKEN_URL": url + "/token",
            "GOOGLE_DRIVE_API": url + "/drive/v3", "GOOGLE_CALENDAR_API": url + "/calendar/v3",
        }

    def test_google_not_signed_in_does_not_open_a_browser_mid_chat(self):
        url = self.fake({})
        _, env = self.google_env(url, "")
        with self.assertRaises(mcp_client.MCPError) as ctx:
            self.start("google_server.py", "drive", env=env)
        self.assertIn("Press Reconnect", str(ctx.exception))

    def test_google_drive(self):
        url = self.fake({
            "POST /token": {"access_token": "fresh", "expires_in": 3600},
            "GET /drive/v3/files": {"files": [{"id": "doc1", "name": "Essay", "modifiedTime": "2026-10-02T00:00:00Z",
                                               "mimeType": "application/vnd.google-apps.document"}]},
            "GET /drive/v3/files/doc1": {"id": "doc1", "name": "Essay", "mimeType": "application/vnd.google-apps.document",
                                         "webViewLink": "https://docs.google.com/document/d/doc1/edit"},
            "GET /drive/v3/files/doc1/export": "The essay text.",
        })
        token_path, env = self.google_env(url, "")
        with open(token_path, "w") as f:
            json.dump({"client_id": env["GOOGLE_CLIENT_ID"], "refresh_token": "r", "access_token": "old", "expires": 0}, f)
        conn = self.start("google_server.py", "drive", env=env)
        self.assertEqual(self.tools(conn), {"search_drive", "recent_drive_files", "read_drive_file"})
        self.assertIn("Essay (document, edited 2026-10-02) id: doc1", self.call(conn, "search_drive", query="essay")[0])
        self.assertIn("The essay text.", self.call(conn, "read_drive_file", file="https://docs.google.com/document/d/doc1/edit")[0])
        self.assertEqual(self.api.requests[-1]["headers"]["Authorization"], "Bearer fresh")
        self.assertIn("grant_type=refresh_token", self.api.requests[0]["body"])

    def test_google_calendar_and_expired_sign_in(self):
        url = self.fake({
            "POST /token": {"access_token": "fresh", "expires_in": 3600},
            "GET /calendar/v3/calendars/primary/events": {"items": [
                {"summary": "Science fair", "start": {"date": "2026-10-09"}, "location": "Gym"}]},
        })
        token_path, env = self.google_env(url, "")
        with open(token_path, "w") as f:
            json.dump({"client_id": env["GOOGLE_CLIENT_ID"], "refresh_token": "r", "expires": 0}, f)
        conn = self.start("google_server.py", "calendar", env=env)
        self.assertIn("Fri Oct 09 (all day): Science fair @ Gym", self.call(conn, "upcoming_events", days=14)[0])
        # Google says the sign-in is no longer valid: the user is told to reconnect.
        os.remove(token_path)
        with open(token_path, "w") as f:
            json.dump({"client_id": env["GOOGLE_CLIENT_ID"], "refresh_token": "r", "expires": 0}, f)
        self.api.routes["POST /token"] = (400, {"error": "invalid_grant"})
        text, err = self.call(conn, "upcoming_events")
        self.assertTrue(err)
        self.assertIn("press Reconnect", text)


class PresetTests(unittest.TestCase):
    def test_every_preset_is_valid_and_its_program_exists(self):
        names = set()
        for p in connectors.presets():
            self.assertNotIn(p["name"], names)
            names.add(p["name"])
            cfg = connectors._expand(connectors._clean_server(p["config"]))
            if cfg.get("command") == "python":
                self.assertTrue(os.path.isfile(cfg["args"][0]), cfg["args"][0])
        self.assertGreaterEqual(len(names), 12)

    def test_no_extra_install_presets_all_connect(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["NOTES_PATH"] = os.path.join(tmp, "notes.json")
            manager = connectors.Manager(os.path.join(tmp, "c.json"))
            manager.builtins = {}
            try:
                for p in connectors.presets():
                    if p["group"] == "Ready to use":
                        cfg = dict(p["config"])
                        if p.get("fields"):
                            cfg["args"] = cfg["args"][:-1] + [tmp]
                        self.assertIsNone(manager.add(p["name"], cfg)["error"], p["name"])
            finally:
                manager.close_all()

    def test_old_node_presets_switch_to_built_in_when_node_is_missing(self):
        old = {"mcpServers": {
            "Files": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"]},
            "Memory": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]},
            "Web pages": {"command": "uvx", "args": ["mcp-server-fetch"]},
            "Other": {"command": "npx", "args": ["-y", "some-other-server"]},
        }}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "c.json")
            with open(path, "w") as f:
                json.dump(old, f)
            with mock.patch.object(mcp_client, "find_command", return_value=None):
                servers = connectors.Manager(path).config["mcpServers"]
        self.assertEqual(servers["Files"]["args"], ["{connectors}/servers/files_server.py", "~/Documents"])
        self.assertEqual(servers["Memory"]["args"], ["{connectors}/servers/memory_server.py"])
        self.assertEqual(servers["Web pages"]["command"], "python")
        self.assertEqual(servers["Other"]["command"], "npx")

    def test_missing_node_says_what_to_install(self):
        with mock.patch.object(mcp_client, "find_command", return_value=None):
            with self.assertRaises(mcp_client.MCPError) as ctx:
                mcp_client.connect("x", {"command": "npx", "args": ["-y", "pkg"]})
        self.assertIn("Node.js", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
