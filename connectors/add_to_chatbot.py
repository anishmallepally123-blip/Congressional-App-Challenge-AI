"""
Plug Connectors into the chatbot in ../chatbot.

    python add_to_chatbot.py           make the changes
    python add_to_chatbot.py --check   only say whether they would work

It makes small, marked edits to chatbot/server.py, static/app.js and static/index.html.
Each edit is found by the code it goes next to, so it keeps working while the chatbot
changes. Running it twice does nothing the second time. connectors-plugin.patch shows
the same edits as a diff.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHATBOT = os.path.join(HERE, "..", "chatbot")
MARK = "connectors_routes"  # appears in every edited file once it's done

SERVER = [
    ("before", '\nOLLAMA_URL = os.environ.get(', '''
# Connectors (third-party tools using the Model Context Protocol) live next to this folder too.
sys.path.insert(0, os.path.join(HERE, "..", "connectors"))
try:
    import connectors_routes
except ImportError:
    connectors_routes = None
'''),
    ("after-all", '''        if organizer_routes and organizer_routes.handle(self):
            return
''', '''        if connectors_routes and connectors_routes.handle(self):
            return
'''),
    ("after", '''            payload["think"] = bool(request.get("think"))
''', '''        # Let the model use connectors' tools; notices say if this model can't.
        notices = connectors_routes.add_tools(payload, messages, capabilities(model)) if connectors_routes else []
        tool_calls = []
'''),
    ("after", '''                        self.emit({"type": "text", "text": message["content"]})
''', '''                    tool_calls += message.get("tool_calls") or []
'''),
    ("after", '''                    if chunk.get("done"):
''', '''                        for event in notices:
                            self.emit(event)
                        if tool_calls:
                            # The page asks the user, runs the tools, then sends the chat back here.
                            self.emit(connectors_routes.tool_calls_event(tool_calls))
'''),
]

APP = [
    ("replace", '''  chat.messages.forEach((m, i) => messagesEl.append(messageEl(m, i, chat)));''',
     '''  chat.messages.forEach((m, i) => {
    if (m.role === "tool") return; // a tool's answer; shown on its card instead (connectors_routes)
    messagesEl.append(m.tool_calls ? ToolChat.savedTurn(m, renderMarkdown) : messageEl(m, i, chat));
  });'''),
    ("replace", '''  controller = new AbortController();

  const nearBottom''', '''  let toolCalls = null; // tools the model asked for (connectors_routes)
  controller = new AbortController();

  const nearBottom'''),
    ("before", '''        } else if (ev.type === "error") {
          failure = { message: ev.message };''', '''        } else if (ev.type === "tool_calls") {
          toolCalls = ev.calls;
'''),
    ("before", '''  } catch (err) {
    if (err.name !== "AbortError") failure = { message: "Lost connection''', '''    // The model wants to use connectors: ask the user, run the tools, then let it continue.
    if (toolCalls && !failure) {
      body.innerHTML = renderMarkdown(reply);
      const signal = controller.signal;
      const ran = await ToolChat.runCalls({ calls: toolCalls, chat, model, text: reply, wrap, body, signal, save: saveChats });
      if (ran) {
        controller = null;
        renderMain();
        return streamReply(chat);
      }
    }
'''),
]

INDEX = [
    ("after", '''🗂️ Organize a folder</a>
''', '''    <a href="/connectors" class="sidebar-link">🔌 Connectors</a> <!-- connectors_routes -->
'''),
    ("after", '''  <link rel="stylesheet" href="style.css">
''', '''  <link rel="stylesheet" href="/connectors/tool-chat.css">
'''),
    ("before", '''  <script src="app.js"></script>''', '''  <script src="/connectors/tool-chat.js"></script>
'''),
]

FILES = {"server.py": SERVER, os.path.join("static", "app.js"): APP, os.path.join("static", "index.html"): INDEX}


def edit(text, edits, name):
    for kind, anchor, new in edits:
        count = text.count(anchor)
        if count == 0 or (count > 1 and kind != "after-all"):
            where = "isn't" if count == 0 else "is in more than one place"
            raise SystemExit(f"Can't add Connectors to {name}: this code {where} there:\n{anchor.strip()}\n"
                             "The chatbot has changed; add this edit by hand (see README.md).")
        if kind == "before":
            text = text.replace(anchor, new + anchor)
        elif kind in ("after", "after-all"):
            text = text.replace(anchor, anchor + new)
        else:
            text = text.replace(anchor, new)
    return text


def main():
    check = "--check" in sys.argv
    changes = {}
    for name, edits in FILES.items():
        path = os.path.join(CHATBOT, name)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if MARK in text:
            print(f"{name}: already has Connectors")
            continue
        changes[path] = edit(text, edits, name)
        print(f"{name}: {'can be updated' if check else 'updated'}")
    if not check:
        for path, text in changes.items():
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        if changes:
            print("Done. Restart the chatbot and open Connectors in the sidebar.")


if __name__ == "__main__":
    main()
