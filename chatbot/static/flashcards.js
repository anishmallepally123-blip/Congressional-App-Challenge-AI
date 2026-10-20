// "🃏 Flashcards": the AI turns the current chat into study cards you can flip through.
// The deck is saved with the chat, so it opens instantly next time.
(() => {
  const MAX_CARDS = 10;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const PROMPT = `Make up to ${MAX_CARDS} flashcards to help a student study the conversation below. `
    + "Each card tests one important fact or idea from it. Write one card per line in exactly this form:\n"
    + "question | answer\n"
    + "Keep each answer under 20 words. Write nothing else.\n\nThe conversation:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #flashcards-button { margin-left: auto; flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #flashcards-dialog { width: min(560px, 94vw); }
    #flashcards-dialog .card { position: relative; min-height: 220px; display: flex; flex-direction: column; justify-content: center; align-items: center;
      text-align: center; gap: 10px; padding: 28px 24px; margin: 6px 0 14px; border-radius: 16px; cursor: pointer; user-select: none;
      border: 1px solid var(--border-strong); background: var(--panel); font-size: 1.15em; line-height: 1.45; }
    #flashcards-dialog .card.answer { background: var(--accent-soft); border-color: var(--accent); }
    #flashcards-dialog .card .side { position: absolute; top: 10px; left: 14px; font-size: 0.65em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    #flashcards-dialog .card .hint { font-size: 0.65em; color: var(--muted); }
    #flashcards-dialog .controls { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
    #flashcards-dialog .controls .count { color: var(--muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
    #flashcards-dialog .footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; flex-wrap: wrap; }`;
  document.head.append(style);

  const button = el("button", { id: "flashcards-button", type: "button", title: "Study this chat with flashcards", hidden: true,
    onclick: () => open() }, "🃏 Flashcards");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "flashcards-dialog", "aria-labelledby": "flashcards-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let deck = [];
  let index = 0;
  let flipped = false;
  let making = null;

  // Read "question | answer" lines, tolerating numbering, bullets, bold text, Q:/A: labels and table rows.
  function parseCards(text) {
    const cards = [];
    for (let line of text.split("\n")) {
      line = line.replace(/\*\*/g, "").replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim().replace(/^\|(.*)\|$/, "$1");
      const parts = line.split("|").map((p) => p.trim().replace(/^(?:Q|A|Question|Answer)\s*[:.]\s*/i, ""));
      if (parts.length !== 2 || !parts[0] || !parts[1] || /^-+$/.test(parts[0]) || /^question$/i.test(parts[0])) continue;
      cards.push({ q: parts[0], a: parts[1] });
    }
    return cards.slice(0, MAX_CARDS);
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeDeck(chat) {
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
    const cards = parseCards(text);
    if (!cards.length) throw new Error("the AI didn't write any cards. Try again, or try a bigger model.");
    return cards;
  }

  function draw() {
    const card = deck[index];
    setDialog(
      el("div", { class: "dialog-head" },
        el("h2", { id: "flashcards-title" }, "🃏 Flashcards"),
        el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
      el("div", { class: `card${flipped ? " answer" : ""}`, role: "button", tabindex: "0", "aria-live": "polite",
        onclick: flip, onkeydown: (e) => { if (e.key === "Enter") flip(); } },
        el("span", { class: "side" }, flipped ? "Answer" : "Question"),
        el("div", {}, flipped ? card.a : card.q),
        flipped ? null : el("span", { class: "hint" }, "Click or press Space to see the answer")),
      el("div", { class: "controls" },
        el("button", { onclick: () => go(-1), disabled: index === 0 }, "← Back"),
        el("span", { class: "count" }, `${index + 1} of ${deck.length}`),
        el("button", { class: "primary", onclick: () => go(1), disabled: index === deck.length - 1 }, "Next →")),
      el("div", { class: "footer" },
        el("button", { onclick: shuffle }, "🔀 Shuffle"),
        el("button", { onclick: () => remake() }, "↻ Make new cards")));
    dialog.querySelector(".card").focus(); // so Space and the arrow keys keep working after each click
  }

  function drawMessage(text, retry) {
    setDialog(
      el("div", { class: "dialog-head" },
        el("h2", { id: "flashcards-title" }, "🃏 Flashcards"),
        el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
      el("p", {}, text),
      retry ? el("button", { class: "primary", onclick: () => remake() }, "Try again") : null);
  }

  const flip = () => { flipped = !flipped; draw(); };
  const go = (step) => { index = Math.min(deck.length - 1, Math.max(0, index + step)); flipped = false; draw(); };
  function shuffle() {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    index = 0;
    flipped = false;
    draw();
  }

  async function remake() {
    const chat = currentChat();
    if (!chat) return;
    drawMessage("Making flashcards from this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      deck = await makeDeck(chat);
      chat.flashcards = deck;
      saveChats();
      index = 0;
      flipped = false;
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make flashcards: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.flashcards?.length) {
      deck = chat.flashcards.slice();
      index = 0;
      flipped = false;
      draw();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());
  dialog.addEventListener("keydown", (e) => {
    if (!deck.length || e.target.tagName === "BUTTON" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.key === " ") { e.preventDefault(); flip(); }
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  });

  // Show the button only on chats with an answer to study.
  const update = () => { button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && m.content); };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
