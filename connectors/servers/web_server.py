"""
Web pages connector: fetch a web page and give the AI its text.

    python web_server.py

It only opens public web addresses, not ones on this computer or your home network,
so the AI can't use it to poke at your router or this app.
"""

import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from mcp_server import USER_AGENT, Server, ToolError

MAX_CHARS = 12000
server = Server("web-pages")


class _TextParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer", "form", "iframe"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "pre", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.title, self._skip, self._in_title = [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")
        if tag in ("h1", "h2", "h3"):
            self.parts.append("## ")
        elif tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def html_to_text(html):
    parser = _TextParser()
    parser.feed(html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n\s*", "\n\n", text)
    return parser.title.strip(), text.strip()


def check_public(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ToolError("Give a full web address starting with http:// or https://")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as e:
        if _uses_proxy() and not parts.hostname.lower().startswith("localhost"):
            return  # behind a proxy, names may only resolve on the proxy's side
        raise ToolError(f"Couldn't find {parts.hostname}. Check the address and the internet connection.") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ToolError("For safety this connector only opens public websites, not addresses on this computer or your network.")


class _PublicOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _uses_proxy():
    return bool(urllib.request.getproxies().get("https") or urllib.request.getproxies().get("http"))


@server.tool("Read a web page", read_only=True,
             description="Download a public web page and return its title and main text.",
             params={"url": ("string", "The page's full address, starting with https://"),
                     "max_characters": ("integer", f"How much text to return (default {MAX_CHARS})")},
             required=["url"])
def fetch_page(url, max_characters=MAX_CHARS):
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    check_public(url)
    opener = urllib.request.build_opener(_PublicOnly)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.9,*/*;q=0.5"})
    try:
        with opener.open(req, timeout=30) as resp:
            kind = resp.headers.get_content_type()
            charset = resp.headers.get_content_charset() or "utf-8"
            raw = resp.read(3_000_000)
            final = resp.geturl()
    except urllib.error.HTTPError as e:
        raise ToolError(f"The website answered with error {e.code} ({e.reason}).") from e
    except (urllib.error.URLError, OSError) as e:
        raise ToolError(f"Couldn't open {url}: {getattr(e, 'reason', e)}") from e
    if not (kind.startswith("text/") or kind in ("application/json", "application/xml", "application/xhtml+xml")):
        raise ToolError(f"That address is a {kind} file, not a web page, so it can't be read as text.")
    body = raw.decode(charset, "replace")
    title, text = (html_to_text(body) if "html" in kind else ("", body))
    limit = max(500, min(int(max_characters or MAX_CHARS), 40000))
    if len(text) > limit:
        text = text[:limit] + f"\n[... cut to the first {limit} characters]"
    head = f"Title: {title}\n" if title else ""
    return f"{head}Address: {final}\n\n{text or '(no readable text on this page)'}"


if __name__ == "__main__":
    server.run()
