"""
Tests that other websites can't use the app through the browser. A site can point its
own name at 127.0.0.1 ("DNS rebinding"); the server must then refuse it because the
browser sends that site's name in the Host header.

Run them with:  python -m unittest test_security.py
"""

import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()  # keep the real ~/.local-ai-chat untouched

import server  # noqa: E402


class HostCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = ThreadingHTTPServer(("127.0.0.1", 0), server.ChatHandler)
        threading.Thread(target=cls.app.serve_forever, daemon=True).start()
        cls.port = cls.app.server_port

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.app.server_close()

    def request(self, method, path, host, body=None, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.putrequest(method, path, skip_host=True)
        conn.putheader("Host", host)
        if origin:
            conn.putheader("Origin", origin)
        data = json.dumps(body).encode() if body is not None else b""
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(len(data)))
        conn.endheaders(data)
        resp = conn.getresponse()
        resp.read()
        conn.close()
        return resp.status

    def test_own_addresses_work(self):
        for host in (f"localhost:{self.port}", f"127.0.0.1:{self.port}", f"LOCALHOST:{self.port}"):
            self.assertEqual(self.request("GET", "/", host), 200, host)

    def test_other_site_names_are_refused(self):
        for host in (f"evil.test:{self.port}", "evil.test", f"localhost.evil.test:{self.port}", "localhost"):
            self.assertEqual(self.request("GET", "/api/personal/export", host), 403, host)

    def test_rebound_site_cannot_share_a_folder(self):
        host = f"evil.test:{self.port}"
        status = self.request("POST", "/api/files/share", host,
                              {"folder": os.environ["HOME"]}, origin=f"http://{host}")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
