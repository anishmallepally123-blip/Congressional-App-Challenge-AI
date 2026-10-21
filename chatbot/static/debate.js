// "⚖️ Debate practice": the student picks a topic and a side, the AI argues the other side for 3
// rounds, then scores the student's arguments out of 10 with one strong point and one tip.
// The last debate is kept in this browser so it can be picked up again.
(() => {
  const ROUNDS = 3;
  const SAVE_KEY = "local-ai-debate";
  const rules = (topic, side) => `Let's practice debating. The topic is: "${topic}". I am arguing ${side === "for" ? "FOR" : "AGAINST"} it, `
    + `so you argue ${side === "for" ? "AGAINST" : "FOR"} it. Rules: reply with one short paragraph of under 90 words, `
    + "make one main point per turn, answer what I just said, and stay respectful and friendly. No headings or lists. "
    + "Start now with your opening argument.";
  const FEEDBACK = "The debate is over. Stop arguing and give me feedback on MY arguments as a friendly debate coach. "
    + "Write exactly these three lines and nothing else:\nScore: N/10\nStrong point: one sentence on what I did well\n"
    + "Try next time: one sentence on how to make my arguments stronger";

  const style = document.createElement("style");
  style.textContent = `
    #debate-dialog { width: min(640px, calc(100vw - 32px)); }
    #debate-dialog[open] { display: flex; flex-direction: column; }
    #debate-dialog > * { flex-shrink: 0; }
    #debate-dialog label { display: block; margin: 14px 0 6px; font-weight: 600; }
    #debate-dialog input[type=text] { display: block; width: 100%; margin-top: 6px; font-weight: 400; padding: 9px 12px;
      border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); outline: none; }
    #debate-dialog .segmented { width: fit-content; }
    .debate-topic { margin: 6px 0 0; font-size: 0.9em; color: var(--muted); }
    #debate-dialog > .debate-log { flex-shrink: 1; }
    .debate-log { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; flex: 1 1 auto; min-height: 90px; overflow-y: auto; }
    .debate-bubble { max-width: 85%; padding: 10px 14px; border-radius: 14px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
    .debate-bubble small { display: block; font-size: 0.75em; font-weight: 650; opacity: 0.75; margin-bottom: 2px; }
    .debate-ai { align-self: flex-start; background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
    .debate-you { align-self: flex-end; background: var(--accent-soft); border-bottom-right-radius: 4px; }
    .debate-reply { display: flex; gap: 8px; align-items: flex-end; }
    .debate-reply textarea { flex: 1; min-width: 0; resize: vertical; padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); outline: none; }
    .debate-footer { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
    .debate-footer .debate-grow { flex: 1; }
    .debate-footer button { font-size: 0.9em; padding: 6px 12px; }
    .debate-card { margin: 12px 0 4px; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--accent); background: var(--card); }
    .debate-score { font-size: 1.6em; font-weight: 700; color: var(--accent); }
    .debate-card p { margin: 6px 0 0; }`;
  document.head.append(style);

  const link = el("button", { id: "debate-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "⚖️ Debate practice");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "debate-dialog", "aria-labelledby": "debate-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let debate = null; // { topic, side, history: [{role, content}], feedback }
  let busy = null;

  // Read "Score: 7/10", "Strong point: ..." and "Try next time: ..." lines, tolerating bold text and bullets.
  function parseFeedback(text) {
    const clean = text.replace(/\*\*|__/g, "");
    const line = (re) => (clean.match(re)?.[1] || "").trim() || null;
    const m = clean.match(/score\s*[:\-–]?\s*(\d{1,2}(?:\.\d)?)\s*(?:\/|out of)?\s*(?:10)?/i) || clean.match(/(\d{1,2}(?:\.\d)?)\s*(?:\/|out of)\s*10/i);
    const score = m && Number(m[1]) <= 10 ? Number(m[1]) : null;
    return { score, strong: line(/strong points?\s*[:\-–]\s*(.+)/i), next: line(/try next time\s*[:\-–]\s*(.+)/i) };
  }

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(debate)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } };
  const rounds = () => debate.history.filter((m, i) => i > 0 && m.role === "user").length;

  async function ask(messages, onText) {
    const model = currentModel();
    if (findModel(model)?.experimental) { busy = null; throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first."); }
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, think: false, auto_code: false }),
        signal: busy.signal,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
      let text = "";
      let failed = null;
      await readLines(resp, (ev) => {
        if (ev.type === "text") onText((text += ev.text));
        if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      return text.trim();
    } finally {
      busy = null;
    }
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "debate-title" }, "⚖️ Debate practice"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  const bubble = (m) => el("div", { class: `debate-bubble ${m.role === "user" ? "debate-you" : "debate-ai"}` },
    el("small", {}, m.role === "user" ? "You" : "AI"), m.content.replace(/\*\*/g, ""));

  function drawSetup() {
    let side = "for";
    const topic = el("input", { type: "text", placeholder: "e.g. Schools should have a four-day week", maxlength: "200" });
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Your side" });
    for (const [value, label] of [["for", "👍 For"], ["against", "👎 Against"]]) {
      seg.append(el("button", { type: "button", class: value === side ? "on" : "", onclick: (e) => {
        side = value;
        seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      } }, label));
    }
    const start = () => (topic.value.trim() ? begin(topic.value.trim(), side) : topic.focus());
    topic.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
    setDialog(head(),
      el("p", { class: "note" }, `Pick a side. The AI argues the other side for ${ROUNDS} rounds, then scores your arguments.`),
      el("label", {}, "Debate topic", topic),
      el("label", {}, "Your side"), seg,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: start }, "Start debate")));
    topic.focus();
  }

  function draw(note) {
    const log = el("div", { class: "debate-log" }, ...debate.history.slice(1).map(bubble));
    const done = !!debate.feedback;
    const fb = done ? parseFeedback(debate.feedback) : null;
    const card = fb && (fb.score != null || fb.strong || fb.next)
      ? el("div", { class: "debate-card" },
        fb.score != null ? el("div", { class: "debate-score" }, `${fb.score}/10`) : null,
        fb.strong ? el("p", {}, el("b", {}, "💪 Strong point: "), fb.strong) : null,
        fb.next ? el("p", {}, el("b", {}, "🎯 Try next time: "), fb.next) : null)
      : done ? el("div", { class: "debate-card" }, debate.feedback) : null;
    const input = el("textarea", { rows: "2", placeholder: "Make your argument...", "aria-label": "Your argument", disabled: !!busy });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); reply(input.value); } });
    const canReply = !done && !busy && debate.history.at(-1)?.role === "assistant";
    setDialog(head(),
      el("p", { class: "debate-topic" }, `Topic: ${debate.topic} · You are ${debate.side === "for" ? "for" : "against"} it · ${done ? "Finished" : `Round ${Math.min(rounds() + 1, ROUNDS)} of ${ROUNDS}`}`),
      log, card,
      note ? el("p", { class: "note" }, note) : null,
      canReply ? el("div", { class: "debate-reply" }, input, el("button", { class: "primary", onclick: () => reply(input.value) }, "Send")) : null,
      el("div", { class: "debate-footer" },
        !done && !busy && debate.history.at(-1)?.role === "user" ? el("button", { class: "primary", onclick: () => resume() }, "Try again") : null,
        !done && rounds() > 0 && !busy ? el("button", { onclick: () => finish() }, "Finish & get feedback") : null,
        el("span", { class: "debate-grow" }),
        el("button", { onclick: () => { busy?.abort(); debate = null; drawSetup(); } }, "New debate")));
    log.scrollTop = log.scrollHeight;
    if (canReply) input.focus();
    return log;
  }

  // Ask the AI for its next turn, showing its words as they arrive.
  async function turn(messages, onDone) {
    busy = new AbortController();
    const log = draw();
    const live = bubble({ role: "assistant", content: "Thinking..." });
    log.append(live);
    log.scrollTop = log.scrollHeight;
    try {
      const text = await ask(messages, (t) => { live.lastChild.textContent = t.replace(/\*\*/g, ""); log.scrollTop = log.scrollHeight; });
      onDone(text || "(no answer)");
      save();
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError" && dialog.open) draw(`Couldn't get an answer: ${err.message}`);
    }
  }

  function begin(topic, side) {
    debate = { topic, side, history: [{ role: "user", content: rules(topic, side) }], feedback: null };
    turn(debate.history, (text) => debate.history.push({ role: "assistant", content: text }));
  }

  function reply(text) {
    text = text.trim();
    if (!text || busy) return;
    debate.history.push({ role: "user", content: text });
    save();
    if (rounds() >= ROUNDS) return finish();
    turn(debate.history, (t) => debate.history.push({ role: "assistant", content: t }));
  }

  // After an error or closing mid-answer, ask again for whatever was missing.
  const resume = () => (rounds() >= ROUNDS ? finish() : turn(debate.history, (t) => debate.history.push({ role: "assistant", content: t })));

  function finish() {
    turn([...debate.history, { role: "user", content: FEEDBACK }], (t) => { debate.feedback = t; });
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    debate ||= loadSaved();
    if (debate?.history?.length > 1) draw(debate.feedback ? null : "Picking up your last debate.");
    else { debate = null; drawSetup(); }
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
