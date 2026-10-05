"""
Google connector: read your Google Drive files or your Google Calendar.

    python google_server.py drive        (or: calendar)
    with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set

Google only lets apps read your files after you sign in, and every app needs its own
"OAuth client" from Google. This app is a student project that runs on your computer,
so you make your own (free, about 10 minutes, once):

  1. Go to https://console.cloud.google.com, sign in, and create a project
     (top bar > project picker > New project).
  2. APIs & Services > Library: turn on "Google Drive API" and/or "Google Calendar API".
  3. APIs & Services > OAuth consent screen (Google Auth Platform): fill in an app name
     and your email, choose "External", and under Audience > Test users add your own
     Google account.
  4. APIs & Services > Credentials > Create credentials > OAuth client ID >
     Application type "Desktop app". Copy the Client ID and Client secret.
  5. Paste them on the Connectors page as GOOGLE_CLIENT_ID=... and GOOGLE_CLIENT_SECRET=...
     and press Add and connect. A browser tab opens: sign in and press Allow.

This connector only asks to READ (Drive and Calendar read-only). The sign-in is saved
in ~/.local-ai-chat/google-<drive|calendar>.json on this computer; delete that file
(or remove access at myaccount.google.com/permissions) to sign out. While the Google
project is in "Testing", Google ends the sign-in after 7 days; press Reconnect then.

No sign-in at all? Install Google Drive for desktop and use the "Google Drive folder"
connector instead: it reads the copy of your Drive that lives on this computer.
"""

import base64
import datetime
import hashlib
import http.server
import json
import os
import secrets
import sys
import threading
import time
import urllib.parse
import webbrowser

from mcp_server import Server, ToolError, http_json, need_env, setup_error

SERVICES = {
    "drive": {"scope": "https://www.googleapis.com/auth/drive.readonly", "api": "Google Drive API"},
    "calendar": {"scope": "https://www.googleapis.com/auth/calendar.readonly", "api": "Google Calendar API"},
}
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
DRIVE_API = os.environ.get("GOOGLE_DRIVE_API", "https://www.googleapis.com/drive/v3")
CALENDAR_API = os.environ.get("GOOGLE_CALENDAR_API", "https://www.googleapis.com/calendar/v3")
SIGN_IN_WAIT = 100  # seconds; the app waits up to 120 for a connector to start
MAX_CHARS = 15000
HOW = ("Make a free OAuth client (Desktop app) at console.cloud.google.com > APIs & Services > Credentials, "
       "and paste its ID and secret on the Connectors page. The steps are in connectors/README.md.")

SERVICE = (sys.argv[1] if len(sys.argv) > 1 else "drive").strip().lower()
if SERVICE not in SERVICES:
    setup_error("The argument must be drive or calendar.")
TOKEN_PATH = os.environ.get(
    "GOOGLE_TOKEN_PATH", os.path.join(os.path.expanduser("~"), ".local-ai-chat", f"google-{SERVICE}.json"))
CLIENT_ID = CLIENT_SECRET = ""
server = Server(f"google-{SERVICE}")


# ---------- Signing in (OAuth for installed apps, with PKCE) ----------

def _save_token(token):
    os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        json.dump(token, f)
    try:
        os.chmod(TOKEN_PATH, 0o600)
    except OSError:
        pass


def _load_token():
    try:
        with open(TOKEN_PATH, encoding="utf-8") as f:
            token = json.load(f)
        return token if token.get("refresh_token") and token.get("client_id") == CLIENT_ID else None
    except (OSError, ValueError):
        return None


def sign_in():
    """Open Google's sign-in page and wait for the user to press Allow."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            if q.get("state", [""])[0] != state:
                self.send_response(404)
                self.end_headers()
                return
            result["code"] = q.get("code", [""])[0]
            result["error"] = q.get("error", [""])[0]
            ok = bool(result["code"])
            body = (f"<!doctype html><meta charset=utf-8><title>Local AI Chat</title>"
                    f"<body style='font-family:system-ui;padding:3em;text-align:center'>"
                    f"<h2>{'Signed in to Google' if ok else 'Google sign-in was cancelled'}</h2>"
                    f"<p>You can close this tab and go back to Local AI Chat.</p>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            done.set()

        def log_message(self, *args):
            pass

    done = threading.Event()
    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    redirect = f"http://127.0.0.1:{httpd.server_port}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID, "redirect_uri": redirect, "response_type": "code",
        "scope": SERVICES[SERVICE]["scope"], "access_type": "offline", "prompt": "consent",
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    })
    if not webbrowser.open(url):
        sys.stderr.write(f"Open this address to sign in to Google: {url}\n")
    done.wait(SIGN_IN_WAIT)
    httpd.shutdown()
    if not result.get("code"):
        if result.get("error"):
            setup_error(f"Google sign-in didn't finish ({result['error']}). Press Reconnect to try again.")
        setup_error("Google sign-in didn't finish in time. Press Reconnect, then sign in and press Allow "
                    "in the browser tab that opens.")
    try:
        token = http_json(TOKEN_URL, "POST", service="Google", form={
            "code": result["code"], "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
            "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier,
        })
    except ToolError as e:
        setup_error(f"Google sign-in failed: {e} Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
    if not token.get("refresh_token"):
        setup_error("Google didn't give this app lasting access. Press Reconnect to sign in again.")
    _save_token({"client_id": CLIENT_ID, "refresh_token": token["refresh_token"],
                 "access_token": token.get("access_token"), "expires": time.time() + token.get("expires_in", 0)})


def access_token():
    token = _load_token()
    if not token:
        raise ToolError("Not signed in to Google. On the Connectors page, press Reconnect on this connector to sign in.")
    if token.get("access_token") and token.get("expires", 0) > time.time() + 60:
        return token["access_token"]
    try:
        fresh = http_json(TOKEN_URL, "POST", service="Google", form={
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
            "refresh_token": token["refresh_token"], "grant_type": "refresh_token",
        })
    except ToolError as e:
        if "invalid_grant" in str(e) or "refused" in str(e):
            os.remove(TOKEN_PATH)
            raise ToolError("The Google sign-in has expired. On the Connectors page, press Reconnect on this "
                            "connector to sign in again.") from e
        raise
    token.update(access_token=fresh["access_token"], expires=time.time() + fresh.get("expires_in", 3600))
    _save_token(token)
    return token["access_token"]


def google(url, raw=False):
    headers = {"Authorization": f"Bearer {access_token()}"}
    try:
        if raw:
            import urllib.request
            req = urllib.request.Request(url, headers={**headers, "User-Agent": "LocalAIChat/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read(MAX_CHARS * 4).decode("utf-8", "replace")
        return http_json(url, headers=headers, service="Google")
    except ToolError as e:
        if "has not been used" in str(e) or "is disabled" in str(e):
            raise ToolError(f"The {SERVICES[SERVICE]['api']} is turned off in your Google Cloud project. "
                            "Turn it on under APIs & Services > Library, wait a minute, and try again.") from e
        raise
    except OSError as e:
        raise ToolError(f"Couldn't read that from Google: {getattr(e, 'reason', e)}") from e


# ---------- Google Drive ----------

EXPORTS = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}
KINDS = {
    "document": "application/vnd.google-apps.document",
    "spreadsheet": "application/vnd.google-apps.spreadsheet",
    "presentation": "application/vnd.google-apps.presentation",
    "folder": "application/vnd.google-apps.folder",
    "pdf": "application/pdf",
}


def _kind_name(mime):
    for name, m in KINDS.items():
        if m == mime:
            return name
    return mime.split("/")[-1]


def _file_rows(files):
    return "\n".join(f"- {f['name']} ({_kind_name(f['mimeType'])}, edited {f.get('modifiedTime', '')[:10]}) id: {f['id']}"
                     for f in files)


def _file_id(text):
    text = text.strip()
    if "/d/" in text:
        return text.split("/d/")[1].split("/")[0]
    if "id=" in text:
        return urllib.parse.parse_qs(urllib.parse.urlsplit(text).query).get("id", [text])[0]
    return text


def drive_tools():
    @server.tool("Search Google Drive", read_only=True,
                 description="Find files in the user's Google Drive by name or by words inside them.",
                 params={"query": ("string", "Words to look for"),
                         "kind": ("string", "Only this kind of file", {"enum": list(KINDS)})},
                 required=["query"])
    def search_drive(query, kind=None):
        words = query.replace("\\", "").replace("'", "\\'")
        q = f"(name contains '{words}' or fullText contains '{words}') and trashed = false"
        if kind in KINDS:
            q += f" and mimeType = '{KINDS[kind]}'"
        # (Drive can't sort a fullText search, so results come in relevance order.)
        data = google(f"{DRIVE_API}/files?" + urllib.parse.urlencode({
            "q": q, "pageSize": 15, "fields": "files(id,name,mimeType,modifiedTime)"}))
        return _file_rows(data.get("files", [])) or f"No Drive files match: {query}"

    @server.tool("Recent Google Drive files", read_only=True,
                 description="List the files in Google Drive the user changed most recently.")
    def recent_drive_files():
        data = google(f"{DRIVE_API}/files?" + urllib.parse.urlencode({
            "q": "trashed = false and mimeType != 'application/vnd.google-apps.folder'", "pageSize": 15,
            "orderBy": "modifiedTime desc", "fields": "files(id,name,mimeType,modifiedTime)"}))
        return _file_rows(data.get("files", [])) or "Google Drive is empty."

    @server.tool("Read a Google Drive file", read_only=True,
                 description="Read a Google Doc, Sheet (as CSV), Slides deck, or text file from Drive by its id or link.",
                 params={"file": ("string", "The file id (from search_drive) or its link")}, required=["file"])
    def read_drive_file(file):
        fid = urllib.parse.quote(_file_id(file))
        meta = google(f"{DRIVE_API}/files/{fid}?fields=id,name,mimeType,webViewLink,size")
        mime = meta["mimeType"]
        if mime == KINDS["folder"]:
            kids = google(f"{DRIVE_API}/files?" + urllib.parse.urlencode({
                "q": f"'{meta['id']}' in parents and trashed = false", "pageSize": 50,
                "fields": "files(id,name,mimeType,modifiedTime)"}))
            return f"Folder {meta['name']}:\n" + (_file_rows(kids.get("files", [])) or "(empty)")
        if mime in EXPORTS:
            text = google(f"{DRIVE_API}/files/{fid}/export?" + urllib.parse.urlencode({"mimeType": EXPORTS[mime]}), raw=True)
        elif mime.startswith("text/") or mime in ("application/json", "application/xml"):
            text = google(f"{DRIVE_API}/files/{fid}?alt=media", raw=True)
        else:
            raise ToolError(f"{meta['name']} is a {_kind_name(mime)} file, which can't be read as text here. "
                            f"Open it in the browser: {meta.get('webViewLink', '')}")
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS] + f"\n[... cut to the first {MAX_CHARS} characters]"
        return f"{meta['name']}\n{meta.get('webViewLink', '')}\n\n{text}"


# ---------- Google Calendar ----------

def _when(ev):
    start = ev.get("start", {})
    if "date" in start:
        return datetime.date.fromisoformat(start["date"]).strftime("%a %b %d") + " (all day)"
    dt = datetime.datetime.fromisoformat(start.get("dateTime", "").replace("Z", "+00:00")).astimezone()
    return dt.strftime("%a %b %d, %I:%M %p")


def calendar_tools():
    @server.tool("Upcoming calendar events", read_only=True,
                 description="List events on the user's Google Calendar for the next few days, or matching some words.",
                 params={"days": ("integer", "How many days ahead to look, 1 to 60 (default 7)"),
                         "search": ("string", "Only events containing these words")})
    def upcoming_events(days=7, search=""):
        now = datetime.datetime.now(datetime.timezone.utc)
        end = now + datetime.timedelta(days=max(1, min(int(days or 7), 60)))
        params = {"timeMin": now.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true",
                  "orderBy": "startTime", "maxResults": 50}
        if search:
            params["q"] = search
        data = google(f"{CALENDAR_API}/calendars/primary/events?" + urllib.parse.urlencode(params))
        rows = []
        for ev in data.get("items", []):
            line = f"- {_when(ev)}: {ev.get('summary', '(no title)')}"
            if ev.get("location"):
                line += f" @ {ev['location']}"
            rows.append(line)
        return "\n".join(rows) or "Nothing on the calendar for that time."

    @server.tool("List calendars", read_only=True, description="List the user's Google calendars.")
    def list_calendars():
        data = google(f"{CALENDAR_API}/users/me/calendarList")
        return "\n".join(f"- {c.get('summary')}{' (main)' if c.get('primary') else ''}"
                         for c in data.get("items", [])) or "No calendars."


if __name__ == "__main__":
    CLIENT_ID = need_env("GOOGLE_CLIENT_ID", HOW)
    CLIENT_SECRET = need_env("GOOGLE_CLIENT_SECRET", HOW)
    if not CLIENT_ID.endswith(".apps.googleusercontent.com"):
        setup_error("GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com. Copy the Client ID of a "
                    "Desktop app OAuth client from console.cloud.google.com > APIs & Services > Credentials.")
    if not _load_token():
        if os.environ.get("LOCAL_AI_CHAT_SIGN_IN") != "1":
            setup_error("Not signed in to Google yet. Press Reconnect on this connector to sign in.")
        sign_in()
    drive_tools() if SERVICE == "drive" else calendar_tools()
    server.run()
