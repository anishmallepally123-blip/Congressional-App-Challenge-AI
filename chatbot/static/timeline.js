// "🕰️ Timeline": the AI pulls the dated events out of the current chat and lays them out in order,
// so a history (or science) chat becomes a timeline a student can study or copy into notes.
// The timeline is saved with the chat, so it opens instantly next time.
(() => {
  const MAX_EVENTS = 14;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const PROMPT = "List the dated events mentioned in the conversation below, as a timeline for a student. "
    + `Give up to ${MAX_EVENTS} events, oldest first, one per line in exactly this form:\n`
    + "date | what happened\n"
    + "Write the date as a year (like 1863 or 44 BC), or a month and year, or a full date. "
    + "Keep each event under 16 words. Only use dates from the conversation or that you are sure of. "
    + "If the conversation has no dates, write only NONE.\n\nThe conversation:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #timeline-button { flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #timeline-dialog { width: min(640px, 94vw); }
    #timeline-dialog ol { list-style: none; margin: 14px 0 6px; padding: 0 0 0 4px; max-height: calc(100vh - 230px); overflow-y: auto; }
    #timeline-dialog li { position: relative; padding: 0 0 16px 28px; border-left: 2px solid var(--border-strong); margin-left: 8px; }
    #timeline-dialog li:last-child { border-left-color: transparent; }
    #timeline-dialog li::before { content: ""; position: absolute; left: -7px; top: 3px; width: 12px; height: 12px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 0 3px var(--bg); }
    #timeline-dialog .when { display: block; font-weight: 650; color: var(--accent); font-variant-numeric: tabular-nums; }
    #timeline-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    #timeline-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const button = el("button", { id: "timeline-button", type: "button", title: "Put the dates from this chat on a timeline", hidden: true,
    onclick: () => open() }, "🕰️ Timeline");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "timeline-dialog", "aria-labelledby": "timeline-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let events = [];
  let making = null;

  // A number to sort a date by: years BC are negative, and a month or day nudges it within its year.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function sortKey(when) {
    const text = when.toLowerCase();
    const year = text.match(/(\d{1,4})s?\s*(bce|bc)?\b(?!.*\d{3,4})/);
    if (!year) return null;
    let key = Number(year[1]) * (year[2] || /\b(bce|bc)\b/.test(text) ? -1 : 1);
    const month = MONTHS.findIndex((m) => text.includes(m));
    if (month >= 0) {
      key += (month + 1) / 13;
      const day = text.replace(year[0], "").match(/\b(\d{1,2})\b/);
      if (day) key += Number(day[1]) / 13 / 32;
    }
    return key;
  }

  // Read "date | event" lines, tolerating bullets, bold text, dashes or colons instead of the bar.
  function parseEvents(text) {
    const out = [];
    for (let line of text.split("\n")) {
      line = line.replace(/\*\*/g, "").replace(/^\s*(?:[-*•]|\d+[.)](?=\s))\s*/, "").trim().replace(/^\|(.*)\|$/, "$1");
      const m = line.match(/^(.{1,40}?)\s*(?:\||:|\s[–—-]\s)\s*(.+)$/);
      if (!m || /^(date|when)$/i.test(m[1].trim()) || /^-+$/.test(m[1].trim())) continue;
      const key = sortKey(m[1]);
      if (key === null) continue;
      out.push({ when: m[1].trim(), what: m[2].trim().slice(0, 200), key });
    }
    return out.sort((a, b) => a.key - b.key).slice(0, MAX_EVENTS);
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeTimeline(chat) {
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
    return parseEvents(text);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "timeline-title" }, "🕰️ Timeline"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function draw() {
    const copy = el("button", { class: "primary" }, "Copy");
    copy.addEventListener("click", () => copyText(copy, events.map((e) => `${e.when}: ${e.what}`).join("\n")));
    setDialog(head(),
      el("ol", {}, ...events.map((e) => el("li", {}, el("span", { class: "when" }, e.when), e.what))),
      el("p", { class: "note" }, "Made by the AI from this chat. Check dates before using them in schoolwork."),
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
    drawMessage("Finding the dates in this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      events = await makeTimeline(chat);
      if (!events.length) {
        delete chat.timeline;
        saveChats();
        return drawMessage("This chat doesn't mention any dates to put on a timeline. Ask about a time in history and try again.", true);
      }
      chat.timeline = events;
      saveChats();
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make a timeline: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.timeline?.length) {
      events = chat.timeline;
      draw();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());

  // Show the button only on chats whose answers mention a year, so it doesn't clutter other chats.
  const update = () => {
    button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && /\b\d{3,4}\b/.test(m.content || ""));
  };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
