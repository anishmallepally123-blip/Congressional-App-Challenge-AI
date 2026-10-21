// "📝 Summarize a reading": the student pastes an article or textbook section and the AI turns it
// into study notes: the main idea, key points, words to know and one question to think about.
// The last summary is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_summary.py can run them with Node.
const ReadingSummary = (() => {
  const MAX_CHARS = 6000;
  const LENGTHS = { short: 3, medium: 5, detailed: 8 };

  const countWords = (text) => (String(text || "").match(/\S+/g) || []).length;

  function buildPrompt(text, length) {
    const n = LENGTHS[length] || LENGTHS.medium;
    const system = "You turn readings into clear study notes for a student. Use simple words and only facts from the reading. "
      + "Answer in exactly this format and nothing else:\n"
      + "MAIN IDEA: one sentence\n"
      + "KEY POINTS:\n"
      + `- point (write exactly ${n} points, one short sentence each)\n`
      + "WORDS TO KNOW:\n"
      + "- term: short definition (0 to 4 important words from the reading)\n"
      + "THINK ABOUT: one question that makes the student think about the reading";
    const user = `Summarize this reading with ${n} key points.\n\nREADING:\n${String(text).slice(0, MAX_CHARS)}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // Which section a line starts, and any text after its colon on the same line.
  const HEADS = [
    ["main", /^main\s*idea\b\s*[:\-–]?\s*(.*)$/i],
    ["points", /^(?:key\s*points?|main\s*points?)\b\s*[:\-–]?\s*(.*)$/i],
    ["terms", /^(?:words?\s*to\s*know|key\s*(?:terms|words)|vocabulary)\b\s*[:\-–]?\s*(.*)$/i],
    ["question", /^(?:think\s*about(?:\s*this)?|question)\b\s*[:\-–]?\s*(.*)$/i],
  ];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;

  function parseSummary(text) {
    const out = { mainIdea: "", points: [], terms: [], question: "" };
    let section = null;
    for (let raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const head = HEADS.find(([, re]) => re.test(line.replace(BULLET, "")));
      if (head) {
        section = head[0];
        line = line.replace(BULLET, "").match(head[1])[1].trim();
        if (!line) continue;
      }
      const isBullet = BULLET.test(line);
      const item = line.replace(BULLET, "").replace(/^\*\s*|\s*\*$/g, "").trim();
      if (!item || /^(?:none|n\/a)\.?$/i.test(item)) continue;
      if (section === "main") {
        if (isBullet && out.mainIdea) { section = "points"; out.points.push(item); } else out.mainIdea = out.mainIdea ? `${out.mainIdea} ${item}` : item;
      } else if (section === "points") out.points.push(item);
      else if (section === "terms") {
        const m = item.match(/^(.{1,60}?)\s*(?::|\s[-–—]\s)\s*(.+)$/);
        if (m) out.terms.push({ term: m[1].replace(/^["']|["']$/g, "").trim(), definition: m[2].trim() });
        else if (out.terms.length) out.terms.at(-1).definition += ` ${item}`;
      } else if (section === "question") out.question = out.question ? `${out.question} ${item}` : item;
    }
    out.question = out.question.replace(/^\*|\*$/g, "").trim();
    return out;
  }

  const parsedOk = (s) => !!(s && (s.mainIdea || s.points.length));

  function asText(s) {
    const lines = [];
    if (s.mainIdea) lines.push(`Main idea: ${s.mainIdea}`);
    if (s.points.length) lines.push("", "Key points:", ...s.points.map((p) => `- ${p}`));
    if (s.terms.length) lines.push("", "Words to know:", ...s.terms.map((t) => `- ${t.term}: ${t.definition}`));
    if (s.question) lines.push("", `Think about: ${s.question}`);
    return lines.join("\n").trim();
  }

  return { MAX_CHARS, LENGTHS, countWords, buildPrompt, parseSummary, parsedOk, asText };
})();
if (typeof module !== "undefined") module.exports = ReadingSummary;

if (typeof document !== "undefined") (() => {
  const { MAX_CHARS, countWords, buildPrompt, parseSummary, parsedOk, asText } = ReadingSummary;
  const SAVE_KEY = "local-ai-summary";
  const fmt = (n) => n.toLocaleString("en-US");

  const style = document.createElement("style");
  style.textContent = `
    #summary-dialog { width: min(680px, calc(100vw - 32px)); }
    #summary-dialog label.summary-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #summary-dialog textarea { display: block; width: 100%; margin-top: 6px; min-height: 220px; max-height: 50vh; resize: vertical;
      font: inherit; font-weight: 400; line-height: 1.5; padding: 10px 12px; border: 1px solid var(--border-strong);
      border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #summary-dialog textarea:focus { border-color: var(--accent); }
    .summary-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .summary-count.summary-full { color: var(--accent); font-weight: 600; }
    .summary-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 12px; }
    .summary-row > span { font-weight: 600; }
    .summary-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .summary-reading { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .summary-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: summary-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes summary-spin { to { transform: rotate(360deg); } }
    .summary-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .summary-stat { margin: 6px 0 0; font-size: 0.85em; color: var(--muted); }
    .summary-main { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.5; }
    .summary-main small, .summary-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .summary-sec { margin: 18px 0 6px; }
    .summary-list { margin: 0; padding-left: 22px; line-height: 1.55; }
    .summary-list li { margin: 4px 0; overflow-wrap: anywhere; }
    .summary-terms { list-style: none; padding-left: 0; }
    .summary-terms b { color: var(--text); }
    .summary-question { margin: 0; font-style: italic; line-height: 1.5; }
    .summary-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .summary-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .summary-buttons .summary-grow { flex: 1; }
    #summary-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "summary-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📝 Summarize a reading");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "summary-dialog", "aria-labelledby": "summary-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is reading
  let draft = { text: "", length: "medium" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && typeof d.reply === "string" ? d : null; } catch { return null; } };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "summary-title" }, "📝 Summarize a reading"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    const area = el("textarea", { maxlength: String(MAX_CHARS), placeholder: "Paste an article, a textbook section or your notes here...", "aria-label": "Reading to summarize" });
    area.value = draft.text.slice(0, MAX_CHARS);
    const count = el("span", { class: "summary-count", "aria-live": "polite" });
    const update = () => {
      draft.text = area.value;
      count.textContent = `${fmt(area.value.length)} / ${fmt(MAX_CHARS)} characters · ${fmt(countWords(area.value))} words`;
      count.classList.toggle("summary-full", area.value.length >= MAX_CHARS);
    };
    area.addEventListener("input", update);
    update();
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Summary length" });
    for (const [value, label] of [["short", "Short"], ["medium", "Medium"], ["detailed", "Detailed"]]) {
      seg.append(el("button", { type: "button", class: value === draft.length ? "on" : "", "aria-pressed": String(value === draft.length), onclick: (e) => {
        draft.length = value;
        seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
      } }, label));
    }
    const go = () => (area.value.trim() ? summarize(area.value.trim(), draft.length) : (drawInput("Paste a reading first."), null));
    setDialog(head(),
      el("p", { class: "note" }, `Paste up to ${fmt(MAX_CHARS)} characters. The AI on this computer writes study notes: the main idea, key points, words to know and a question.`),
      el("label", { class: "summary-field" }, "Your reading", area, count),
      el("div", { class: "summary-row" }, el("span", {}, "Length"), seg),
      message ? el("p", { class: "summary-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Summarize")));
    area.focus();
  }

  function drawReading(live) {
    setDialog(head(),
      el("div", { class: "summary-reading" }, el("span", { class: "summary-spin", "aria-hidden": "true" }), "Reading…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function drawResult(data) {
    const s = parseSummary(data.reply);
    const ok = parsedOk(s);
    const plain = ok ? asText(s) : data.reply.trim();
    const outWords = ok ? countWords([s.mainIdea, ...s.points, ...s.terms.map((t) => `${t.term} ${t.definition}`), s.question].join(" ")) : countWords(plain);
    const copy = el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy");
    setDialog(head(),
      el("p", { class: "summary-stat" }, `${fmt(data.words || 0)} words → ${fmt(outWords)} words`),
      ok && s.mainIdea ? el("div", { class: "summary-main" }, el("small", {}, "Main idea"), s.mainIdea) : null,
      ok && s.points.length ? el("span", { class: "summary-sec" }, "Key points") : null,
      ok && s.points.length ? el("ul", { class: "summary-list" }, ...s.points.map((p) => el("li", {}, p))) : null,
      ok && s.terms.length ? el("span", { class: "summary-sec" }, "Words to know") : null,
      ok && s.terms.length ? el("ul", { class: "summary-list summary-terms" }, ...s.terms.map((t) => el("li", {}, el("b", {}, t.term), ` — ${t.definition}`))) : null,
      ok && s.question ? el("span", { class: "summary-sec" }, "Think about") : null,
      ok && s.question ? el("p", { class: "summary-question" }, s.question) : null,
      ok ? null : el("p", { class: "summary-raw" }, plain || "(no answer)"),
      el("div", { class: "summary-buttons" },
        copy,
        el("button", { onclick: () => ask(ok && s.mainIdea ? s.mainIdea : plain.split("\n")[0]) }, "💬 Ask about it"),
        el("span", { class: "summary-grow" }),
        el("button", { onclick: () => { draft = { text: data.text || "", length: data.length || "medium" }; drawInput(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { draft = { text: "", length: data.length || "medium" }; drawInput(); } }, "New reading")));
  }

  function ask(mainIdea) {
    dialog.close();
    $("new-chat").click();
    inputEl.value = `Help me understand this reading: ${mainIdea}`;
    autoResize();
    inputEl.focus();
  }

  async function summarize(text, length) {
    const model = currentModel();
    if (findModel(model)?.experimental) return drawInput("TinyGPT is a tiny practice model and can't summarize. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "summary-live" }, "Waiting for the AI...");
    drawReading(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(text, length), think: false, auto_code: false }),
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
      const data = { text, length, words: countWords(text), reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press Summarize to try again.");
      else drawInput(`Couldn't summarize: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) drawResult(saved);
    else drawInput();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
