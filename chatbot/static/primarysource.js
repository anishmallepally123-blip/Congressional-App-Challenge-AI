// "📜 Primary source analyzer": a history student pastes a primary source (a speech, a letter,
// a law...) and the AI on this computer fills in a SOAPSTone card: Speaker, Occasion, Audience,
// Purpose, Subject, Tone, a key quote and two questions to think about.
// The key quote is checked against the pasted text and highlighted there; a quote the AI
// made up is marked "not found in the text". The last result is kept in this browser.

// Pure helpers (no page needed), so test_primarysource.py can run them with Node.
const LocalAIPrimarySource = (() => {
  const MAX_TEXT = 6000;
  const MAX_META = 120;
  const MAX_FIELD = 300;
  const MAX_QUESTIONS = 2;
  const FIELDS = [
    ["speaker", "Speaker"], ["occasion", "Occasion"], ["audience", "Audience"],
    ["purpose", "Purpose"], ["subject", "Subject"], ["tone", "Tone"],
  ];

  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  // The pasted text with spacing tidied; very long text is cut so a small model can read it.
  function prepareText(text) {
    const tidy = String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (tidy.length <= MAX_TEXT) return { text: tidy, truncated: false, length: tidy.length };
    let cut = tidy.slice(0, MAX_TEXT);
    const space = cut.lastIndexOf(" ");
    if (space > MAX_TEXT - 200) cut = cut.slice(0, space);
    return { text: cut.trim(), truncated: true, length: tidy.length };
  }

  function buildPrompt(text, meta = {}) {
    const src = prepareText(text).text;
    const system = "You help a history student analyze a primary source with SOAPSTone. Use simple words. "
      + "Base every answer on the text and on well-known facts; if something is not known, say \"Not stated\". Keep each answer to one or two short sentences.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "SPEAKER: who wrote or said it and what we know about them\n"
      + "OCCASION: the time, place and events around it\n"
      + "AUDIENCE: who it was meant for\n"
      + "PURPOSE: what the speaker wanted to achieve\n"
      + "SUBJECT: what it is about\n"
      + "TONE: the speaker's attitude, with one or two describing words\n"
      + "KEY QUOTE: one short sentence copied word for word from the text\n"
      + "QUESTIONS:\n- a question for the student to think about\n- a second question";
    const head = [["Title", meta.title], ["Author", meta.author], ["Date", meta.date]]
      .map(([k, v]) => [k, clean(v, MAX_META)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const user = [...head, `${head.length ? "\n" : ""}Primary source text:\n"""\n${src}\n"""`].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const LABEL = /^(speaker|author|occasion|context|audience|purpose|subject|topic|tone|key\s+quote|quote|questions?(?:\s+to\s+think\s+about)?)\s*(?:\([^)]{0,40}\))?\s*(?::|\s[-–]\s)\s*(.*)$/i;
  const ALIAS = { author: "speaker", context: "occasion", topic: "subject" };
  const stripQuotes = (s) => s.trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  const isNone = (s) => /^(?:none|n\/a|nothing|not stated|unknown)\.?$/i.test(s.trim());

  function parse(text) {
    const out = { speaker: "", occasion: "", audience: "", purpose: "", subject: "", tone: "", quote: "", questions: [] };
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bare = line.replace(BULLET, "");
      const m = bare.match(LABEL);
      if (m) {
        const name = m[1].toLowerCase().replace(/\s+/g, " ");
        section = name.startsWith("question") ? "questions" : name.endsWith("quote") ? "quote" : (ALIAS[name] || name);
        line = m[2].trim();
        if (!line) continue;
      } else line = bare;
      line = line.replace(/^\*+|\*+$/g, "").trim();
      if (!line || !section) continue;
      if (section === "questions") {
        const q = clean(line, MAX_FIELD);
        if (!isNone(q) && out.questions.length < MAX_QUESTIONS && !out.questions.includes(q)) out.questions.push(q);
      } else if (section === "quote") {
        // Keep only what's inside the quote marks (models like to add "— Lincoln").
        const inside = line.match(/^["“](.+?)["”](?:\s|$|[-–—,(])/);
        const q = clean(inside ? inside[1] : stripQuotes(line), MAX_FIELD);
        if (!out.quote && !isNone(q)) out.quote = q;
      } else if (!isNone(line)) out[section] = clean(out[section] ? `${out[section]} ${line}` : line, MAX_FIELD);
    }
    return out;
  }

  // At least half the SOAPSTone parts must be there to draw the card.
  const parsedOk = (r) => !!r && FIELDS.filter(([k]) => r[k]).length >= 3;

  // Lowercase, straight quotes and dashes, single spaces; keeps where each character came from.
  function normalize(text) {
    let out = "";
    const at = [];
    let space = false;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      let c = s[i];
      if (/\s/.test(c)) { if (out && !space) { out += " "; at.push(i); } space = true; continue; }
      space = false;
      c = c.replace(/[“”„″]/, '"').replace(/[‘’‚′`]/, "'").replace(/[–—]/, "-").toLowerCase();
      out += c;
      at.push(i);
    }
    if (out.endsWith(" ")) { out = out.slice(0, -1); at.pop(); }
    return { out, at };
  }

  // Where the quote sits in the source as [start, end], or null when it isn't there.
  // "..." inside a quote means words were skipped, so each piece must appear in order.
  function findQuote(quote, source) {
    const parts = stripQuotes(String(quote || "")).split(/\.\.\.|…/)
      .map((p) => normalize(p).out.replace(/^[\s.,;:!?"']+|[\s.,;:!?"']+$/g, ""))
      .filter(Boolean);
    if (!parts.length || isNone(parts.join(" "))) return null;
    const w = normalize(source);
    let from = 0;
    let start = -1;
    let end = -1;
    for (const p of parts) {
      const i = w.out.indexOf(p, from);
      if (i < 0) return null;
      if (start < 0) start = i;
      end = i + p.length;
      from = end;
    }
    return [w.at[start], w.at[end - 1] + 1];
  }

  const checkQuote = (quote, source) => findQuote(quote, source) != null;

  function toPlainText(r, meta = {}, source = "") {
    const about = [clean(meta.author, MAX_META), clean(meta.date, MAX_META)].filter(Boolean).join(", ");
    const lines = [`Primary source analysis: ${clean(meta.title, MAX_META) || "Untitled source"}` + (about ? ` (${about})` : "")];
    lines.push("");
    for (const [k, label] of FIELDS) lines.push(`${label}: ${r[k] || "Not stated"}`);
    if (r.quote) lines.push("", `Key quote: "${r.quote}"` + (checkQuote(r.quote, source) ? "" : " (not found in the text)"));
    if (r.questions.length) lines.push("", "Questions to think about:", ...r.questions.map((q, i) => `${i + 1}. ${q}`));
    return lines.join("\n");
  }

  return { MAX_TEXT, MAX_META, MAX_QUESTIONS, FIELDS, prepareText, buildPrompt, parse, parsedOk, findQuote, checkQuote, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAIPrimarySource = LocalAIPrimarySource;
if (typeof module !== "undefined") module.exports = LocalAIPrimarySource;

if (typeof document !== "undefined") (() => {
  const { MAX_TEXT, MAX_META, FIELDS, prepareText, buildPrompt, parse, parsedOk, findQuote, toPlainText } = LocalAIPrimarySource;
  const SAVE_KEY = "local-ai-primary-source";
  const fmt = (n) => n.toLocaleString("en-US");
  const ICONS = { speaker: "🗣️", occasion: "📅", audience: "👥", purpose: "🎯", subject: "📌", tone: "🎭" };
  const EXAMPLE = {
    title: "The Gettysburg Address", author: "Abraham Lincoln", date: "November 19, 1863",
    text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, "
      + "and dedicated to the proposition that all men are created equal.\n\nNow we are engaged in a great civil war, testing whether that nation, "
      + "or any nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate "
      + "a portion of that field, as a final resting place for those who here gave their lives that that nation might live. "
      + "It is altogether fitting and proper that we should do this.",
  };

  const style = document.createElement("style");
  style.textContent = `
    #primary-source-dialog { width: min(900px, calc(100vw - 32px)); }
    .ps-field { display: block; font-weight: 600; margin-top: 12px; min-width: 0; }
    .ps-field small { font-weight: 400; color: var(--muted); }
    .ps-field input, .ps-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .ps-field textarea { resize: vertical; line-height: 1.5; min-height: 150px; }
    .ps-field input:focus, .ps-field textarea:focus { border-color: var(--accent); }
    .ps-meta { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); gap: 0 10px; }
    .ps-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .ps-count.ps-over { color: var(--slow); font-weight: 600; }
    .ps-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .ps-examples button { font-size: 0.95em; padding: 4px 10px; border-radius: 999px; }
    .ps-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .ps-working { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .ps-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: ps-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes ps-spin { to { transform: rotate(360deg); } }
    .ps-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .ps-title { margin: 4px 0 0; font-weight: 700; font-size: 1.05em; overflow-wrap: anywhere; }
    .ps-title small { display: block; font-weight: 400; font-size: 0.85em; color: var(--muted); margin-top: 2px; }
    .ps-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
    .ps-card { padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--card);
      line-height: 1.4; font-size: 0.93em; overflow-wrap: anywhere; min-width: 0; }
    .ps-card.ps-empty { color: var(--muted); font-style: italic; }
    .ps-label { display: block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent);
      margin-bottom: 4px; font-style: normal; }
    .ps-quote { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.5; overflow-wrap: anywhere; }
    .ps-quote blockquote { margin: 0; font-size: 1.05em; font-style: italic; }
    .ps-check { display: inline-block; margin-top: 6px; font-size: 0.82em; font-weight: 600; color: var(--fast); }
    .ps-check.ps-missing { color: var(--slow); }
    .ps-questions { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; border: 1.5px dashed var(--border-strong); line-height: 1.5; overflow-wrap: anywhere; }
    .ps-questions ol { margin: 0; padding-left: 1.4em; }
    .ps-questions li + li { margin-top: 4px; }
    .ps-source-head { margin: 18px 0 6px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
    .ps-source { max-height: 240px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; margin: 0;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.92em; }
    .ps-source mark { background: color-mix(in srgb, #f5c542 55%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
    .ps-note { margin: 6px 0 0; font-size: 0.82em; color: var(--muted); }
    .ps-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .ps-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .ps-buttons .ps-grow { flex: 1; }
    #primary-source-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 640px) {
      .ps-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
      .ps-meta { grid-template-columns: minmax(0, 1fr); }
    }`;
  document.head.append(style);

  const link = el("button", { id: "primary-source-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📜 Primary source analyzer");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "primary-source-dialog", "aria-labelledby": "primary-source-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  let draft = { text: "", title: "", author: "", date: "" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && typeof d.reply === "string" && typeof d.text === "string" && d.text ? d : null; } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "primary-source-title" }, "📜 Primary source analyzer"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    const input = (key, placeholder) => {
      const i = el("input", { type: "text", maxlength: String(MAX_META), placeholder, autocomplete: "off" });
      i.value = draft[key];
      i.addEventListener("input", () => { draft[key] = i.value; });
      return i;
    };
    const area = el("textarea", { rows: "8", placeholder: "Paste a speech, letter, law or other document here…" });
    area.value = draft.text;
    const count = el("span", { class: "ps-count", "aria-live": "polite" });
    const recount = () => {
      const n = area.value.trim().length;
      count.className = n > MAX_TEXT ? "ps-count ps-over" : "ps-count";
      count.textContent = n > MAX_TEXT ? `${fmt(n)} characters: only the first ${fmt(MAX_TEXT)} will be read` : `${fmt(n)} / ${fmt(MAX_TEXT)} characters`;
    };
    area.addEventListener("input", () => { draft.text = area.value; recount(); });
    recount();
    const inTitle = input("title", "e.g. The Gettysburg Address");
    const inAuthor = input("author", "e.g. Abraham Lincoln");
    const inDate = input("date", "e.g. 1863");
    const go = () => {
      if (!area.value.trim()) return drawInput("Paste the text of a primary source first.");
      if (area.value.trim().split(/\s+/).length < 8) return drawInput("That's very short. Paste at least a sentence or two of the source.");
      run({ text: area.value, title: inTitle.value.trim(), author: inAuthor.value.trim(), date: inDate.value.trim() });
    };
    setDialog(head(),
      el("p", { class: "note" }, "Paste part of a primary source. The AI on this computer fills in a SOAPSTone analysis: who is speaking, when and why, to whom, about what, and in what tone."),
      el("label", { class: "ps-field" }, "Primary source text", area, count),
      el("div", { class: "ps-meta" },
        el("label", { class: "ps-field" }, "Title ", el("small", {}, "(optional)"), inTitle),
        el("label", { class: "ps-field" }, "Author ", el("small", {}, "(optional)"), inAuthor),
        el("label", { class: "ps-field" }, "Date ", el("small", {}, "(optional)"), inDate)),
      el("div", { class: "ps-examples" }, "Try:",
        el("button", { type: "button", onclick: () => { draft = { ...EXAMPLE }; drawInput(); } }, EXAMPLE.title)),
      message ? el("p", { class: "ps-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Analyze the source")));
    area.focus();
  }

  function drawWorking(live) {
    setDialog(head(),
      el("div", { class: "ps-working" }, el("span", { class: "ps-spin", "aria-hidden": "true" }), "Reading the source…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  // The source text with the key quote wrapped in <mark>, built from text nodes only.
  function sourceBox(text, span) {
    const box = el("p", { class: "ps-source", tabindex: "0", "aria-label": "Original text" });
    if (!span) box.append(text);
    else box.append(text.slice(0, span[0]), el("mark", {}, text.slice(span[0], span[1])), text.slice(span[1]));
    return box;
  }

  function drawResult(data) {
    const r = parse(data.reply);
    const ok = parsedOk(r);
    const span = ok && r.quote ? findQuote(r.quote, data.text) : null;
    const meta = { title: data.title, author: data.author, date: data.date };
    const plain = ok ? toPlainText(r, meta, data.text) : data.reply.trim();
    const about = [data.author, data.date].filter(Boolean).join(" · ");
    const source = sourceBox(data.text, span);
    setDialog(head(),
      el("p", { class: "ps-title" }, data.title || "Your primary source", about ? el("small", {}, about) : null),
      ok ? el("div", { class: "ps-grid", role: "list", "aria-label": "SOAPSTone analysis" },
        ...FIELDS.map(([k, label]) => el("div", { class: r[k] ? "ps-card" : "ps-card ps-empty", role: "listitem" },
          el("span", { class: "ps-label" }, `${ICONS[k]} ${label}`), r[k] || "Not stated"))) : null,
      ok && r.quote ? el("div", { class: "ps-quote" },
        el("span", { class: "ps-label" }, "💬 Key quote"),
        el("blockquote", {}, `“${r.quote}”`),
        span ? el("span", { class: "ps-check" }, "✓ Found in the text (highlighted below)")
          : el("span", { class: "ps-check ps-missing" }, "⚠ Not found in the text. The AI may have changed the words, so check before you use it.")) : null,
      ok && r.questions.length ? el("div", { class: "ps-questions" },
        el("span", { class: "ps-label" }, "🤔 Questions to think about"),
        el("ol", {}, ...r.questions.map((q) => el("li", {}, q)))) : null,
      ok ? null : el("p", { class: "ps-raw" }, plain || "(no answer)"),
      el("div", { class: "ps-source-head" }, "Original text"),
      source,
      data.truncated ? el("p", { class: "ps-note" }, `Your text was ${fmt(data.length || 0)} characters, so only the first ${fmt(MAX_TEXT)} were analyzed.`) : null,
      el("div", { class: "ps-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy as text"),
        el("span", { class: "ps-grow" }),
        el("button", { onclick: () => { draft = { text: data.text, title: data.title || "", author: data.author || "", date: data.date || "" }; drawInput(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { draft = { text: "", title: "", author: "", date: "" }; drawInput(); } }, "New source")));
    const m = source.querySelector("mark");
    if (m) source.scrollTop = Math.max(0, m.offsetTop - source.offsetTop - 40);
  }

  async function run(input) {
    const model = currentModel();
    if (findModel(currentModel())?.experimental) return drawInput("TinyGPT is a tiny practice model and can't analyze a primary source. Pick a real chat model in Models first, then try again.");
    const prep = prepareText(input.text);
    busy = new AbortController();
    const live = el("pre", { class: "ps-live" }, "Waiting for the AI...");
    drawWorking(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(prep.text, input), think: false, auto_code: false }),
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
      const data = { text: prep.text, truncated: prep.truncated, length: prep.length, title: input.title, author: input.author, date: input.date, reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press the button to try again.");
      else drawInput(`Couldn't finish: ${err.message}`);
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
