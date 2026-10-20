// "📖 Key words": the AI picks out the important terms from the current chat and explains each in
// one plain sentence, making a mini glossary a student can study or paste into their notes.
// The glossary is saved with the chat, so it opens instantly next time.
(() => {
  const MAX_TERMS = 10;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const PROMPT = `Pick the ${MAX_TERMS} or fewer most important words or terms a student should learn from the conversation below. `
    + "For each, give a short definition in simple words a middle schooler understands. "
    + "Write one per line in exactly this form and nothing else:\nterm: definition\n\nThe conversation:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #keywords-button { flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #keywords-dialog { width: min(620px, 94vw); }
    #keywords-dialog dl { margin: 14px 0 6px; display: grid; gap: 8px; max-height: calc(100vh - 240px); overflow-y: auto; }
    #keywords-dialog .term { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); }
    #keywords-dialog dt { font-weight: 700; color: var(--accent); }
    #keywords-dialog dd { margin: 2px 0 0; }
    #keywords-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    #keywords-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const button = el("button", { id: "keywords-button", type: "button", title: "Make a list of key words from this chat", hidden: true,
    onclick: () => open() }, "📖 Key words");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "keywords-dialog", "aria-labelledby": "keywords-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let terms = [];
  let making = null;

  // Read "term: definition" lines, tolerating bullets, numbers, bold text and dashes instead of colons.
  function parseTerms(text) {
    const out = [];
    const seen = new Set();
    for (let line of text.split("\n")) {
      line = line.replace(/\*\*/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
      const m = line.match(/^([^:]{1,48}?)\s*(?::|\s[–—-]\s)\s*(.{3,})$/);
      if (!m || /^(term|word)s?$/i.test(m[1])) continue;
      const term = m[1].trim();
      if (seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      out.push({ term, meaning: m[2].trim().slice(0, 240) });
    }
    return out.slice(0, MAX_TERMS);
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeTerms(chat) {
    const model = currentModel();
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT + transcript(chat) }], think: false, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let text = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") text += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    return parseTerms(text);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "keywords-title" }, "📖 Key words"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function draw() {
    const copy = el("button", { class: "primary" }, "Copy");
    copy.addEventListener("click", () => copyText(copy, terms.map((t) => `${t.term}: ${t.meaning}`).join("\n")));
    setDialog(head(),
      el("dl", {}, ...terms.map((t) => el("div", { class: "term" }, el("dt", {}, t.term), el("dd", {}, t.meaning)))),
      el("p", { class: "note" }, "Made by the AI from this chat. Check definitions against your textbook."),
      el("div", { class: "footer" }, copy, el("span", { class: "grow" }),
        el("button", { onclick: () => remake() }, "↻ Make it again")));
  }

  function drawMessage(text, retry) {
    setDialog(head(), el("p", {}, text),
      retry ? el("button", { class: "primary", onclick: () => remake() }, "Try again") : null);
  }

  async function remake() {
    const chat = currentChat();
    if (!chat) return;
    drawMessage("Finding the key words in this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      terms = await makeTerms(chat);
      if (!terms.length) return drawMessage("The AI didn't list the words in a form the app can read. Try again, or pick a bigger model.", true);
      chat.keywords = terms;
      saveChats();
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make the list: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.keywords?.length) {
      terms = chat.keywords;
      draw();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());

  // Show the button once the chat has a real answer to learn from.
  const update = () => {
    button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && (m.content || "").length > 200);
  };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
