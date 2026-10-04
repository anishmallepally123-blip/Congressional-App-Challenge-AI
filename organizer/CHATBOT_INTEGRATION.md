# Plugging Shared Files into the chat

The chatbot's `server.py` already loads `organizer_routes`, so the `/files` page and
`/api/files/...` endpoints work as soon as `organizer/` is next to `chatbot/`.
Two small changes finish the feature. They belong to the chatbot, so they are written
here for whoever is working in `chatbot/` to apply.

## 1. Let chat answers use shared files (`chatbot/server.py`)

When nothing is shared, `context_for()` returns nothing and the chat behaves exactly
as before. When folders are shared, it adds the matching passages to the system
prompt and the reply ends with a line naming the files it looked in.

Tested against `chatbot/server.py` as of 2026-10-04 08:00 UTC:

```diff
--- chatbot/server.py (current)
+++ chatbot/server.py (with shared files)
@@ -29,8 +29,9 @@
 sys.path.insert(0, os.path.join(HERE, "..", "organizer"))
 try:
     import organizer_routes
+    import shared_files
 except ImportError:
-    organizer_routes = None
+    organizer_routes = shared_files = None
 
 OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
 PORT = int(os.environ.get("PORT", "8000"))
@@ -250,12 +251,20 @@
         if fit["speed"] == "blocked":
             return self.send_json(409, {"error": f"{model} is too big for this computer. {fit['reason']}"})
 
+        # If the user shared folders, add the passages that match their question.
+        system, sources = SYSTEM_PROMPT, []
+        if shared_files:
+            extra, sources = shared_files.context_for(messages)
+            if extra:
+                system += "\n\n" + extra
         payload = {
             "model": model,
-            "messages": [{"role": "system", "content": SYSTEM_PROMPT}]
+            "messages": [{"role": "system", "content": system}]
             + [{"role": m["role"], "content": m["content"]} for m in messages],
             "stream": True,
         }
+        if system != SYSTEM_PROMPT:
+            payload["options"] = {"num_ctx": 8192}  # room for the file passages
         if "thinking" in capabilities(model):
             payload["think"] = bool(request.get("think"))
 
@@ -284,6 +293,8 @@
                     if message.get("content"):
                         self.emit({"type": "text", "text": message["content"]})
                     if chunk.get("done"):
+                        if sources:
+                            self.emit({"type": "text", "text": "\n\n*Looked in: " + ", ".join(sources) + "*"})
                         break
         except (BrokenPipeError, ConnectionResetError):
             # The user pressed Stop or closed the tab.
```

## 2. Add a sidebar link (`chatbot/static/index.html`)

Next to the existing organizer link, shown the same way:

```html
<a href="/files" id="files-link" class="sidebar-link" hidden>📁 Shared files</a>
```
