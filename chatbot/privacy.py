"""
"Where your data is": a list of everything the app keeps, where it is on this computer,
and how big it is, plus what the app talks to over the network. Settings shows it so
people can check for themselves that their chats and files stay on their own computer.
"""

import os
from urllib.parse import urlparse

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def size_of(path):
    """Bytes used by a file or a whole folder (0 if it isn't there)."""
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for folder, _, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(folder, name))
            except OSError:
                pass  # removed while we were counting
    return total


def ollama_models_dir():
    return os.environ.get("OLLAMA_MODELS") or os.path.join(os.path.expanduser("~"), ".ollama", "models")


def is_local_url(url):
    return (urlparse(url).hostname or "").lower() in LOCAL_HOSTS


def report(places, ollama_url, phone_on=False, connectors_on=0):
    """
    places: (icon, name, path, what it holds) for each thing the app saves.
    Returns rows for the ones that exist, and a short summary of network use.
    """
    rows = []
    for icon, name, path, about in places:
        if not path or not os.path.exists(path):
            continue
        rows.append({"icon": icon, "name": name, "path": os.path.abspath(path),
                     "bytes": size_of(path), "about": about})
    host = urlparse(ollama_url).netloc or ollama_url
    return {
        "places": rows,
        "network": {
            "ollama": host,
            "ollama_local": is_local_url(ollama_url),
            "phone": bool(phone_on),
            "connectors": int(connectors_on),
        },
    }
