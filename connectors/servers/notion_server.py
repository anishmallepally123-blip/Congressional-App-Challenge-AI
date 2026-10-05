"""
Notion connector: search, read and add to the Notion pages you share with it.

    python notion_server.py          (with NOTION_TOKEN set)

Setup (about 2 minutes):
  1. Go to https://www.notion.so/profile/integrations and press "New integration".
     Give it a name (e.g. Local AI Chat), pick your workspace, and choose "Internal".
  2. Copy its "Internal Integration Secret" (starts with ntn_ or secret_) and paste it
     as NOTION_TOKEN on the Connectors page.
  3. In Notion, open each page the AI may use, press ••• > Connections, and add the
     integration. It can only see pages you share this way.
"""

import os

from mcp_server import Server, ToolError, http_json, need_env, setup_error

API = os.environ.get("NOTION_API", "https://api.notion.com/v1")
HOW = ("Make one at notion.so/profile/integrations (New integration > Internal), copy its secret, "
       "and paste it on the Connectors page as NOTION_TOKEN=... Then share your pages with it in Notion (••• > Connections).")
TOKEN = need_env("NOTION_TOKEN", HOW) if __name__ == "__main__" else os.environ.get("NOTION_TOKEN", "")
MAX_CHARS = 12000
server = Server("notion")


def notion(path, method="GET", body=None):
    return http_json(f"{API}{path}", method=method, body=body, service="Notion",
                     headers={"Authorization": f"Bearer {TOKEN}", "Notion-Version": "2022-06-28"})


def plain(rich):
    return "".join(r.get("plain_text", "") for r in rich or [])


def title_of(obj):
    if obj.get("object") == "database":
        return plain(obj.get("title")) or "Untitled database"
    for prop in (obj.get("properties") or {}).values():
        if prop.get("type") == "title":
            return plain(prop.get("title")) or "Untitled"
    return "Untitled"


def page_id(text):
    """Accept a page id or a Notion link and return the id."""
    text = text.strip().split("?")[0].rstrip("/")
    tail = text.rsplit("/", 1)[-1].rsplit("-", 1)[-1].replace("-", "")
    if len(tail) != 32:
        raise ToolError("Give a Notion page id or link. Use search_notion to find pages.")
    return tail


@server.tool("Search Notion", read_only=True,
             description="Find Notion pages and databases shared with this connector, by title words.",
             params={"query": ("string", "Words in the page title (leave empty to list recent pages)")})
def search_notion(query=""):
    data = notion("/search", "POST", {"query": query, "page_size": 15,
                                      "sort": {"direction": "descending", "timestamp": "last_edited_time"}})
    rows = [f"- {title_of(r)} ({r['object']}, edited {r.get('last_edited_time', '')[:10]}) id: {r['id']}"
            for r in data.get("results", [])]
    if not rows:
        return ("Nothing found. Pages only show up after you share them with the integration "
                "in Notion (open the page, ••• > Connections).")
    return "\n".join(rows)


def block_text(block):
    kind = block.get("type")
    body = block.get(kind) or {}
    text = plain(body.get("rich_text"))
    prefix = {"heading_1": "# ", "heading_2": "## ", "heading_3": "### ", "bulleted_list_item": "- ",
              "numbered_list_item": "1. ", "quote": "> "}.get(kind, "")
    if kind == "to_do":
        prefix = "[x] " if body.get("checked") else "[ ] "
    if kind == "child_page":
        return f"[sub-page: {body.get('title')}] id: {block['id']}"
    if kind == "code":
        return f"```\n{text}\n```"
    return prefix + text if text or prefix else ""


@server.tool("Read a Notion page", read_only=True,
             description="Read the text of a Notion page by its id or link.",
             params={"page": ("string", "The page id or link (from search_notion)")}, required=["page"])
def read_page(page):
    pid = page_id(page)
    info = notion(f"/pages/{pid}")
    lines, cursor = [f"# {title_of(info)}", info.get("url", ""), ""], None
    while True:
        data = notion(f"/blocks/{pid}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else ""))
        lines += [t for t in (block_text(b) for b in data.get("results", [])) if t]
        cursor = data.get("next_cursor")
        if not data.get("has_more") or sum(map(len, lines)) > MAX_CHARS:
            break
    text = "\n".join(lines)
    return text[:MAX_CHARS] + ("\n[... cut]" if len(text) > MAX_CHARS else "")


@server.tool("Add to a Notion page",
             description="Add paragraphs of text to the end of a Notion page. Each line becomes a paragraph; "
                         "lines starting with '- ' become bullet points.",
             params={"page": ("string", "The page id or link"), "text": ("string", "The text to add")},
             required=["page", "text"])
def append_to_page(page, text):
    children = []
    for line in text.splitlines():
        if not line.strip():
            continue
        kind = "bulleted_list_item" if line.lstrip().startswith(("- ", "* ")) else "paragraph"
        content = line.lstrip()[2:] if kind == "bulleted_list_item" else line
        children.append({"object": "block", "type": kind,
                         kind: {"rich_text": [{"type": "text", "text": {"content": content[:2000]}}]}})
    if not children:
        raise ToolError("There's no text to add.")
    notion(f"/blocks/{page_id(page)}/children", "PATCH", {"children": children[:100]})
    return f"Added {len(children)} block{'s' if len(children) != 1 else ''} to the page."


@server.tool("Create a Notion page",
             description="Create a new Notion page inside an existing page the connector can see.",
             params={"parent_page": ("string", "Id or link of the page to put it in"),
                     "title": ("string", "The new page's title"),
                     "text": ("string", "Optional text for the page")},
             required=["parent_page", "title"])
def create_page(parent_page, title, text=""):
    created = notion("/pages", "POST", {
        "parent": {"page_id": page_id(parent_page)},
        "properties": {"title": {"title": [{"type": "text", "text": {"content": title[:200]}}]}},
    })
    if text.strip():
        append_to_page(created["id"], text)
    return f"Created the page \"{title}\": {created.get('url', created['id'])}"


if __name__ == "__main__":
    try:
        notion("/users/me")
    except ToolError as e:
        setup_error(str(e))
    server.run()
