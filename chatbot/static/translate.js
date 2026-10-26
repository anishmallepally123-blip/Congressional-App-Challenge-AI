// "🌐 Translate" under each answer: the AI on this computer rewrites the answer in another language,
// so a student can share it with family who read a different language. The translation is saved with the chat.
(() => {
  const LANG_KEY = "local-ai-translate-lang";
  const LANGUAGES = [
    ["Spanish", "Español"], ["Chinese", "中文"], ["Hindi", "हिन्दी"], ["Vietnamese", "Tiếng Việt"],
    ["Arabic", "العربية"], ["Tagalog", "Tagalog"], ["French", "Français"], ["Portuguese", "Português"],
    ["Korean", "한국어"], ["Russian", "Русский"], ["Telugu", "తెలుగు"], ["English", "English"],
  ];
  const prompt = (lang) => `Translate the text below into ${lang}. Keep the Markdown formatting, code blocks, `
    + "numbers and names exactly as they are. Write only the translation, with no notes before or after it.\n\n";

  const style = document.createElement("style");
  style.textContent = `
    .translate-wrap { position: relative; display: inline-block; }
    .translate-menu { position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 20; display: grid; grid-template-columns: 1fr 1fr; gap: 2px;
      padding: 6px; min-width: 240px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--bg, #fff);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
    .msg .translate-menu button { text-align: left; font-size: 0.85em; padding: 5px 9px; border-color: transparent; color: var(--text); }
    .translate-menu button.last { border-color: var(--accent); }
    .msg .translation { margin-top: 10px; padding: 10px 14px; border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0; background: var(--accent-soft); }
    .msg .translation .head { display: flex; align-items: center; gap: 6px; font-size: 0.78em; color: var(--muted); margin-bottom: 4px; }
    .msg .translation .head button { font-size: 1em; padding: 1px 8px; border-color: transparent; }
    .msg .translation .head .grow { flex: 1; }`;
  document.head.append(style);

  let busy = null; // the translation in progress, so only one runs at a time

  // The chat message an answer bubble shows: bubbles follow chat.messages in order, minus tool results.
  function messageFor(bubble) {
    const chat = currentChat();
    if (!chat) return null;
    const shown = chat.messages.filter((m) => m.role !== "tool");
    return shown[[...messagesEl.children].indexOf(bubble)] || null;
  }

  function translationBox(m, bubble) {
    const t = m.translation;
    const body = el("div", { class: "body", dir: "auto" });
    body.innerHTML = renderMarkdown(t.text || "…");
    return el("div", { class: "translation" },
      el("div", { class: "head" },
        el("span", { class: "grow" }, `🌐 ${t.lang}${t.done === false ? " (translating...)" : ""}`),
        t.done === false ? null : el("button", { onclick: (e) => copyText(e.target, t.text) }, "Copy"),
        el("button", { "aria-label": "Hide translation", title: "Hide translation", onclick: () => {
          if (busy?.m === m) busy.abort();
          delete m.translation;
          saveChats();
          bubble.querySelector(".translation")?.remove();
        } }, "✕")),
      body);
  }

  function show(m, bubble) {
    const old = bubble.querySelector(".translation");
    const box = translationBox(m, bubble);
    if (old) old.replaceWith(box);
    else bubble.querySelector(".actions").before(box);
  }

  async function translate(bubble, lang) {
    const m = messageFor(bubble);
    if (!m || m.role !== "assistant") return;
    if (controller) return toast("Wait for the answer to finish first.");
    const model = currentModel();
    if (findModel(model)?.experimental) return toast("TinyGPT can't translate. Pick a chat model in Models first.");
    busy?.abort();
    const ctl = new AbortController();
    busy = { m, abort: () => ctl.abort() };
    m.translation = { lang, text: "", done: false };
    show(m, bubble);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt(lang) + m.content }], think: false, auto_code: false }),
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
      let failed = null;
      await readLines(resp, (ev) => {
        if (ev.type === "text") {
          m.translation.text += ev.text;
          bubble.querySelector(".translation .body").innerHTML = renderMarkdown(m.translation.text);
        }
        if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      if (!m.translation.text.trim()) throw new Error("the AI didn't write anything. Try again, or try a bigger model.");
      m.translation.text = m.translation.text.trim();
      delete m.translation.done;
      saveChats();
      show(m, bubble);
    } catch (err) {
      delete m.translation;
      bubble.querySelector(".translation")?.remove();
      if (err.name !== "AbortError") toast(`Couldn't translate: ${err.message}`);
    } finally {
      if (busy?.m === m) busy = null;
    }
  }

  function closeMenus() { document.querySelectorAll(".translate-menu").forEach((menu) => menu.remove()); }

  function openMenu(wrap, bubble) {
    const wasOpen = wrap.querySelector(".translate-menu");
    closeMenus();
    if (wasOpen) return;
    let last = "";
    try { last = localStorage.getItem(LANG_KEY) || ""; } catch {}
    wrap.append(el("div", { class: "translate-menu", role: "menu" },
      ...LANGUAGES.map(([name, native]) => el("button", { role: "menuitem", class: name === last ? "last" : "",
        title: name, onclick: () => {
          closeMenus();
          try { localStorage.setItem(LANG_KEY, name); } catch {}
          translate(bubble, name);
        } }, native))));
    wrap.querySelector(".translate-menu button").focus();
  }

  // Add the button (and any saved translation) to answer bubbles each time the chat is drawn.
  function decorate() {
    if (controller) return; // the answer is still being written
    for (const bubble of messagesEl.querySelectorAll(":scope > .msg.assistant")) {
      const actions = bubble.querySelector(":scope > .actions");
      if (!actions || actions.querySelector(".translate-wrap")) continue;
      const m = messageFor(bubble);
      if (!m || m.role !== "assistant" || !m.content) continue;
      const wrap = el("span", { class: "translate-wrap" });
      wrap.append(el("button", { title: "Translate this answer into another language", "aria-haspopup": "menu",
        onclick: () => openMenu(wrap, bubble) }, "🌐 Translate"));
      const tag = actions.querySelector(".model-tag");
      if (tag) tag.before(wrap);
      else actions.append(wrap);
      if (m.translation?.text && m.translation.done !== false) show(m, bubble);
    }
  }

  document.addEventListener("click", (e) => { if (!e.target.closest(".translate-wrap")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  new MutationObserver(decorate).observe(messagesEl, { childList: true });
  decorate();
})();
