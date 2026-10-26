"""
Decides when a chat message is a bigger coding project that should go to a
dedicated coding model instead of the everyday chat model.

Small code questions ("how do I reverse a list in Python?") stay with the chat
model. Requests to build, debug or rewrite real programs go to the coding model.
It's a quick word check, so it adds no delay before the answer starts.
"""

import re

LANGUAGES = (
    "python", "javascript", "typescript", "java", "c\\+\\+", "c#", "html", "css", "sql", "react",
    "node", "rust", "golang", "swift", "kotlin", "php", "ruby", "bash", "powershell", "lua",
    "flask", "django", "pygame", "unity", "arduino", "json", "api",
)
# Things people build with code
ARTIFACTS = (
    "app", "apps", "application", "game", "website", "web app", "web page", "webpage", "bot", "chatbot",
    "extension", "plugin", "mod", "program", "script", "calculator", "api", "database", "backend",
    "frontend", "server", "tool", "simulator", "interface", "gui",
)
BUILD_WORDS = ("build", "create", "make", "develop", "implement", "code", "program", "write")
FIX_WORDS = ("debug", "refactor", "rewrite", "optimize", "fix")
CODE_WORDS = (
    "code", "coding", "program", "programming", "script", "function", "class", "algorithm",
    "bug", "error", "exception", "compile", "variable", "loop", "github", "repo",
) + LANGUAGES + ARTIFACTS
# Words that also mean something outside programming: a script for a play, a game of cards,
# a workout program. They count as code only when nothing in the message says it's about
# something else, or when it also names a language or clearly talks about code.
AMBIGUOUS = ("script", "program", "game", "tool", "mod", "server", "app", "application", "class", "loop", "error")
NOT_CODE = (
    "video", "videos", "youtube", "tiktok", "vlog", "podcast", "movie", "film", "skit", "scene", "speech",
    "presentation", "essay", "story", "poem", "song", "lyrics", "play", "theater", "theatre", "talent show",
    "radio", "commercial", "plan", "workout", "training", "exercise", "fitness", "diet", "meal", "menu",
    "board game", "card game", "party game", "soccer", "basketball", "football", "team", "wood", "garden",
    "store", "tv",
)
STRONG_CODE = (
    "code", "coding", "programming", "function", "algorithm", "compile", "variable", "github", "repo",
    "debug", "bug", "exception", "terminal", "command line",
) + LANGUAGES
BIG_WORDS = ("full", "complete", "entire", "whole", "project", "from scratch", "multiple files", "step by step", "working")


def _matches(words, text):
    return [w for w in words if re.search(rf"(?<![\w+#]){w}(?![\w+#])", text)]


def _about_something_else(lower):
    """True when the message is about a play, a video, a workout and so on, with no sign of code."""
    lower = re.sub(r"\bvideo ?games?\b", "game", lower)  # a video game is still code
    return bool(_matches(NOT_CODE, lower)) and not _matches(STRONG_CODE, lower)


def is_big_coding_request(text):
    """True when the message asks for a real coding project, not a one-line answer."""
    lower = text.lower()
    code_lines = sum(len(block.splitlines()) for block in re.findall(r"```(.*?)(?:```|$)", text, re.S))
    if code_lines >= 12:
        return True  # pasted a real chunk of code to work on
    builds = _matches(BUILD_WORDS, lower)
    artifacts = _matches(ARTIFACTS, lower)
    coding = _matches(CODE_WORDS, lower)
    if _about_something_else(lower):
        artifacts = [w for w in artifacts if w not in AMBIGUOUS]
        coding = [w for w in coding if w not in AMBIGUOUS]
    if builds and artifacts:
        return True  # "build a game", "make a calculator app", "create a Chrome extension"
    if _matches(FIX_WORDS, lower) and set(coding) & {"code", "program", "script", "app", "game", "website", "bug", "loop"}:
        return True  # "debug my code", "fix the bug in my game"
    if coding and _matches(BIG_WORDS, lower):
        return True  # "a complete Python project"
    return bool(coding) and len(lower) > 600  # a long, detailed request about code


def is_coding_follow_up(text):
    """A message that keeps going on code (used to stay with the coding model)."""
    lower = text.lower()
    if "```" in text:
        return True
    if _about_something_else(lower):
        return False  # "now write a script for my video" moves on from the code
    return bool(_matches(CODE_WORDS + BUILD_WORDS + FIX_WORDS, lower))


def choose(messages, chosen, coder):
    """
    Pick the model for this reply.
    messages: the conversation (each has role, content and, for answers, the model that wrote it).
    chosen: the model the user picked. coder: the best installed coding model, or None.
    Returns (model, reason) where reason is None when no switch happens.
    """
    if not coder or coder == chosen or not messages:
        return chosen, None
    text = messages[-1].get("content", "")
    if is_big_coding_request(text):
        return coder, "It was picked because this looks like a coding project."
    last_answer = next((m for m in reversed(messages[:-1]) if m.get("role") == "assistant"), None)
    if last_answer and last_answer.get("model") == coder and is_coding_follow_up(text):
        return coder, "It is still working on your code."
    return chosen, None
