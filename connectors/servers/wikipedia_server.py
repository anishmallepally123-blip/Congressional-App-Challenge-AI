"""
Wikipedia connector: search Wikipedia and read articles. No account or key needed.

    python wikipedia_server.py [language code, default en]
"""

import os
import re
import sys
import urllib.parse

from mcp_server import Server, ToolError, http_json

LANG = (sys.argv[1] if len(sys.argv) > 1 else "en").strip() or "en"
API = os.environ.get("WIKIPEDIA_API", f"https://{LANG}.wikipedia.org/w/api.php")
MAX_CHARS = 12000
server = Server("wikipedia")


def api(**params):
    params.update({"format": "json", "formatversion": "2"})
    return http_json(f"{API}?{urllib.parse.urlencode(params)}", service="Wikipedia")


@server.tool("Search Wikipedia", read_only=True,
             description="Search Wikipedia and list matching article titles with a short snippet.",
             params={"query": ("string", "What to search for")}, required=["query"])
def search_wikipedia(query):
    data = api(action="query", list="search", srsearch=query, srlimit=8)
    hits = data.get("query", {}).get("search", [])
    if not hits:
        return f"No Wikipedia articles found for: {query}"
    return "\n".join(f"- {h['title']}: {re.sub(r'<[^>]+>', '', h.get('snippet', ''))}" for h in hits)


@server.tool("Read a Wikipedia article", read_only=True,
             description="Get the text of a Wikipedia article by its title. Use the intro only for a quick summary.",
             params={"title": ("string", "The article's title, e.g. 'Photosynthesis'"),
                     "intro_only": ("boolean", "True for just the opening summary (default false)")},
             required=["title"])
def read_article(title, intro_only=False):
    params = {"action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1, "titles": title}
    if intro_only:
        params["exintro"] = 1
    pages = api(**params).get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        raise ToolError(f"There's no Wikipedia article called {title}. Try search_wikipedia first.")
    page = pages[0]
    text = page.get("extract") or "(this article has no text)"
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + f"\n[... cut to the first {MAX_CHARS} characters]"
    link = f"https://{LANG}.wikipedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}"
    return f"{page['title']}\n{link}\n\n{text}"


if __name__ == "__main__":
    server.run()
