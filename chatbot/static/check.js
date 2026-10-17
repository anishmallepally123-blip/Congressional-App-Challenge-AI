// "🔍 Double-check" under each answer: the AI goes back over its own answer, looking for wrong facts,
// math slips and missing steps, and says what to verify. Small local models make mistakes, and this
// shows students to check AI answers instead of trusting them. The check is saved with the chat.
(() => {
  const VERDICTS = [
    ["✅", "good", "Looks right"],
    ["⚠️", "warn", "Mostly right"],
    ["❌", "bad", "Has mistakes"],
  ];
  const prompt = (question, answer) =>
    "You are checking another AI assistant's answer for mistakes before a student relies on it.\n\n" +
    `Question:\n${question}\n\nAnswer to check:\n${answer}\n\n` +
    "Go over each fact, number, calculation and step. Reply in this exact format:\n" +
    "First line: exactly one of \"✅ Looks right\", \"⚠️ Mostly right, with small issues\" or \"❌ Has mistakes\".\n" +
    "Then up to 4 short bullet points. For each mistake, say what is wrong and the correct version. " +
    "If a fact can't be checked from what you know, say it's worth looking up in another source. " +
    "If everything is right, one bullet saying what you checked is enough. Don't rewrite the whole answer.";

  const style = document.createElement("style");
  style.textContent = `
    .msg .double-check { margin-top: 10px; padding: 10px 14px; border-left: 3px solid var(--border-strong);
      border-radius: 0 10px 10px 0; background: var(--panel); }
    .msg .double-check.good { border-left-color: #3f9a5b; }
    .msg .double-check.warn { border-left-color: #d49a22; }
    .msg .double-check.bad { border-left-color: #c94a3a; }
    .msg .double-check .head { display: flex; align-items: center; gap: 6px; font-size: 0.78em; color: var(--muted); margin-bottom: 4px; }
    .msg .double-check .head .grow { flex: 1; }
    .msg .double-check .head button { font-size: 1em; padding: 1px 8px; border-color: transparent; }
    .msg .double-check .body > :first-child { margin-top: 0; }
    .msg .double-check .body > :last-child { margin-bottom: 0; }`;
  document.head.append(style);

  let busy = null; // the check in progress, so only one runs at a time

  // Bubbles follow chat.messages in order, minus tool results.
  function shownMessages() {
    const chat = currentChat();
    return chat ? chat.messages.filter((m) => m.role !== "tool") : [];
  }
  function messageFor(bubble) {
    return shownMessages()[[...messagesEl.children].indexOf(bubble)] || null;
  }
  function questionFor(m) {
    const shown = shownMessages();
    for (let i = shown.indexOf(m) - 1; i >= 0; i--) if (shown[i].role === "user") return shown[i].content;
    return "";
  }

  function verdictOf(text) {
    const first = text.trim().split("\n")[0] || "";
    return VERDICTS.find(([icon, , words]) => first.includes(icon) || first.toLowerCase().includes(words.toLowerCase()));
  }

  function box(m, bubble) {
    const c = m.check;
    const verdict = c.done === false ? null : verdictOf(c.text);
    const body = el("div", { class: "body" });
    body.innerHTML = renderMarkdown(c.text || "…");
    return el("div", { class: `double-check${verdict ? " " + verdict[1] : ""}` },
      el("div", { class: "head" },
        el("span", { class: "grow" }, c.done === false ? "🔍 Double-checking..." : "🔍 Double-check by the AI. It can be wrong too."),
        el("button", { "aria-label": "Hide check", title: "Hide check", onclick: () => {
          if (busy?.m === m) busy.abort();
          delete m.check;
          saveChats();
          bubble.querySelector(".double-check")?.remove();
        } }, "✕")),
      body);
  }

  function show(m, bubble) {
    const old = bubble.querySelector(".double-check");
    const fresh = box(m, bubble);
    if (old) old.replaceWith(fresh);
    else bubble.querySelector(".actions").before(fresh);
  }

  async function check(bubble) {
    const m = messageFor(bubble);
    if (!m || m.role !== "assistant") return;
    if (controller) return toast("Wait for the answer to finish first.");
    const model = currentModel();
    if (findModel(model)?.experimental) return toast("TinyGPT can't check answers. Pick a chat model in Models first.");
    busy?.abort();
    const ctl = new AbortController();
    busy = { m, abort: () => ctl.abort() };
    m.check = { text: "", done: false };
    show(m, bubble);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt(questionFor(m), m.content) }], think: false, auto_code: false }),
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
      let failed = null;
      await readLines(resp, (ev) => {
        if (ev.type === "text") {
          m.check.text += ev.text;
          bubble.querySelector(".double-check .body").innerHTML = renderMarkdown(m.check.text);
        }
        if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      if (!m.check.text.trim()) throw new Error("the AI didn't write anything. Try again, or try a bigger model.");
      m.check.text = m.check.text.trim();
      delete m.check.done;
      saveChats();
      show(m, bubble);
    } catch (err) {
      delete m.check;
      bubble.querySelector(".double-check")?.remove();
      if (err.name !== "AbortError") toast(`Couldn't double-check: ${err.message}`);
    } finally {
      if (busy?.m === m) busy = null;
    }
  }

  // Add the button (and any saved check) to answer bubbles each time the chat is drawn.
  function decorate() {
    if (controller) return; // the answer is still being written
    for (const bubble of messagesEl.querySelectorAll(":scope > .msg.assistant")) {
      const actions = bubble.querySelector(":scope > .actions");
      if (!actions || actions.querySelector(".check-answer")) continue;
      const m = messageFor(bubble);
      if (!m || m.role !== "assistant" || !m.content) continue;
      const button = el("button", { class: "check-answer", title: "Ask the AI to look for mistakes in this answer",
        onclick: () => check(bubble) }, "🔍 Double-check");
      const tag = actions.querySelector(".model-tag");
      if (tag) tag.before(button);
      else actions.append(button);
      if (m.check?.text && m.check.done !== false) show(m, bubble);
    }
  }

  new MutationObserver(decorate).observe(messagesEl, { childList: true });
  decorate();
})();
