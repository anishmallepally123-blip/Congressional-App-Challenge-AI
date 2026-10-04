"""
Lets a phone (or another computer) on the same Wi-Fi use the chatbot running on
this computer. The AI still runs here; the phone just shows the chat page.

It's off by default. When it's turned on:
  - the app also listens on this computer's Wi-Fi address,
  - a phone has to type a 6-digit code shown on this computer before it can chat,
  - phones can only chat and pick models. They can't download or remove models,
    change settings, or use the folder organizer and shared files.
"""

import json
import os
import secrets
import socket
import threading
from http.server import ThreadingHTTPServer

CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".local-ai-chat", "phone.json")
MAX_WRONG_CODES = 10  # after this many wrong tries the code changes, so it can't be guessed

_lock = threading.Lock()
_server = None
_state = {"enabled": False, "code": None, "tokens": [], "ip": None, "error": None, "wrong": 0}


def _load():
    try:
        with open(CONFIG_PATH) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save():
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, "w") as f:
            json.dump({k: _state[k] for k in ("enabled", "code", "tokens")}, f)
    except OSError:
        pass


def wifi_address():
    """This computer's address on the local network, or None if it isn't on one."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # picks the network card; nothing is actually sent
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def _new_code():
    return f"{secrets.randbelow(10 ** 6):06d}"


def start(handler_class, port):
    """Turn phone access on. Returns the status."""
    global _server
    with _lock:
        _state["error"] = None
        if _server is None:
            ip = wifi_address()
            if not ip:
                _state.update(enabled=False, error="This computer isn't connected to a Wi-Fi or home network.")
                return status(port)
            try:
                _server = ThreadingHTTPServer((ip, port), handler_class)
            except OSError as e:
                _state.update(enabled=False, error=f"Couldn't open the app to your network: {e.strerror or e}")
                return status(port)
            threading.Thread(target=_server.serve_forever, daemon=True).start()
            _state["ip"] = ip
        _state["enabled"] = True
        _state["code"] = _state["code"] or _new_code()
        _save()
        return status(port)


def stop(port):
    """Turn phone access off and forget every paired phone."""
    global _server
    with _lock:
        if _server:
            _server.shutdown()
            _server.server_close()
            _server = None
        _state.update(enabled=False, tokens=[], code=None, ip=None, error=None, wrong=0)
        _save()
        return status(port)


def restore(handler_class, port):
    """At startup, turn phone access back on if it was on last time."""
    saved = _load()
    _state["tokens"] = [t for t in saved.get("tokens", []) if isinstance(t, str)]
    _state["code"] = saved.get("code")
    if saved.get("enabled"):
        start(handler_class, port)


def status(port):
    ip = _state["ip"]
    return {
        "enabled": _state["enabled"],
        "url": f"http://{ip}:{port}" if _state["enabled"] and ip else None,
        "code": _state["code"] if _state["enabled"] else None,
        "phones": len(_state["tokens"]),
        "error": _state["error"],
    }


def address():
    """The Wi-Fi address the app is open on, or None."""
    return _state["ip"] if _state["enabled"] else None


def pair(code):
    """Check a code typed on a phone. Returns a token to remember the phone, or None."""
    with _lock:
        if not _state["enabled"] or not _state["code"]:
            return None
        if not secrets.compare_digest(str(code).strip(), _state["code"]):
            _state["wrong"] += 1
            if _state["wrong"] >= MAX_WRONG_CODES:
                _state.update(code=_new_code(), wrong=0)
                _save()
            return None
        token = secrets.token_urlsafe(24)
        _state["tokens"].append(token)
        _state["wrong"] = 0
        _save()
        return token


def is_paired(cookie_header):
    if not _state["enabled"] or not cookie_header:
        return False
    for part in cookie_header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == "phone" and any(secrets.compare_digest(value, t) for t in _state["tokens"]):
            return True
    return False
