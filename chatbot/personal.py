"""
Personalize: teach the AI about you without changing the model itself.

The models in the app are downloaded as-is from their makers (Qwen, Gemma, Llama).
Truly retraining one ("fine-tuning") needs a powerful graphics card and hours of
work, so instead this file teaches the model in four ways that run on any laptop:

  1. About me     A short profile (your name, grade, interests, how you like answers).
  2. Memory       Facts you ask it to remember ("remember that my essay is due Friday").
  3. Examples     Questions with the answer you wanted. The model copies their style.
  4. Assistants   Your own named model (like "history-tutor") built on an installed one,
                  with its own instructions, saved in Ollama so it shows up as a model.

Items 1 to 3 are added to the model's instructions in every chat (you can switch
that off), and "Export" saves your examples in the format real fine-tuning tools use.

Everything is saved in ~/.local-ai-chat/personal.json on this computer only.
"""

import json
import os
import re
import threading
import time
import uuid

DATA_PATH = os.path.join(os.path.expanduser("~"), ".local-ai-chat", "personal.json")

MAX_MEMORIES = 100
MAX_EXAMPLES = 50
MAX_ASSISTANTS = 20
MEMORY_CHARS = 300
PROFILE_CHARS = 1000
EXAMPLE_CHARS = 2000
INSTRUCTION_CHARS = 2000
EXAMPLES_PER_CHAT = 3  # how many saved examples go with each question
EXAMPLE_BUDGET = 4000  # characters of examples per chat, so small models keep room to answer

_lock = threading.Lock()


class PersonalError(Exception):
    """A problem to show the user, like a name that's already taken."""


def _empty():
    return {
        "enabled": True,  # use the profile, memory and examples in chats
        "remember_commands": True,  # save "remember that ..." messages to memory
        "profile": {"name": "", "about": "", "style": ""},
        "memories": [],
        "examples": [],
        "assistants": [],
    }


def load():
    data = _empty()
    try:
        with open(DATA_PATH, encoding="utf-8") as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            for key in data:
                if isinstance(saved.get(key), type(data[key])):
                    data[key] = saved[key]
    except (OSError, ValueError):
        pass
    return data


def _save(data):
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    tmp = DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, DATA_PATH)


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _change(fn):
    """Load, change and save the data under a lock, returning the new data."""
    with _lock:
        data = load()
        fn(data)
        _save(data)
        return data


# ---------- Settings and profile ----------

def set_options(enabled=None, remember_commands=None):
    def change(data):
        if isinstance(enabled, bool):
            data["enabled"] = enabled
        if isinstance(remember_commands, bool):
            data["remember_commands"] = remember_commands
    return _change(change)


def set_profile(profile):
    profile = profile if isinstance(profile, dict) else {}

    def change(data):
        data["profile"] = {k: _text(profile.get(k), PROFILE_CHARS) for k in ("name", "about", "style")}
    return _change(change)


# ---------- Memory ----------

def add_memory(text):
    text = _text(text, MEMORY_CHARS)
    if not text:
        raise PersonalError("Type something for the AI to remember.")

    def change(data):
        if any(m["text"].lower() == text.lower() for m in data["memories"]):
            return
        if len(data["memories"]) >= MAX_MEMORIES:
            raise PersonalError(f"Memory is full ({MAX_MEMORIES} items). Delete some to add more.")
        data["memories"].append({"id": uuid.uuid4().hex[:8], "text": text, "added": int(time.time())})
    return _change(change)


def delete_memory(item_id):
    return _change(lambda data: data.update(memories=[m for m in data["memories"] if m["id"] != item_id]))


REMEMBER = re.compile(r"^\s*(?:hey,?\s+)?(?:please\s+)?(?:can you\s+|could you\s+)?remember(?:\s+that|\s*:|\s*,)?\s+(.+)$",
                      re.IGNORECASE | re.DOTALL)


def remember_request(text):
    """The fact in a message like "remember that my dog is named Max", or None."""
    match = REMEMBER.match(text or "")
    if not match:
        return None
    fact = match.group(1).strip().rstrip("?.! ")
    if len(fact) < 3 or "\n\n" in fact or fact.lower().startswith(("when ", "what ", "how ", "the time ")):
        return None  # "remember when we..." is a question, not a fact to save
    return fact[:MEMORY_CHARS]


# ---------- Examples ----------

def add_example(prompt, answer):
    prompt, answer = _text(prompt, EXAMPLE_CHARS), _text(answer, EXAMPLE_CHARS)
    if not prompt or not answer:
        raise PersonalError("An example needs both a question and the answer you want.")

    def change(data):
        if len(data["examples"]) >= MAX_EXAMPLES:
            raise PersonalError(f"You have {MAX_EXAMPLES} examples, the most allowed. Delete some to add more.")
        data["examples"].append({"id": uuid.uuid4().hex[:8], "prompt": prompt, "answer": answer, "added": int(time.time())})
    return _change(change)


def delete_example(item_id):
    return _change(lambda data: data.update(examples=[e for e in data["examples"] if e["id"] != item_id]))


def _words(text):
    return {w for w in re.findall(r"[a-z0-9']+", text.lower()) if len(w) > 2}


def pick_examples(examples, question):
    """The saved examples most like this question (by shared words), newest first if none match."""
    asked = _words(question)
    scored = sorted(examples, key=lambda e: (len(asked & _words(e["prompt"])), e.get("added", 0)), reverse=True)
    picked, used = [], 0
    for e in scored[:EXAMPLES_PER_CHAT]:
        size = len(e["prompt"]) + len(e["answer"])
        if used + size > EXAMPLE_BUDGET:
            continue
        picked.append(e)
        used += size
    return picked


# ---------- What the model is told ----------

def context_for(messages, model=None, data=None):
    """
    Extra instructions and example messages for this chat.
    Returns (system_text, example_messages). Both are empty when there's nothing to add.
    """
    data = data or load()
    parts = []
    assistant = find_assistant(model, data)
    if assistant and assistant["instructions"]:
        parts.append(f"You are \"{assistant['name']}\", a custom assistant the user made. "
                     "Follow its instructions:\n" + assistant["instructions"])
    if not data["enabled"]:
        return "\n\n".join(parts), []

    p = data["profile"]
    about = []
    if p.get("name"):
        about.append(f"Their name is {p['name']}.")
    if p.get("about"):
        about.append(p["about"])
    if about:
        parts.append("About the user (they wrote this):\n" + "\n".join(about))
    if p.get("style"):
        parts.append("How the user wants you to answer:\n" + p["style"])
    if data["memories"]:
        parts.append("Things the user asked you to remember. Use them when they help, "
                     "and don't list them back unless asked:\n" + "\n".join("- " + m["text"] for m in data["memories"]))

    question = next((m.get("content", "") for m in reversed(messages or []) if m.get("role") == "user"), "")
    picked = pick_examples(data["examples"], question)
    examples = []
    for e in picked:
        examples += [{"role": "user", "content": e["prompt"]}, {"role": "assistant", "content": e["answer"]}]
    if examples:
        parts.append("The first messages below are examples the user saved to show the kind of answers they want. "
                     "Match their style and level of detail. The real conversation starts after them.")
    return "\n\n".join(parts), examples


# ---------- Custom assistants (saved as their own Ollama models) ----------

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")


def clean_name(name):
    name = re.sub(r"[^a-z0-9-]+", "-", (name or "").strip().lower()).strip("-")[:31]
    if not NAME.match(name):
        raise PersonalError("Give the assistant a name of 2 to 31 letters, numbers or dashes, like history-tutor.")
    return name


def find_assistant(model, data=None):
    if not model:
        return None
    data = data or load()
    base = model[:-len(":latest")] if model.endswith(":latest") else model
    return next((a for a in data["assistants"] if a["name"] == base), None)


def assistant_request(name, base, instructions, temperature, taken):
    """
    Check a new assistant and build the Ollama /api/create request for it.
    `taken` is the set of model names that already exist (catalog and installed).
    Returns (record, ollama_payload).
    """
    name = clean_name(name)
    if name in taken or name + ":latest" in taken:
        raise PersonalError(f"There's already a model called {name}. Pick another name.")
    instructions = _text(instructions, INSTRUCTION_CHARS)
    if not instructions:
        raise PersonalError("Tell the assistant what it's for, like \"You are a patient chemistry tutor.\"")
    try:
        temperature = min(2.0, max(0.0, float(temperature)))
    except (TypeError, ValueError):
        temperature = 0.7
    record = {"name": name, "base": base, "instructions": instructions, "temperature": temperature,
              "created": int(time.time())}
    payload = {"model": name, "from": base, "system": instructions,
               "parameters": {"temperature": temperature}, "stream": False}
    return record, payload


def save_assistant(record):
    def change(data):
        others = [a for a in data["assistants"] if a["name"] != record["name"]]
        if len(others) >= MAX_ASSISTANTS:
            raise PersonalError(f"You can have up to {MAX_ASSISTANTS} assistants. Delete one first.")
        data["assistants"] = others + [record]
    return _change(change)


def delete_assistant(name):
    return _change(lambda data: data.update(assistants=[a for a in data["assistants"] if a["name"] != name]))


# ---------- Export for real fine-tuning ----------

def export_jsonl(data=None):
    """
    Your examples as JSON Lines in the "messages" format that fine-tuning tools
    (like Unsloth or MLX-LM) read. Each line is one example conversation.
    """
    data = data or load()
    system, _ = context_for([], data=dict(data, examples=[]))
    lines = []
    for e in data["examples"]:
        convo = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": e["prompt"]}, {"role": "assistant", "content": e["answer"]}]
        lines.append(json.dumps({"messages": convo}, ensure_ascii=False))
    return "\n".join(lines) + ("\n" if lines else "")
