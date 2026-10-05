"""
Slack connector: read channels and post messages in your Slack workspace.

    python slack_server.py           (with SLACK_BOT_TOKEN set)

Setup (about 5 minutes):
  1. Go to https://api.slack.com/apps > Create New App > From scratch, and pick your workspace.
  2. Under OAuth & Permissions > Bot Token Scopes, add: channels:read, channels:history,
     groups:read, groups:history, chat:write, users:read.
  3. Press "Install to Workspace", then copy the "Bot User OAuth Token" (starts with xoxb-)
     and paste it as SLACK_BOT_TOKEN on the Connectors page.
  4. In Slack, invite the app to each channel it should read: /invite @YourAppName
"""

import datetime
import os
import urllib.parse

from mcp_server import Server, ToolError, http_json, need_env, setup_error

API = os.environ.get("SLACK_API", "https://slack.com/api")
HOW = ("Create an app at api.slack.com/apps, add bot scopes (channels:read, channels:history, groups:read, "
       "groups:history, chat:write, users:read), install it, and paste its Bot User OAuth Token as SLACK_BOT_TOKEN=xoxb-...")
TOKEN = need_env("SLACK_BOT_TOKEN", HOW) if __name__ == "__main__" else os.environ.get("SLACK_BOT_TOKEN", "")
server = Server("slack")
_users = {}

HINTS = {
    "not_in_channel": "The app isn't in that channel. In Slack, type /invite @YourAppName in the channel.",
    "channel_not_found": "There's no channel by that name that the app can see.",
    "missing_scope": "The app is missing a permission. Add the scopes listed in the setup steps, then reinstall it.",
    "invalid_auth": "Slack didn't accept the token. Copy the Bot User OAuth Token (xoxb-...) again.",
    "not_authed": "No token was sent. Paste the Bot User OAuth Token as SLACK_BOT_TOKEN.",
    "ratelimited": "Slack says too many requests. Wait a minute and try again.",
}


def slack(method, http="GET", **params):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if http == "GET":
        data = http_json(f"{API}/{method}?{urllib.parse.urlencode(params)}", headers=headers, service="Slack")
    else:
        data = http_json(f"{API}/{method}", "POST", body=params, headers=headers, service="Slack")
    if not data.get("ok"):
        err = data.get("error", "unknown_error")
        extra = f" (needs: {data['needed']})" if data.get("needed") else ""
        raise ToolError(f"Slack said {err}{extra}. {HINTS.get(err, '')}".strip())
    return data


def find_channel(name):
    name = name.strip().lstrip("#")
    if name[:1] in ("C", "G") and name.isupper() and len(name) >= 9:
        return name
    cursor = ""
    while True:
        data = slack("conversations.list", types="public_channel,private_channel", limit=200,
                     exclude_archived="true", cursor=cursor)
        for ch in data.get("channels", []):
            if ch["name"].lower() == name.lower():
                return ch["id"]
        cursor = (data.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            raise ToolError(f"There's no channel called #{name} that the app can see. {HINTS['channel_not_found']}")


def user_name(uid):
    if uid not in _users:
        try:
            u = slack("users.info", user=uid)["user"]
            _users[uid] = u.get("real_name") or u.get("name") or uid
        except ToolError:
            _users[uid] = uid
    return _users[uid]


@server.tool("List Slack channels", read_only=True,
             description="List the Slack channels the app can see, and whether it has joined each one.")
def list_channels():
    data = slack("conversations.list", types="public_channel,private_channel", limit=200, exclude_archived="true")
    rows = [f"#{c['name']}{'' if c.get('is_member') else ' (app not invited)'}"
            + (f": {c['purpose']['value'][:80]}" if (c.get('purpose') or {}).get('value') else "")
            for c in data.get("channels", [])]
    return "\n".join(rows) or "The app can't see any channels yet."


@server.tool("Read a Slack channel", read_only=True,
             description="Read the most recent messages in a Slack channel.",
             params={"channel": ("string", "Channel name, e.g. general"),
                     "count": ("integer", "How many messages, up to 50 (default 20)")},
             required=["channel"])
def read_channel(channel, count=20):
    data = slack("conversations.history", channel=find_channel(channel), limit=max(1, min(int(count or 20), 50)))
    rows = []
    for m in reversed(data.get("messages", [])):
        when = datetime.datetime.fromtimestamp(float(m["ts"])).strftime("%b %d %I:%M %p")
        who = user_name(m["user"]) if m.get("user") else m.get("username") or "bot"
        rows.append(f"[{when}] {who}: {m.get('text', '')}")
    return "\n".join(rows) or "No messages."


@server.tool("Post to Slack",
             description="Post a message in a Slack channel as the app. Only do this when the user asks.",
             params={"channel": ("string", "Channel name, e.g. general"), "text": ("string", "The message")},
             required=["channel", "text"])
def post_message(channel, text):
    slack("chat.postMessage", "POST", channel=find_channel(channel), text=text)
    return f"Posted in #{channel.lstrip('#')}."


if __name__ == "__main__":
    try:
        slack("auth.test")
    except ToolError as e:
        setup_error(str(e))
    server.run()
