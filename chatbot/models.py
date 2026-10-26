"""
The list of AI models the app offers, and the rules for which ones this
computer can run. Models that are too big are blocked so the computer doesn't
freeze or crash trying to load them.

Sizes are Ollama's 4-bit downloads. "need_gb" is roughly the memory a model
uses while chatting (its weights plus room for the conversation).
"""

CATALOG = [
    {
        "name": "qwen3:0.6b", "label": "Qwen 3 Micro", "size_gb": 0.5, "need_gb": 1.5,
        "tools": True,
        "about": "Phone-sized. Instant replies on any computer, but only for simple questions.",
    },
    {
        "name": "qwen3:1.7b", "label": "Qwen 3 Tiny", "size_gb": 1.4, "need_gb": 2.5,
        "tools": True,
        "about": "Phone-sized. Very quick and light, good for simple questions on older computers.",
    },
    {
        "name": "qwen3:4b", "label": "Qwen 3 Small", "size_gb": 2.5, "need_gb": 4,
        "tools": True,
        "about": "A great all-rounder for most laptops. Can organize folders for you.",
    },
    {
        "name": "qwen3:8b", "label": "Qwen 3 Medium", "size_gb": 5.2, "need_gb": 7,
        "tools": True,
        "about": "Smarter answers and better at homework and code. Needs a 16 GB computer.",
    },
    {
        "name": "qwen3:14b", "label": "Qwen 3 Large", "size_gb": 9.3, "need_gb": 12,
        "tools": True,
        "about": "Noticeably smarter. Best with a graphics card or 32 GB of memory.",
    },
    {
        "name": "qwen3:30b", "label": "Qwen 3 Extra Large", "size_gb": 19, "need_gb": 22,
        "tools": True,
        "about": "Very smart and still quick, for 32 to 64 GB desktops.",
    },
    {
        "name": "llama3.3:70b", "label": "Llama 3.3 Huge", "size_gb": 43, "need_gb": 48,
        "tools": True,
        "about": "The most knowledgeable model here. Needs a 64 GB computer, and replies come slowly.",
    },
    {
        "name": "gemma3:1b", "label": "Gemma 3 Mini", "size_gb": 0.8, "need_gb": 1.5,
        "tools": False,
        "about": "Phone-sized and friendly. Can't use tools like the folder organizer.",
    },
    {
        "name": "gemma3:4b", "label": "Gemma 3 Small", "size_gb": 3.3, "need_gb": 5,
        "tools": False,
        "about": "Friendly, natural writing. Can't use tools like the folder organizer.",
    },
    {
        "name": "gemma3:12b", "label": "Gemma 3 Medium", "size_gb": 8.1, "need_gb": 11,
        "tools": False,
        "about": "Strong writer for essays and explanations. Can't use tools.",
    },
    {
        "name": "gemma3:27b", "label": "Gemma 3 Large", "size_gb": 17, "need_gb": 20,
        "tools": False,
        "about": "Excellent writer for 32 to 64 GB desktops. Can't use tools.",
    },
    # Coding models: the chat switches to one of these for bigger coding projects.
    {
        "name": "qwen2.5-coder:1.5b", "label": "Qwen Coder Tiny", "size_gb": 1.0, "need_gb": 2,
        "tools": True, "coding": True,
        "about": "A small coding helper for older computers. Handles short programs.",
    },
    {
        "name": "qwen2.5-coder:3b", "label": "Qwen Coder Small", "size_gb": 1.9, "need_gb": 3,
        "tools": True, "coding": True,
        "about": "Writes and fixes code for small projects on most laptops.",
    },
    {
        "name": "qwen2.5-coder:7b", "label": "Qwen Coder Medium", "size_gb": 4.7, "need_gb": 6.5,
        "tools": True, "coding": True,
        "about": "Good at real projects like games, websites and apps. Needs 16 GB of memory.",
    },
    {
        "name": "qwen2.5-coder:14b", "label": "Qwen Coder Large", "size_gb": 9.0, "need_gb": 11.5,
        "tools": True, "coding": True,
        "about": "Strong at bigger, multi-file projects. Best with a graphics card.",
    },
    {
        "name": "qwen2.5-coder:32b", "label": "Qwen Coder Extra Large", "size_gb": 20, "need_gb": 23,
        "tools": True, "coding": True,
        "about": "Near the best open coding model, for powerful desktops.",
    },
]

OS_RESERVE_GB = 2.5  # memory left for the operating system and browser (less on small computers)


def tier(need_gb):
    """Which kind of device a model is sized for."""
    if need_gb <= 2.5:
        return "phone"
    if need_gb <= 8:
        return "laptop"
    if need_gb <= 16:
        return "desktop"
    return "workstation"


def need_for_size(size_gb):
    """Estimate memory needed for a model we only know the download size of."""
    return round(size_gb * 1.2 + 1, 1)


def rate(need_gb, hw):
    """
    How well this computer can run a model that needs `need_gb` of memory.
    Returns {"speed": "fast" | "good" | "slow" | "blocked", "reason": text}.
    """
    ram = hw["ram_gb"]
    if not ram:
        return {"speed": "good", "reason": "Couldn't check this computer's memory, so this model isn't blocked."}

    if hw["unified_memory"] and need_gb <= ram * 0.7:
        return {"speed": "fast", "reason": "Runs on your Apple chip's graphics."}
    if hw["vram_gb"] >= need_gb:
        return {"speed": "fast", "reason": f"Fits in your graphics card's {hw['vram_gb']:g} GB of memory."}
    if need_gb <= ram - min(OS_RESERVE_GB, ram * 0.35):
        if need_gb <= ram * 0.5:
            return {"speed": "good", "reason": "Runs well on your processor."}
        return {"speed": "slow", "reason": "Fits, but uses most of your memory, so replies will be slow."}
    return {
        "speed": "blocked",
        "reason": f"Needs about {need_gb:g} GB of memory. This computer has {ram:g} GB.",
    }


def recommend(hw, coding=False):
    """Pick the best tool-capable chat model (or coding model) this computer runs comfortably."""
    tool_models = [m for m in CATALOG if m["tools"] and m.get("coding", False) == coding]
    comfy = [m for m in tool_models if rate(m["need_gb"], hw)["speed"] in ("fast", "good")]
    if comfy:
        return max(comfy, key=lambda m: m["need_gb"])["name"]
    runnable = [m for m in tool_models if rate(m["need_gb"], hw)["speed"] != "blocked"]
    return runnable[0]["name"] if runnable else None


def best_installed_coder(installed, hw):
    """The best coding model that's installed and fits this computer, or None."""
    catalog, _ = build_list(installed, hw)
    usable = [m for m in catalog if m.get("coding") and m["installed"] and m["fit"]["speed"] != "blocked"]
    if not usable:
        return None
    comfy = [m for m in usable if m["fit"]["speed"] in ("fast", "good")] or usable
    best = max(comfy, key=lambda m: m["need_gb"])
    return next(n for n in installed if n in (best["name"], best["name"] + ":latest"))


# ---------- Adjustable settings for each model ----------

DEFAULT_SETTINGS = {"temperature": 0.7, "num_predict": -1, "num_ctx": 4096, "instructions": ""}
LENGTHS = [512, 1024, 2048, -1]  # longest answer in tokens (about 3/4 of a word each); -1 = no limit
CONTEXT_SIZES = [2048, 4096, 8192, 16384, 32768]


def context_options(need_gb, hw):
    """Which conversation-memory sizes fit on this computer. need_gb already includes 4K."""
    options = []
    for size in CONTEXT_SIZES:
        per_1k = 0.1 + need_gb * 0.005  # bigger models use more memory per 1,000 remembered tokens
        extra = max(0, (size - 4096) / 1024 * per_1k)
        options.append({"value": size, "ok": rate(need_gb + extra, hw)["speed"] != "blocked"})
    return options


def clean_settings(raw, need_gb, hw):
    """Check settings sent by the page and turn them into Ollama options plus extra instructions."""
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_SETTINGS)
    try:
        out["temperature"] = min(2.0, max(0.0, float(raw.get("temperature", out["temperature"]))))
    except (TypeError, ValueError):
        pass
    if raw.get("num_predict") in LENGTHS:
        out["num_predict"] = raw["num_predict"]
    allowed = [o["value"] for o in context_options(need_gb, hw) if o["ok"]] or [2048]
    wanted = raw.get("num_ctx", out["num_ctx"])
    if not isinstance(wanted, int) or isinstance(wanted, bool):
        wanted = out["num_ctx"]  # something odd (text, empty, a list): use the default size
    out["num_ctx"] = wanted if wanted in allowed else max(c for c in allowed if c <= max(wanted, allowed[0]))
    if isinstance(raw.get("instructions"), str):
        out["instructions"] = raw["instructions"].strip()[:2000]
    options = {k: out[k] for k in ("temperature", "num_predict", "num_ctx")}
    return options, out["instructions"]


def build_list(installed, hw):
    """
    Combine the catalog with what's installed in Ollama.
    `installed` maps model name -> download size in bytes.
    """
    def same(a, b):
        return a == b or a == b + ":latest"

    catalog = []
    for m in CATALOG:
        have = next((n for n in installed if same(n, m["name"])), None)
        entry = dict(m, installed=bool(have), fit=rate(m["need_gb"], hw), context=context_options(m["need_gb"], hw),
                     tier=tier(m["need_gb"]))
        if not have and hw.get("disk_free_gb") is not None and hw["disk_free_gb"] < m["size_gb"] + 1:
            entry["fit"] = {"speed": "blocked", "reason": f"Needs {m['size_gb']:g} GB of free disk space to download."}
        catalog.append(entry)

    others = []
    for name, size in installed.items():
        if any(same(name, m["name"]) for m in CATALOG):
            continue
        size_gb = round(size / 1e9, 1)
        others.append({
            "name": name, "label": name, "size_gb": size_gb, "need_gb": need_for_size(size_gb),
            "tools": None, "about": "A model you installed yourself.", "installed": True,
            "fit": rate(need_for_size(size_gb), hw),
            "context": context_options(need_for_size(size_gb), hw),
            "tier": tier(need_for_size(size_gb)),
        })
    return catalog, others
