# Connectors

Connectors let the chatbot's AI use other apps and tools: your notes, files on your computer, web pages, GitHub and thousands more. They use the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), the open standard that Claude, ChatGPT, Cursor and VS Code use for third-party tools, so a connector built for any of those works here too.

Like the rest of the app, this uses only Python's standard library. There is nothing to pip install.

![A tool card in the chat](screenshot-chat.png)

## What it does

- **Connectors page** (sidebar → 🔌 Connectors): add, turn on/off, edit and remove connectors, and see each one's tools.
- **Ready-made connectors**, grouped on the page (see the table below). All but GitHub are included in `servers/` and written in plain Python, so they work on any computer that runs the app. Ones that need a folder or a key show a box for it, with the setup steps.
- **Paste a setup**: paste the `{"mcpServers": {...}}` block from any connector's instructions for Claude Desktop, Cursor or VS Code.
- **Both kinds of connector**: a program on this computer (like `npx ...` or `uvx ...`), or a web address (remote, with an optional access token).
- **You stay in control**: when the AI wants to use a tool, a card shows what it wants to do, with **Allow once**, **Always allow** and **Deny**. Each tool can be set to *Ask every time*, *Always allow* or *Don't use* on the Connectors page.
- **Folder Organizer** shows up as a built-in connector, so you can say "tidy my Downloads folder" in the chat.
- Chats remember tool cards, so they're still there when you reopen a chat.

![The Connectors page](screenshot-settings.png)

## The ready-made connectors

| Connector | What the AI can do | What you need |
|---|---|---|
| Notes | Save and read notes, check the date and time | Nothing |
| Files | List, read (text and Word .docx), search and save files in one folder | Nothing |
| Web pages | Read a public web page | Internet |
| Wikipedia | Search and read articles | Internet |
| Weather | Current weather and a 7-day forecast ([Open-Meteo](https://open-meteo.com), no account) | Internet |
| Memory | Remember facts about you between chats (saved on this computer) | Nothing |
| Google Drive folder, OneDrive, Dropbox, iCloud Drive | Read and search your cloud files through the copy their desktop app keeps on this computer. The page finds the folder when it can. | That service's desktop app |
| Google Drive | Search and read Docs, Sheets (as CSV), Slides and text files online | A free Google Cloud sign-in client (below) |
| Google Calendar | See upcoming events | A free Google Cloud sign-in client (below) |
| Notion | Search, read, add to and create pages | A Notion integration secret |
| Slack | List and read channels, post messages | A Slack app's bot token |
| GitHub | GitHub's own remote connector: repositories, issues, pull requests | A personal access token |

### Setting up Google Drive and Google Calendar

Google only lets an app read your files after you sign in, and every app needs its own sign-in "client" from Google. Because this app runs on your computer instead of a company's server, you make your own. It's free and takes about 10 minutes, once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project.
2. **APIs & Services > Library**: turn on the **Google Drive API** and/or the **Google Calendar API**.
3. **OAuth consent screen**: give it a name and your email, choose **External**, and add your own Google account as a **test user**.
4. **Credentials > Create credentials > OAuth client ID**, application type **Desktop app**. Copy the client ID and secret.
5. On the Connectors page, pick Google Drive or Google Calendar, paste them, and press **Add and connect**. A browser tab opens: sign in and press **Allow**.

The connector only asks to *read*. The sign-in is saved in `~/.local-ai-chat/google-drive.json` (or `google-calendar.json`). While the Google project is in "Testing", Google ends the sign-in after 7 days; press **Reconnect** to sign in again. A sign-in page only ever opens when you add or reconnect the connector, never in the middle of a chat.

If that's too much, the **Google Drive folder** connector needs no sign-in at all: install [Google Drive for desktop](https://www.google.com/drive/download/) and the AI reads the copy of your Drive on this computer.

### Notion and Slack

- **Notion**: at [notion.so/profile/integrations](https://www.notion.so/profile/integrations) press **New integration**, choose **Internal**, and copy the secret. Then share each page the AI may use: open it, **••• > Connections**, add the integration.
- **Slack**: at [api.slack.com/apps](https://api.slack.com/apps) create an app from scratch. Under **OAuth & Permissions** add the bot scopes `channels:read`, `channels:history`, `groups:read`, `groups:history`, `chat:write` and `users:read`, install it, and copy the **Bot User OAuth Token** (`xoxb-...`). Invite it to channels with `/invite @YourApp`.

### When a connector doesn't work

Its card says **Not working** with the reason in plain words, such as a missing key, a key the service refused, a folder that doesn't exist, or a program (like Node.js for `npx` connectors) that isn't installed. Fix it with **Edit**, or press **Reconnect** after fixing it elsewhere.

Older versions of this app used `npx` (Node.js) and `uvx` (uv) for Files, Memory and Web pages, which most computers don't have. If those are saved and the program is missing, they switch to the built-in versions automatically.

### Build your own

`servers/mcp_server.py` is a tiny framework: describe a tool with `@server.tool(...)`, return text, and call `server.run()`. Any file in `servers/` is a working example.

## Which model?

Connectors need a model that can use tools. In Ollama those are marked "tools", for example:

| Model | Install |
|---|---|
| Qwen 3 8B (recommended) | `ollama pull qwen3:8b` |
| Qwen 3 4B (8 GB computers) | `ollama pull qwen3:4b` |
| Llama 3.1 8B | `ollama pull llama3.1:8b` |

Gemma 3 can't use tools. If you chat with a model that can't, the app says so and answers without tools.

## Plug it into the chatbot

From this folder, run:

```
python add_to_chatbot.py --check     # see whether it fits the current chatbot
python add_to_chatbot.py             # make the changes
```

It makes small edits to `chatbot/server.py`, `chatbot/static/app.js` and `chatbot/static/index.html`, each marked with `connectors_routes` so running it twice does nothing. `connectors-plugin.patch` shows the same edits as a diff. Then restart the chatbot.

If the chatbot has changed so much that the script can't find where an edit goes, it names the spot. The edits by hand are:

**server.py**
1. Next to the organizer import, import `connectors_routes` from `../connectors` (in a `try`, set to `None` if missing).
2. At the top of `do_GET` and `do_POST`: `if connectors_routes and connectors_routes.handle(self): return`
3. In the chat route, after building the Ollama `payload`: `notices = connectors_routes.add_tools(payload, messages, capabilities(model))`. This adds the tools and keeps the tool messages in the history.
4. While streaming, collect `message.get("tool_calls")`. When Ollama says `done`, send each notice, and if there were tool calls, send `connectors_routes.tool_calls_event(tool_calls)`.

**index.html**: load `/connectors/tool-chat.css` and `/connectors/tool-chat.js` (before `app.js`), and add a sidebar link to `/connectors`.

**app.js**
1. In `renderMessages`, skip messages with `role: "tool"` and draw messages that have `tool_calls` with `ToolChat.savedTurn(m, renderMarkdown)`.
2. In `streamReply`, remember a `tool_calls` event's `calls`. After the stream ends, if there were calls, `await ToolChat.runCalls({...})`, and if it returns true, call `streamReply(chat)` again so the model can use the results.

## How it works

```
Chat page ── /api/chat ──> server.py ──> Ollama (with the tools' descriptions)
    │                                       │
    │ <── "tool_calls" event ───────────────┘  the model asks for a tool
    │
    ├─ shows a card, user presses Allow
    ├─ /api/tools/call ──> connectors.py ──> the connector (MCP server) ──> result
    └─ sends the chat again with the result ──> the model writes its answer
```

| File | What it is |
|---|---|
| `mcp_client.py` | A small MCP client: starts local connector programs (stdin/stdout) or talks to remote ones (Streamable HTTP) |
| `connectors.py` | The list of connectors and their settings, the presets, and the hooks the chat server calls |
| `connectors_routes.py` | The web routes for the Connectors page and for running a tool |
| `static/connectors.*` | The Connectors page |
| `static/tool-chat.*` | Tool cards and the allow/deny flow on the chat page |
| `examples/notes_server.py` | A complete example connector in one file, to show how anyone can build one |
| `servers/` | The built-in connectors, and `mcp_server.py`, the small framework they share |
| `add_to_chatbot.py` | Plugs this folder into the chatbot |
| `test_connectors.py`, `test_servers.py` | Tests: `python -m unittest test_connectors test_servers` |

Settings are saved in `~/.local-ai-chat/connectors.json` in the same `mcpServers` format other apps use. Tool results are cut to 6,000 characters so they fit in a small model's memory.

## Safety

- Connectors can run programs, so only the app's own page can add or use them: the server only listens on this computer, and it refuses requests from other websites (it checks the `Host` and `Origin` of every request).
- Nothing runs without your OK unless you chose **Always allow** for that tool.
- Only add connectors from people you trust, just like installing any app.
- Remote connectors that need a full sign-in (OAuth) aren't supported yet; ones that take an access token are. Google Drive and Calendar sign in through their own built-in connector instead.
- Keys and tokens you paste are saved only in `~/.local-ai-chat/connectors.json` on this computer.
- The Files connector can't see outside the folder you choose, and Web pages won't open addresses on this computer or your home network.

## Tested

- The unit tests pass (32 tests). The online connectors (Weather, Wikipedia, Notion, Slack, Google Drive and Calendar) are tested against a stand-in for each service, because real accounts weren't available; they haven't been tried against the real services yet.
- Real third-party connectors worked: the official Files connector (`@modelcontextprotocol/server-filesystem` via npx), the Time connector (`mcp-server-time` via uvx), and the official test server over a web address (Streamable HTTP).
- In a browser with a stand-in for Ollama: adding Notes from the presets, Allow once, Always allow (no card the next time), Deny, Stop while a card is waiting, reopening a chat with tool cards, the notice for a model without tools, dark mode and phone width. A real model (Ollama with qwen3) hasn't been tried yet, because Ollama can't run where this was built.
