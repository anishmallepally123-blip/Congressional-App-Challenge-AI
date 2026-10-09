"""
Local AI Chat - a tiny web server for a chatbot that runs entirely on your computer.

It does three jobs:
  1. Serves the chat web page (the files in the "static" folder).
  2. Checks what this computer can handle and which AI models fit (hardware.py, models.py).
  3. Passes chat messages to Ollama, which runs the AI model locally,
     and streams the model's reply back to the page word by word.

It only uses Python's standard library, so there is nothing to pip install.
Run it with:  python server.py   (then open http://localhost:8000)
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import hardware
import models
import personal
import phone
import router
import tinygpt

HERE = os.path.dirname(os.path.abspath(__file__))

# The Folder Organizer lives next to this folder; load its web routes if it's there.
sys.path.insert(0, os.path.join(HERE, "..", "organizer"))
try:
    import organizer_routes
    import shared_files
except ImportError:
    organizer_routes = shared_files = None

# Connectors (third-party tools using the Model Context Protocol) live next to this folder too.
sys.path.insert(0, os.path.join(HERE, "..", "connectors"))
try:
    import connectors_routes
except ImportError:
    connectors_routes = None

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
PORT = int(os.environ.get("PORT", "8000"))
STATIC_DIR = os.path.join(HERE, "static")

SYSTEM_PROMPT = (
    "You are a helpful, friendly AI assistant running locally on the user's computer. "
    "Answer clearly and accurately. Use Markdown for formatting: headings, lists, "
    "tables and fenced code blocks with a language tag. If you are not sure about "
    "something, say so instead of guessing."
)

TITLE_PROMPT = (
    "Write a short title (3 to 6 words) that sums up what this chat is about. "
    "Do not copy the user's message word for word. Reply with only the title: "
    "no quotes, no ending punctuation, no extra words."
)

PERSONAL_ACTIONS = ("options", "profile", "memory/add", "memory/delete", "example/add", "example/delete",
                    "preview", "assistant/create", "assistant/delete")

_capabilities = {}  # model name -> list like ["completion", "tools", "thinking"]


def ollama(path, payload=None, timeout=10, method=None):
    """Call Ollama's API. Returns the open response (for streaming) or raises."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"{OLLAMA_URL}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    return urllib.request.urlopen(req, timeout=timeout)


def ollama_json(path, payload=None, timeout=10, method=None):
    with ollama(path, payload, timeout, method) as resp:
        return json.load(resp)


def installed_models():
    """Map of installed model name -> size in bytes."""
    data = ollama_json("/api/tags", timeout=5)
    return {m["name"]: m.get("size", 0) for m in data.get("models", [])}


def capabilities(name):
    if name not in _capabilities:
        try:
            _capabilities[name] = ollama_json("/api/show", {"model": name}).get("capabilities", [])
        except (urllib.error.URLError, OSError, ValueError):
            return []
    return _capabilities[name]


def model_entry(name, installed, hw):
    """The model's entry (with its rating and memory needs), catalog or not."""
    catalog, others = models.build_list(installed, hw)
    for m in catalog + others:
        if m["name"] == name or name == m["name"] + ":latest":
            return m
    need = models.need_for_size(installed.get(name, 0) / 1e9)
    return {"need_gb": need, "fit": models.rate(need, hw)}


class ChatHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, format, *args):
        # Keep the terminal quiet except for errors.
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(data, dict):
            raise ValueError
        return data

    def same_origin(self):
        """Only accept actions from this app's own page, not from other websites."""
        origin = self.headers.get("Origin")
        allowed = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        if phone.address():
            allowed.add(f"{phone.address()}:{PORT}")
        return origin is None or urlparse(origin).netloc in allowed

    def is_local(self):
        """True when the request comes from this computer, not a phone on the Wi-Fi."""
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def remote_allowed(self, method):
        """
        What a phone on the Wi-Fi may do. Pages and styles always load (so it can show
        the code screen); everything else needs the code first, and phones can only
        chat and see models. Returns True, or sends the refusal and returns False.
        """
        if self.is_local():
            return True
        path = self.path.split("?")[0]
        if not path.startswith(("/api/", "/organizer", "/files", "/connectors")):
            return True
        if path in ("/api/status", "/api/pair", "/connectors/tool-chat.js", "/connectors/tool-chat.css"):
            return True
        if not phone.is_paired(self.headers.get("Cookie")):
            self.send_json(401, {"error": "Enter the code shown on your computer first.", "pair": True})
            return False
        if (method, path) in (("GET", "/api/models"), ("GET", "/api/system"), ("POST", "/api/chat"), ("POST", "/api/title")):
            return True
        self.send_json(403, {"error": "This can only be done on the computer running the app."})
        return False

    def start_stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

    def emit(self, event):
        """Send one line of the stream to the page."""
        self.wfile.write((json.dumps(event) + "\n").encode("utf-8"))
        self.wfile.flush()

    def do_GET(self):
        if not self.remote_allowed("GET"):
            return
        if organizer_routes and organizer_routes.handle(self):
            return
        if connectors_routes and connectors_routes.handle(self):
            return
        routes = {"/api/status": self.status, "/api/system": self.system, "/api/models": self.list_models,
                  "/api/phone": self.phone_status, "/api/personal": self.personal_status,
                  "/api/personal/export": self.personal_export}
        routes["/api/running"] = self.running
        if self.path in routes:
            return routes[self.path]()
        if self.path in ("/personal", "/personal/"):
            self.path = "/personal.html"
        return super().do_GET()

    def do_POST(self):
        if not self.remote_allowed("POST"):
            return
        if organizer_routes and organizer_routes.handle(self):
            return
        if connectors_routes and connectors_routes.handle(self):
            return
        routes = {"/api/chat": self.chat, "/api/title": self.title, "/api/pull": self.pull, "/api/delete": self.delete,
                  "/api/phone": self.phone_toggle, "/api/pair": self.pair}
        routes.update({f"/api/personal/{action}": self.personal_action for action in PERSONAL_ACTIONS})
        routes["/api/unload"] = self.unload
        if self.path not in routes:
            return self.send_json(404, {"error": "Not found"})
        if not self.same_origin():
            return self.send_json(403, {"error": "Requests from other websites are not allowed."})
        try:
            request = self.read_json()
        except ValueError:
            return self.send_json(400, {"error": "Bad request"})
        routes[self.path](request)

    # ---------- Information for the page ----------

    def status(self):
        info = {
            "organizer": bool(organizer_routes) and self.is_local(),
            "remote": not self.is_local(),
            "paired": self.is_local() or phone.is_paired(self.headers.get("Cookie")),
        }
        try:
            info["version"] = ollama_json("/api/version", timeout=3).get("version")
            info["ollama"] = True
        except (urllib.error.URLError, OSError, ValueError):
            info["ollama"] = False
        self.send_json(200, info)

    # ---------- Using the app from a phone on the same Wi-Fi ----------

    def phone_status(self):
        self.send_json(200, phone.status(PORT))

    def phone_toggle(self, request):
        if request.get("enabled"):
            self.send_json(200, phone.start(ChatHandler, PORT))
        else:
            self.send_json(200, phone.stop(PORT))

    def pair(self, request):
        token = phone.pair(request.get("code", ""))
        if not token:
            return self.send_json(403, {"error": "That code didn't match. Check the code on your computer and try again."})
        body = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", f"phone={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000")
        self.end_headers()
        self.wfile.write(body)

    def system(self):
        self.send_json(200, hardware.detect())

    def list_models(self):
        """Installed models plus the catalog, each rated for this computer."""
        try:
            installed = installed_models()
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})
        hw = hardware.detect()
        catalog, others = models.build_list(installed, hw)
        for m in catalog + others:
            if m["installed"]:
                name = next(n for n in installed if n in (m["name"], m["name"] + ":latest"))
                m["capabilities"] = capabilities(name)
                m["installed_name"] = name
        me = personal.load()
        for m in others:
            a = personal.find_assistant(m["name"], me)
            if a:
                m["label"] = a["name"]
                m["about"] = f"Your own assistant, built on {a['base']}. Change it in Personalize."
                m["custom"] = True
        runnable = [m["installed_name"] for m in catalog + others if m["installed"] and m["fit"]["speed"] != "blocked"]
        self.send_json(200, {
            "models": runnable,  # names the chat can use (the organizer page reads this too)
            "catalog": catalog,
            "others": others,
            "experimental": [tinygpt_entry(hw)],  # our own models; they run in this app, not in Ollama
            "recommended": models.recommend(hw),
            "recommended_coder": models.recommend(hw, coding=True),
            "system": hw,
        })

    # ---------- Downloading and removing models ----------

    def pull(self, request):
        """Download a model from the catalog, streaming progress to the page."""
        name = request.get("model", "")
        if name == tinygpt.ENTRY["name"]:
            return self.pull_tinygpt()
        entry = next((m for m in models.CATALOG if m["name"] == name), None)
        if not entry:
            return self.send_json(400, {"error": "That model isn't in the app's list."})
        hw = hardware.detect()
        catalog, _ = models.build_list({}, hw)
        fit = next(m["fit"] for m in catalog if m["name"] == name)
        if fit["speed"] == "blocked":
            return self.send_json(409, {"error": fit["reason"]})
        try:
            resp = ollama("/api/pull", {"model": name, "stream": True}, timeout=3600)
        except (urllib.error.URLError, OSError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})

        self.start_stream()
        try:
            with resp:
                for line in resp:
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        self.emit({"type": "error", "message": chunk["error"]})
                        return
                    self.emit({
                        "type": "progress",
                        "status": chunk.get("status", ""),
                        "completed": chunk.get("completed", 0),
                        "total": chunk.get("total", 0),
                    })
            self.emit({"type": "done"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (urllib.error.URLError, OSError, ValueError) as e:
            self.emit({"type": "error", "message": f"Download stopped: {e}"})

    def pull_tinygpt(self):
        self.start_stream()
        try:
            tinygpt.download(lambda done, total: self.emit(
                {"type": "progress", "status": "pulling tinygpt", "completed": done, "total": total}))
            self.emit({"type": "done"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (urllib.error.URLError, OSError, ValueError) as e:
            self.emit({"type": "error", "message": f"Download stopped: {e}"})

    def delete(self, request):
        name = request.get("model", "")
        if name == tinygpt.ENTRY["name"]:
            tinygpt.remove()
            return self.send_json(200, {"ok": True})
        try:
            ollama("/api/delete", {"model": name}, method="DELETE").close()
            _capabilities.pop(name, None)
            self.send_json(200, {"ok": True})
        except urllib.error.HTTPError:
            self.send_json(404, {"error": "That model isn't installed."})
        except (urllib.error.URLError, OSError):
            self.send_json(503, {"error": "Ollama is not running."})

    # ---------- Which models are in memory right now ----------

    def running(self):
        """The models Ollama has loaded, how much memory each uses, and how much of that is on the graphics card."""
        try:
            loaded = ollama_json("/api/ps", timeout=3).get("models", [])
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running."})
        out = []
        for m in loaded:
            size = m.get("size") or 0
            vram = min(m.get("size_vram") or 0, size)
            out.append({"name": m.get("name") or m.get("model", ""), "gb": round(size / 1e9, 1),
                        "gpu_percent": round(100 * vram / size) if size else 0, "until": m.get("expires_at")})
        self.send_json(200, {"models": out})

    def unload(self, request):
        """Free a model's memory now instead of waiting for Ollama to unload it after a few idle minutes."""
        name = request.get("model")
        if not isinstance(name, str) or not name:
            return self.send_json(400, {"error": "Bad request"})
        try:
            ollama_json("/api/generate", {"model": name, "keep_alive": 0}, timeout=30)
        except urllib.error.HTTPError:
            return self.send_json(404, {"error": "That model isn't loaded."})
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running."})
        self.send_json(200, {"ok": True})

    # ---------- Personalize: profile, memory, examples and custom assistants ----------

    def personal_status(self):
        data = personal.load()
        try:
            installed = installed_models()
        except (urllib.error.URLError, OSError, ValueError):
            installed = None
        if installed is not None:
            hw = hardware.detect()
            catalog, others = models.build_list(installed, hw)
            # Models an assistant can be built on: installed, fits this computer, and not an assistant itself.
            data["bases"] = [
                {"name": next(n for n in installed if n in (m["name"], m["name"] + ":latest")), "label": m["label"]}
                for m in catalog + others
                if m["installed"] and m["fit"]["speed"] != "blocked" and not personal.find_assistant(m["name"], data)
            ]
            for a in data["assistants"]:
                a["installed"] = a["name"] in installed or a["name"] + ":latest" in installed
        data["ollama"] = installed is not None
        self.send_json(200, data)

    def personal_export(self):
        body = personal.export_jsonl().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="my-training-examples.jsonl"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def personal_action(self, request):
        action = self.path[len("/api/personal/"):]
        try:
            if action == "options":
                data = personal.set_options(request.get("enabled"), request.get("remember_commands"))
            elif action == "profile":
                data = personal.set_profile(request.get("profile"))
            elif action == "memory/add":
                data = personal.add_memory(request.get("text"))
            elif action == "memory/delete":
                data = personal.delete_memory(request.get("id"))
            elif action == "example/add":
                data = personal.add_example(request.get("prompt"), request.get("answer"))
            elif action == "example/delete":
                data = personal.delete_example(request.get("id"))
            elif action == "preview":
                system, examples = personal.context_for([{"role": "user", "content": str(request.get("question", ""))}],
                                                        request.get("model"))
                return self.send_json(200, {"system": system, "examples": examples})
            elif action == "assistant/create":
                return self.create_assistant(request)
            elif action == "assistant/delete":
                name = str(request.get("name", ""))
                if personal.find_assistant(name):
                    try:
                        ollama("/api/delete", {"model": name}, method="DELETE").close()
                        _capabilities.pop(name, None)
                        _capabilities.pop(name + ":latest", None)
                    except urllib.error.HTTPError:
                        pass  # already removed from Ollama
                    except (urllib.error.URLError, OSError):
                        return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})
                data = personal.delete_assistant(name)
        except personal.PersonalError as e:
            return self.send_json(400, {"error": str(e)})
        self.send_json(200, {"ok": True, "data": data})

    def create_assistant(self, request):
        """Save a new model in Ollama: an installed model plus the user's instructions and creativity."""
        try:
            installed = installed_models()
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})
        base = request.get("base", "")
        if base not in installed:
            return self.send_json(400, {"error": "Pick a model you've downloaded to build on."})
        hw = hardware.detect()
        if model_entry(base, installed, hw)["fit"]["speed"] == "blocked":
            return self.send_json(409, {"error": f"{base} is too big for this computer."})
        taken = set(installed) | {m["name"] for m in models.CATALOG}
        try:
            record, payload = personal.assistant_request(
                request.get("name"), base, request.get("instructions"), request.get("temperature", 0.7), taken)
        except personal.PersonalError as e:
            return self.send_json(400, {"error": str(e)})
        try:
            ollama_json("/api/create", payload, timeout=300)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self.send_json(502, {"error": f"Ollama couldn't create it: {detail}"})
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})
        try:
            data = personal.save_assistant(record)
        except personal.PersonalError as e:
            return self.send_json(400, {"error": str(e)})
        self.send_json(200, {"ok": True, "data": data})

    # ---------- Chatting ----------

    def chat(self, request):
        """Forward the conversation to Ollama and stream the reply back, one JSON event per line."""
        model = request.get("model")
        messages = request.get("messages")
        if not model or not isinstance(messages, list):
            return self.send_json(400, {"error": "Bad request"})
        if model == tinygpt.ENTRY["name"]:
            return self.chat_tinygpt(request, messages)

        try:
            installed = installed_models()
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})
        if model not in installed:
            return self.send_json(404, {"error": f"The model {model} isn't installed. Pick another in Models."})
        hw = hardware.detect()
        entry = model_entry(model, installed, hw)
        if entry["fit"]["speed"] == "blocked":
            return self.send_json(409, {"error": f"{model} is too big for this computer. {entry['fit']['reason']}"})

        # Bigger coding projects go to a coding model, if one is installed and the user allows it.
        switch_reason = None
        coder = models.best_installed_coder(installed, hw)
        if request.get("auto_code", True):
            model, switch_reason = router.choose(messages, model, coder)
            entry = model_entry(model, installed, hw)
        suggest_coder = (
            not coder and request.get("auto_code", True)
            and not entry.get("coding") and router.is_big_coding_request(messages[-1].get("content", ""))
        )

        # The user's adjustable settings for this model, checked so they can't overload the computer.
        by_model = request.get("settings_by_model")
        raw = by_model.get(model) if isinstance(by_model, dict) else request.get("settings")
        me = personal.load()
        assistant = personal.find_assistant(model, me)
        if raw is None and assistant:
            raw = {"temperature": assistant["temperature"]}  # the creativity chosen when it was made
        options, instructions = models.clean_settings(raw, entry["need_gb"], hw)
        system = SYSTEM_PROMPT

        # "Remember that ..." saves a fact to the user's memory (only from this computer).
        remembered = None
        last = messages[-1] if messages and isinstance(messages[-1], dict) else {}
        fact = personal.remember_request(last.get("content", "")) if last.get("role") == "user" else None
        if fact and me["enabled"] and me["remember_commands"] and self.is_local():
            try:
                me = personal.add_memory(fact)
                remembered = fact
            except personal.PersonalError:
                pass

        # What the user taught it: their profile, memory, saved examples and the assistant's own instructions.
        about_me, examples = personal.context_for(messages, model, me)
        if about_me:
            system += "\n\n" + about_me
        if instructions:
            system += "\n\nThe user gave these extra instructions. Follow them:\n" + instructions

        # If the user shared folders, add the passages that match their question.
        sources = []
        if shared_files:
            extra, sources = shared_files.context_for(messages)
            if extra:
                system += "\n\n" + extra
                if options["num_ctx"] < 8192:  # room for the file passages, if this computer has it
                    roomy = [o["value"] for o in models.context_options(entry["need_gb"], hw) if o["ok"]]
                    options["num_ctx"] = max([c for c in roomy if c <= 8192] or [options["num_ctx"]])

        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m["role"], "content": m["content"]} for m in messages],
            "options": options,
            "stream": True,
        }
        if "thinking" in capabilities(model):
            payload["think"] = bool(request.get("think"))
        # Let the model use connectors' tools; notices say if this model can't.
        # (Only on this computer: connectors can reach the user's accounts and files, so phones don't get them.)
        notices = connectors_routes.add_tools(payload, messages, capabilities(model)) if connectors_routes and self.is_local() else []
        payload["messages"][1:1] = examples  # the user's saved examples go right after the instructions
        tool_calls = []

        try:
            resp = ollama("/api/chat", payload, timeout=600)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self.send_json(502, {"error": f"Ollama error: {detail}"})
        except (urllib.error.URLError, OSError):
            return self.send_json(503, {"error": "Ollama is not running. Start the Ollama app and try again."})

        # Ollama sends one JSON object per line; pass each piece straight to the page.
        self.start_stream()
        self.emit({"type": "model", "name": model, "switched": bool(switch_reason), "reason": switch_reason})
        if suggest_coder:
            pick = next((m for m in models.CATALOG if m["name"] == models.recommend(hw, coding=True)), None)
            if pick:
                self.emit({"type": "notice", "action": "coding-models", "text":
                           f"Tip: this looks like a coding project. Download {pick['label']} ({pick['size_gb']:g} GB) "
                           "and the app will switch to it automatically for projects like this."})
        try:
            with resp:
                for line in resp:
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        self.emit({"type": "error", "message": chunk["error"]})
                        break
                    message = chunk.get("message", {})
                    if message.get("thinking"):
                        self.emit({"type": "thinking", "text": message["thinking"]})
                    if message.get("content"):
                        self.emit({"type": "text", "text": message["content"]})
                    tool_calls += message.get("tool_calls") or []
                    if chunk.get("done"):
                        if remembered:
                            self.emit({"type": "notice", "action": "personal", "text":
                                       f"Saved to your memory: \"{remembered}\". See or delete it in Personalize."})
                        for event in notices:
                            self.emit(event)
                        if tool_calls:
                            # The page asks the user, runs the tools, then sends the chat back here.
                            self.emit(connectors_routes.tool_calls_event(tool_calls))
                        if sources:
                            self.emit({"type": "text", "text": "\n\n*Looked in: " + ", ".join(sources) + "*"})
                        if chunk.get("done_reason") == "length":
                            self.emit({"type": "notice", "text": "The answer stopped at your length limit. You can change it in this model's settings."})
                        break
        except (BrokenPipeError, ConnectionResetError):
            # The user pressed Stop or closed the tab.
            pass

    def chat_tinygpt(self, request, messages):
        """TinyGPT runs right here. It continues the user's latest message, one character at a time."""
        if not tinygpt.installed():
            return self.send_json(404, {"error": "TinyGPT isn't downloaded. Pick another in Models."})
        last = messages[-1] if messages and isinstance(messages[-1], dict) else {}
        prompt = str(last.get("content", "")).replace("\r", "") if last.get("role") == "user" else ""
        by_model = request.get("settings_by_model")
        raw = by_model.get(tinygpt.ENTRY["name"]) if isinstance(by_model, dict) else request.get("settings")
        options, _ = models.clean_settings(raw, tinygpt.ENTRY["need_gb"], hardware.detect())
        # "Longest answer" is in tokens for other models; TinyGPT writes characters.
        length = 600 if options["num_predict"] < 0 else min(options["num_predict"], 2000)
        try:
            model = tinygpt.load()
        except (OSError, ValueError) as e:
            return self.send_json(500, {"error": f"TinyGPT couldn't load: {e}"})

        self.start_stream()
        self.emit({"type": "model", "name": tinygpt.ENTRY["name"], "switched": False, "reason": None})
        try:
            notes = []
            if len(messages) == 1:  # explain once, at the start of a chat
                notes.append("Experimental: TinyGPT was built from scratch in this project and only learned from "
                             "Shakespeare. It continues your text; it doesn't understand questions.")
            if any(c not in model.stoi for c in prompt):
                notes.append("It skipped characters it never saw in Shakespeare, like digits or emoji.")
            text, sent = "", 0
            for ch in model.generate(prompt, length + 300, options["temperature"]):
                text += ch
                # Past the length, stop at the next blank line so it ends on a whole speech.
                done = len(text) >= length and text.endswith("\n\n")
                if done or len(text) - sent >= 8 or ch == "\n":  # send a few characters at a time
                    self.emit({"type": "text", "text": text[sent:]})
                    sent = len(text)
                if done:
                    break
            if sent < len(text):
                self.emit({"type": "text", "text": text[sent:]})
            if notes:
                self.emit({"type": "notice", "text": " ".join(notes)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def title(self, request):
        """Ask the model for a short name for a new chat, based on its first question and answer."""
        model = request.get("model")
        question = str(request.get("question") or "")[:1500]
        answer = str(request.get("answer") or "")[:600]
        if not model or not question.strip():
            return self.send_json(400, {"error": "Bad request"})
        if model == tinygpt.ENTRY["name"]:
            return self.send_json(200, {"title": ""})  # it can't summarize; the page keeps its quick name
        try:
            if model not in installed_models():
                return self.send_json(404, {"error": "That model isn't installed."})
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": TITLE_PROMPT},
                    {"role": "user", "content": f"User's message:\n{question}\n\nStart of the answer:\n{answer}\n\nTitle:"},
                ],
                "options": {"temperature": 0.3, "num_predict": 24},
                "stream": False,
            }
            if "thinking" in capabilities(model):
                payload["think"] = False  # a title doesn't need the model to think it over first
            text = ollama_json("/api/chat", payload, timeout=30).get("message", {}).get("content", "")
        except (urllib.error.URLError, OSError, ValueError):
            return self.send_json(503, {"error": "Couldn't reach Ollama."})
        self.send_json(200, {"title": clean_title(text)})


def tinygpt_entry(hw):
    """TinyGPT's card for the Models list, shaped like the catalog entries."""
    have = tinygpt.installed()
    return dict(tinygpt.ENTRY, installed=have, installed_name=tinygpt.ENTRY["name"] if have else None,
                capabilities=[], fit={"speed": "good", "reason": "Runs on your processor inside this app, not in Ollama."},
                context=models.context_options(tinygpt.ENTRY["need_gb"], hw), tier="phone")


def clean_title(text):
    """Tidy what the model wrote into a plain title, or "" if nothing usable came back."""
    text = re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S)
    line = next((l for l in text.splitlines() if l.strip()), "")
    line = re.sub(r"^\s*(title\s*:)?\s*", "", line, flags=re.I)
    line = line.strip().strip("*#_`\"'“”‘’ ").rstrip(".!?:;,")
    words = line.split()
    return " ".join(words[:8])[:60] if words else ""


def main():
    hardware.detect()  # check the computer once at startup so the page loads quickly
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ChatHandler)
    url = f"http://localhost:{PORT}"
    print(f"Local AI Chat is running at {url}")
    phone.restore(ChatHandler, PORT)
    if phone.address():
        print(f"Phones on your Wi-Fi can use it at http://{phone.address()}:{PORT} (code {phone.status(PORT)['code']})")
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
