// "🏛️ Explain a bill": the student pastes the text or summary of a bill, law, ballot measure or
// school-board policy, and the AI on this computer explains it in plain language. It stays neutral:
// it gives both sides equally and never says what to think or how to vote.
// The last explanation is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_bill.py can run them with Node.
const BillExplainer = (() => {
  const MAX_CHARS = 8000;
  const LEVELS = {
    middle: "Write for a middle school student: short sentences and everyday words. Explain any legal word simply.",
    high: "Write for a high school student: clear, plain language. Explain legal or government words.",
  };
  const BALANCE_NOTE = "⚖️ One side has more points — ask the AI to balance it";

  const EXAMPLE = `LAKELAND STATE ASSEMBLY — BILL 214 (a made-up example)
Student Online Safety Act

Section 1. Purpose. This act aims to protect students from harmful online content and to reduce distractions during the school day.

Section 2. Phones in class. By August 1, each public school district shall adopt a policy that requires students in grades K–12 to keep personal phones turned off and put away during class time. Students may use phones at lunch and between classes unless the district decides otherwise.

Section 3. Exceptions. A student may use a phone in class if (a) a teacher allows it for a lesson, (b) it is needed for a medical condition, or (c) it is part of the student's individualized education program (IEP).

Section 4. School internet filters. Schools shall filter content on school Wi-Fi that is harmful to minors. Each school shall give students and teachers a way to ask for a blocked website to be reviewed within 5 school days.

Section 5. Funding. The state shall provide $2 per student each year for phone storage pouches, filters and staff training.

Section 6. Reporting. Each district shall report to the State Board of Education once a year on discipline related to this act.`;

  function buildPrompt(text, level, balance) {
    const system = "You explain bills, laws, ballot measures and school policies to students in plain language. "
      + "Be completely neutral. Use only the text the student pasted; do not add outside facts, news, names or guesses. "
      + "If something is unclear or missing, write \"The text doesn't say\". "
      + "Give supporters and critics the same number of points, and make them equally strong and fair. "
      + "Never say which side is right, never recommend a position, and never tell the student how to vote. "
      + (LEVELS[level] || LEVELS.high) + "\n"
      + "Answer in exactly this format and nothing else:\n"
      + "IN ONE SENTENCE: what it does, in one plain sentence\n"
      + "WHAT IT DOES:\n- one main change per line (2 to 6 lines)\n"
      + "WHO IT AFFECTS:\n- one group per line\n"
      + "SUPPORTERS MIGHT SAY:\n- 3 reasons someone might support it\n"
      + "CRITICS MIGHT SAY:\n- 3 reasons someone might oppose it\n"
      + "WORDS TO KNOW:\n- term: short definition (0 to 4 words from the text)\n"
      + "QUESTIONS TO ASK:\n- 2 or 3 questions the text leaves open";
    const extra = balance
      ? "\n\nLast time one side got more points than the other. This time give exactly 3 points for supporters and exactly 3 for critics, equally strong."
      : "";
    const user = `Explain this in plain language.${extra}\n\nTEXT:\n${String(text || "").slice(0, MAX_CHARS)}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // Which section a line starts. The separator decides whether a bullet is really a heading.
  const HEADS = [
    ["one", /^(?:in\s*one\s*sentence|one[-\s]*sentence\s*summary|summary)\b\s*([:\-–—]?)\s*(.*)$/i],
    ["does", /^what\s*(?:it|this|the\s*\w+)\s*does\b\s*([:\-–—]?)\s*(.*)$/i],
    ["affects", /^(?:who\s*(?:it|this|the\s*\w+)\s*affects|who\s*is\s*affected)\b\s*([:\-–—]?)\s*(.*)$/i],
    ["supporters", /^(?:supporters?(?:\s*(?:might|may|would|could)\s*say)?|arguments?\s*for)\b\s*([:\-–—]?)\s*(.*)$/i],
    ["critics", /^(?:(?:critics?|opponents?)(?:\s*(?:might|may|would|could)\s*say)?|arguments?\s*against)\b\s*([:\-–—]?)\s*(.*)$/i],
    ["terms", /^(?:words?\s*to\s*know|key\s*(?:terms|words)|vocabulary)\b\s*([:\-–—]?)\s*(.*)$/i],
    ["questions", /^questions?(?:\s*to\s*(?:ask|think\s*about))?\b\s*([:\-–—]?)\s*(.*)$/i],
  ];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const LISTS = { does: "does", affects: "affects", supporters: "supporters", critics: "critics", questions: "questions" };

  function parseBill(text) {
    const out = { oneSentence: "", does: [], affects: [], supporters: [], critics: [], terms: [], questions: [] };
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bulleted = BULLET.test(line);
      const bare = line.replace(BULLET, "");
      let head = null;
      for (const [name, re] of HEADS) {
        const m = bare.match(re);
        // "- Supporters say it helps" is a point, but "1. SUPPORTERS MIGHT SAY:" is a heading.
        if (m && !(bulleted && m[1] !== ":" && m[2])) { head = [name, m[2]]; break; }
      }
      if (head) {
        section = head[0];
        line = head[1].replace(/^[,;]\s*/, "").trim();
        if (!line) continue;
      }
      const isBullet = BULLET.test(line);
      const item = line.replace(BULLET, "").replace(/^\*\s*|\s*\*$/g, "").trim();
      if (!item || /^(?:none|n\/a)\.?$/i.test(item)) continue;
      if (section === "one") {
        if (isBullet && out.oneSentence) { section = "does"; out.does.push(item); } else out.oneSentence = out.oneSentence ? `${out.oneSentence} ${item}` : item;
      } else if (LISTS[section]) out[LISTS[section]].push(item);
      else if (section === "terms") {
        const m = item.match(/^(.{1,60}?)\s*(?::|\s[-–—]\s)\s*(.+)$/);
        if (m) out.terms.push({ term: m[1].replace(/^["'*]+|["'*]+$/g, "").trim(), definition: m[2].trim() });
        else if (out.terms.length) out.terms.at(-1).definition += ` ${item}`;
      }
    }
    return out;
  }

  const parsedOk = (r) => !!(r && (r.oneSentence || r.does.length || r.supporters.length || r.critics.length));

  function asText(r) {
    const lines = [];
    if (r.oneSentence) lines.push(`In one sentence: ${r.oneSentence}`);
    const list = (title, items) => { if (items.length) lines.push("", `${title}:`, ...items.map((x) => `- ${x}`)); };
    list("What it does", r.does);
    list("Who it affects", r.affects);
    list("Supporters might say", r.supporters);
    list("Critics might say", r.critics);
    list("Words to know", r.terms.map((t) => `${t.term}: ${t.definition}`));
    list("Questions to ask", r.questions);
    return lines.join("\n").trim();
  }

  // A small nudge when one side got noticeably more points than the other.
  const balanceNote = (r) => (r && Math.abs(r.supporters.length - r.critics.length) >= 2 ? BALANCE_NOTE : "");

  return { MAX_CHARS, LEVELS, EXAMPLE, BALANCE_NOTE, buildPrompt, parseBill, parsedOk, asText, balanceNote };
})();
if (typeof module !== "undefined") module.exports = BillExplainer;

if (typeof document !== "undefined") (() => {
  const { MAX_CHARS, EXAMPLE, buildPrompt, parseBill, parsedOk, asText, balanceNote } = BillExplainer;
  const SAVE_KEY = "local-ai-bill";
  const fmt = (n) => n.toLocaleString("en-US");

  const style = document.createElement("style");
  style.textContent = `
    #bill-dialog { width: min(760px, calc(100vw - 32px)); }
    #bill-dialog label.bill-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #bill-dialog textarea { display: block; width: 100%; margin-top: 6px; min-height: 220px; max-height: 50vh; resize: vertical;
      font: inherit; font-weight: 400; line-height: 1.5; padding: 10px 12px; border: 1px solid var(--border-strong);
      border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #bill-dialog textarea:focus { border-color: var(--accent); }
    .bill-under { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; align-items: center; margin-top: 4px; font-weight: 400; }
    .bill-count { font-size: 0.8em; color: var(--muted); margin-left: auto; }
    .bill-count.bill-full { color: var(--accent); font-weight: 600; }
    #bill-dialog .bill-linkbtn { border: none; background: none; padding: 2px 0; color: var(--accent); font: inherit; font-size: 0.9em;
      font-weight: 550; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left; }
    #bill-dialog .bill-linkbtn:hover { color: var(--accent-hover); background: none; }
    .bill-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 12px; }
    .bill-row > span { font-weight: 600; }
    .bill-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .bill-reading { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .bill-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: bill-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes bill-spin { to { transform: rotate(360deg); } }
    .bill-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .bill-one { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.5; font-size: 1.05em; overflow-wrap: anywhere; }
    .bill-label { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--accent); margin-bottom: 6px; }
    .bill-card { margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); min-width: 0; }
    .bill-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .bill-sides .bill-card { margin: 0; }
    .bill-for { border-top: 4px solid var(--fast); background: color-mix(in srgb, var(--fast) 7%, var(--card)); }
    .bill-for .bill-label { color: color-mix(in srgb, var(--fast) 65%, var(--text)); }
    .bill-against { border-top: 4px solid var(--slow); background: color-mix(in srgb, var(--slow) 8%, var(--card)); }
    .bill-against .bill-label { color: color-mix(in srgb, var(--slow) 65%, var(--text)); }
    @media (max-width: 600px) { .bill-sides { grid-template-columns: 1fr; } }
    .bill-list { margin: 0; padding-left: 20px; line-height: 1.55; }
    .bill-list li { margin: 4px 0; overflow-wrap: anywhere; }
    .bill-terms { list-style: none; padding-left: 0; }
    .bill-terms b { color: var(--text); }
    .bill-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .bill-balance { margin: 12px 0 0; }
    .bill-disclaimer { margin: 14px 0 0; font-size: 0.85em; color: var(--muted); line-height: 1.45; }
    .bill-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; align-items: center; }
    .bill-buttons .bill-grow { flex: 1; }
    #bill-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "bill-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🏛️ Explain a bill");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "bill-dialog", "aria-labelledby": "bill-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is reading
  // draft: what is in the text box; last: the last explanation; view: what to show on reopen.
  let state = { draft: { text: "", level: "high" }, last: null, view: "setup" };

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d !== "object") return;
      const draft = d.draft && typeof d.draft.text === "string" ? { text: d.draft.text.slice(0, MAX_CHARS), level: d.draft.level === "middle" ? "middle" : "high" } : state.draft;
      const last = d.last && typeof d.last.reply === "string" && d.last.reply.trim() ? d.last : null;
      state = { draft, last, view: d.view === "result" && last ? "result" : "setup" };
    } catch { /* nothing saved */ }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "bill-title" }, "🏛️ Explain a bill"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawSetup(message) {
    state.view = "setup";
    save();
    const area = el("textarea", { id: "bill-text", maxlength: String(MAX_CHARS), "aria-label": "Bill or policy text",
      placeholder: "Paste the text or summary of a bill, law, ballot measure or school-board policy here..." });
    area.value = state.draft.text;
    const count = el("span", { class: "bill-count", "aria-live": "polite" });
    const update = () => {
      state.draft.text = area.value;
      count.textContent = `${fmt(area.value.length)} / ${fmt(MAX_CHARS)} characters`;
      count.classList.toggle("bill-full", area.value.length >= MAX_CHARS);
    };
    area.addEventListener("input", () => { update(); save(); });
    update();
    const example = el("button", { type: "button", class: "bill-linkbtn", onclick: () => { area.value = EXAMPLE; update(); save(); dialog.querySelector(".bill-msg")?.remove(); area.focus(); } }, "Try an example");
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Reading level" });
    for (const [value, label] of [["middle", "Middle school"], ["high", "High school"]]) {
      seg.append(el("button", { type: "button", class: value === state.draft.level ? "on" : "", "aria-pressed": String(value === state.draft.level), onclick: (e) => {
        state.draft.level = value;
        save();
        seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
      } }, label));
    }
    const go = () => (area.value.trim() ? explain(area.value.trim(), state.draft.level, false) : drawSetup("Paste the text of a bill or policy first, or press Try an example."));
    setDialog(head(),
      el("p", { class: "note" }, `Paste up to ${fmt(MAX_CHARS)} characters. The AI on this computer explains what it does, who it affects and what both sides might say. It won't tell you what to think.`),
      el("label", { class: "bill-field" }, "The bill or policy", area, el("div", { class: "bill-under" }, example, count)),
      el("div", { class: "bill-row" }, el("span", {}, "Reading level"), seg),
      message ? el("p", { class: "bill-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Explain it")));
    area.focus();
  }

  function drawReading(live) {
    setDialog(head(),
      el("div", { class: "bill-reading" }, el("span", { class: "bill-spin", "aria-hidden": "true" }), "Reading the bill…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  const card = (title, items, extraClass) => (items.length
    ? el("div", { class: `bill-card${extraClass ? ` ${extraClass}` : ""}` }, el("span", { class: "bill-label" }, title),
      el("ul", { class: "bill-list" }, ...items.map((x) => el("li", {}, x))))
    : null);

  function drawResult(data) {
    state.view = "result";
    save();
    const r = parseBill(data.reply);
    const ok = parsedOk(r);
    const plain = ok ? asText(r) : data.reply.trim();
    const note = ok ? balanceNote(r) : "";
    const sides = ok && (r.supporters.length || r.critics.length)
      ? el("div", { class: "bill-sides" },
        card("Supporters might say", r.supporters.length ? r.supporters : ["The AI didn't list any."], "bill-for"),
        card("Critics might say", r.critics.length ? r.critics : ["The AI didn't list any."], "bill-against"))
      : null;
    setDialog(head(),
      ok && r.oneSentence ? el("div", { class: "bill-one" }, el("span", { class: "bill-label" }, "In one sentence"), r.oneSentence) : null,
      ok ? card("What it does", r.does) : null,
      ok ? card("Who it affects", r.affects) : null,
      sides,
      note ? el("p", { class: "bill-balance" }, el("button", { type: "button", class: "bill-linkbtn", onclick: () => explain(data.text, data.level, true) }, note)) : null,
      ok && r.terms.length ? el("div", { class: "bill-card" }, el("span", { class: "bill-label" }, "Words to know"),
        el("ul", { class: "bill-list bill-terms" }, ...r.terms.map((t) => el("li", {}, el("b", {}, t.term), ` — ${t.definition}`)))) : null,
      ok ? card("Questions to ask", r.questions) : null,
      ok ? null : el("p", { class: "bill-raw" }, plain || "(no answer)"),
      el("p", { class: "bill-disclaimer" }, "This explains the text you pasted. It isn't legal advice, and it doesn't tell you what to think."),
      el("div", { class: "bill-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy"),
        el("button", { onclick: () => ask(ok && r.oneSentence ? r.oneSentence : plain.split("\n")[0]) }, "💬 Ask a question"),
        el("span", { class: "bill-grow" }),
        el("button", { onclick: () => { state.draft = { text: data.text || "", level: data.level || "high" }; drawSetup(); } }, "Edit text"),
        el("button", { class: "primary", onclick: () => { state.draft = { text: "", level: data.level || "high" }; drawSetup(); } }, "New bill")));
  }

  function ask(summary) {
    dialog.close();
    $("new-chat").click();
    inputEl.value = `I have a question about this bill: ${summary}`;
    autoResize();
    inputEl.focus();
  }

  async function explain(text, level, balance) {
    const model = currentModel();
    state.draft = { text, level };
    if (findModel(model)?.experimental) return drawSetup("TinyGPT is a tiny practice model and can't explain a bill. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "bill-live" }, "Waiting for the AI...");
    drawReading(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(text, level, balance), think: false, auto_code: false }),
        signal: busy.signal,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
      let reply = "";
      let failed = null;
      await readLines(resp, (ev) => {
        if (ev.type === "text") { reply += ev.text; live.textContent = reply; live.scrollTop = live.scrollHeight; }
        if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      if (!reply.trim()) throw new Error("the AI sent an empty answer");
      state.last = { text, level, reply: reply.trim(), at: Date.now() };
      save();
      if (dialog.open) drawResult(state.last);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Explain it to try again.");
      else drawSetup(`Couldn't explain it: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    load();
    dialog.showModal();
    if (state.view === "result" && state.last) drawResult(state.last);
    else drawSetup();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
