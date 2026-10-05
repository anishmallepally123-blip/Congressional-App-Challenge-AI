"""
Memory connector: lets the AI remember facts about you between chats.

    python memory_server.py

Facts are saved in ~/.local-ai-chat/memory.json on this computer. You can read or
delete that file any time.
"""

import datetime
import json
import os

from mcp_server import Server, ToolError

MEMORY_PATH = os.environ.get("MEMORY_PATH", os.path.join(os.path.expanduser("~"), ".local-ai-chat", "memory.json"))
server = Server("memory")


def load():
    try:
        with open(MEMORY_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save(facts):
    os.makedirs(os.path.dirname(MEMORY_PATH), exist_ok=True)
    tmp = MEMORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(facts, f, indent=2)
    os.replace(tmp, MEMORY_PATH)


@server.tool("Remember something",
             description="Save a fact about the user to remember in future chats, such as their name, "
                         "preferences, goals or important dates. Keep each fact to one short sentence.",
             params={"fact": ("string", "The fact, e.g. 'The user's favorite subject is biology.'")},
             required=["fact"])
def remember(fact):
    fact = " ".join(fact.split())
    if not fact:
        raise ToolError("There's nothing to remember.")
    facts = load()
    if any(f["fact"].lower() == fact.lower() for f in facts):
        return "Already remembered."
    next_id = max((f["id"] for f in facts), default=0) + 1
    facts.append({"id": next_id, "fact": fact, "saved": datetime.date.today().isoformat()})
    save(facts)
    return f"Remembered (#{next_id}): {fact}"


@server.tool("Recall memories", read_only=True,
             description="Look up facts saved about the user. Use this at the start of a chat when knowing "
                         "the user would help, or when they ask what you remember.",
             params={"search": ("string", "Only facts containing these words (leave empty for all)")})
def recall(search=""):
    words = search.lower().split()
    facts = [f for f in load() if all(w in f["fact"].lower() for w in words)]
    if not facts:
        return "Nothing saved yet." if not words else f"Nothing saved about: {search}"
    return "\n".join(f"#{f['id']} ({f['saved']}): {f['fact']}" for f in facts[-100:])


@server.tool("Forget something",
             description="Delete a saved fact, by its number from recall.",
             params={"id": ("integer", "The fact's number")}, required=["id"])
def forget(id):
    facts = load()
    keep = [f for f in facts if f["id"] != int(id)]
    if len(keep) == len(facts):
        raise ToolError(f"There's no saved fact #{id}.")
    save(keep)
    return f"Forgot fact #{id}."


if __name__ == "__main__":
    server.run()
