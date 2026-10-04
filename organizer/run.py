"""
Try the Folder Organizer on its own, without the chatbot.

Run it with:  python run.py   (then open http://localhost:8001/organizer)
The chatbot server can serve the same page once it is plugged in (see README.md).
"""

import json
import os
import sys
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import organizer
import organizer_routes

PORT = int(os.environ.get("PORT", "8001"))


class OrganizerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if organizer_routes.handle(self):
            return
        if self.path == "/api/models":
            return self.list_models()
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/organizer")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        if not organizer_routes.handle(self):
            self.send_error(404)

    def list_models(self):
        """Same as the chatbot's /api/models, so the page can offer a model list."""
        try:
            with urllib.request.urlopen(f"{organizer.OLLAMA_URL}/api/tags", timeout=5) as resp:
                names = [m["name"] for m in json.load(resp).get("models", [])]
            body, status = {"models": names}, 200
        except (urllib.error.URLError, OSError):
            body, status = {"error": "Ollama is not running, so plans will sort files by type."}, 503
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), OrganizerHandler)
    url = f"http://localhost:{PORT}/organizer"
    print(f"Folder Organizer is running at {url}")
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
