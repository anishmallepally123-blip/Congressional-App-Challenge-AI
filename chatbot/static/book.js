// "📚 Book companion": for English class. A student types a book's title and author and how far
// they've read ("Chapter 5" or "finished"), and can paste a passage. The AI on this computer lists
// the main characters, themes, symbols, discussion questions and essay ideas, without spoilers past
// that point. "💬 Discuss" puts a question into the chat box so the student can talk it through.
// Nothing leaves the computer; the last result is kept in this browser.

// Pure helpers (no page needed), so test_book.py can run them with Node.
const LocalAIBook = (() => {
  const MAX_TITLE = 150;
  const MAX_AUTHOR = 100;
  const MAX_PROGRESS = 80;
  const MAX_PASSAGE = 4000;
  const CAPS = { characters: 6, themes: 4, symbols: 3, questions: 5, essays: 2 };
  const NOTE = "The AI may get details wrong about books, especially less famous ones. Check with the text.";

  const clean = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const cleanPassage = (s) => String(s || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const passageTooLong = (s) => cleanPassage(s).length > MAX_PASSAGE;

  function buildPrompt(title, author, progress, passage) {
    const t = clean(title, MAX_TITLE);
    const a = clean(author, MAX_AUTHOR);
    const p = clean(progress, MAX_PROGRESS);
    const text = cleanPassage(passage).slice(0, MAX_PASSAGE);
    const system = "You are a friendly high school English teacher helping a student understand a book. "
      + `The student has read up to: ${p || "an unknown point, so only use the first few chapters"}. `
      + "No spoilers: do not mention any event, death, twist, reveal or ending that happens after that point. "
      + "If you are not sure when something happens, leave it out. Use simple words. "
      + (text ? "The student pasted a passage from the book. Ground your answers in that passage and quote or point to it where you can. " : "")
      + "If you do not know this book, say so in one line instead of making things up.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "MAIN CHARACTERS:\n- Name — one-line description (at most 6)\n\n"
      + "THEMES:\n- Theme — where you see it in the book (at most 4)\n\n"
      + "SYMBOLS:\n- Symbol — what it stands for (at most 3)\n\n"
      + "DISCUSSION QUESTIONS:\n1. question\n(exactly 5, mix easy questions about what happened with deep questions about why)\n\n"
      + "ESSAY IDEAS:\n1. a thesis-style essay prompt\n(exactly 2)";
    const lines = [`Book: ${t || "not given"}`];
    if (a) lines.push(`Author: ${a}`);
    lines.push(`I have read up to: ${p || "not given"}`);
    if (text) lines.push("", "Passage I pasted:", '"""', text, '"""');
    return [{ role: "system", content: system }, { role: "user", content: lines.join("\n") }];
  }

  const SECTIONS = [
    ["characters", /^(?:the\s+)?(?:main|key|major)?\s*characters?$/i],
    ["themes", /^(?:main|key|major)?\s*themes?$/i],
    ["symbols", /^(?:main|key)?\s*symbols?(?:\s+(?:and|&)\s+motifs?)?$/i],
    ["questions", /^(?:\d+\s+)?(?:discussion|class|book\s+club)?\s*questions?(?:\s+for\s+discussion)?$/i],
    ["essays", /^(?:\d+\s+)?essay\s+(?:ideas?|prompts?|topics?|questions?)$/i],
  ];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)]|[a-z][.)])\s+/i;
  const SUB = /^(?:where\s+(?:you\s+)?(?:see|find)\s+it|where|seen\s+in|example|in\s+the\s+book|what\s+it\s+(?:stands\s+for|means)|stands\s+for|meaning|description|who)\s*:\s*/i;
  const strip = (s) => String(s).replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
  const tidy = (s, n = 300) => clean(String(s).replace(/[*_`]/g, "").replace(/^["'“”]+|["'“”]+$/g, ""), n);

  function sectionOf(line) {
    const m = line.match(/^([A-Za-z0-9&' ]{3,40}?)\s*(?:\([^)]{0,40}\))?\s*(?::\s*(.*))?$/);
    if (!m) return null;
    const hit = SECTIONS.find(([, re]) => re.test(m[1].trim()));
    return hit ? { key: hit[0], rest: (m[2] || "").trim() } : null;
  }

  function splitPair(s) {
    let m = s.match(/^(.{1,80}?)\s+[—–-]{1,2}\s+(.+)$/) || s.match(/^(.{1,80}?)\s*[—–]\s*(.+)$/) || s.match(/^([^:]{1,60}?)\s*:\s+(.+)$/);
    if (!m) return [tidy(s, 80), ""];
    return [tidy(m[1].replace(/\s*[:.]$/, ""), 80), tidy(m[2].replace(SUB, ""))];
  }

  const empty = () => ({ characters: [], themes: [], symbols: [], questions: [], essays: [] });
  const PAIR = { characters: "desc", themes: "where", symbols: "meaning" };

  // { characters: [{ name, desc }], themes: [{ name, where }], symbols: [{ name, meaning }], questions: [..], essays: [..] }
  function parseBook(text) {
    const out = empty();
    let sec = null;
    const add = (line, bulleted) => {
      const list = out[sec];
      const key = PAIR[sec];
      if (!key) {
        const q = tidy(line);
        if (!q) return;
        const last = list[list.length - 1];
        // A wrapped line that isn't a new item joins the one before it.
        if (!bulleted && last && !/[?.!]["”']?$/.test(last)) list[list.length - 1] = clean(`${last} ${q}`);
        else list.push(q);
        return;
      }
      const last = list[list.length - 1];
      const sub = line.match(SUB);
      if (sub && last) { last[key] = clean(`${last[key]} ${tidy(line.slice(sub[0].length))}`); return; }
      const [name, rest] = splitPair(line);
      if (!name) return;
      if (!bulleted && last && !last[key]) { last[key] = tidy(line); return; }
      list.push({ name, [key]: rest });
    };
    for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      const bare = strip(raw);
      if (!bare) continue;
      const bulleted = BULLET.test(bare);
      const line = strip(bare.replace(BULLET, ""));
      if (!line) continue;
      const s = sectionOf(line);
      if (s) { sec = s.key; if (s.rest) add(s.rest, true); continue; }
      if (sec) add(line, bulleted);
    }
    for (const k of Object.keys(CAPS)) out[k] = out[k].slice(0, CAPS[k]);
    return out;
  }

  // Good enough to show as sections: some characters or themes, and some questions.
  function parsedOk(b) {
    return !!b && Array.isArray(b.questions) && b.questions.length > 0
      && ((Array.isArray(b.characters) && b.characters.length > 0) || (Array.isArray(b.themes) && b.themes.length > 0));
  }

  function heading(info) {
    if (!info || !clean(info.title)) return "Book companion";
    const by = clean(info.author) ? ` by ${clean(info.author)}` : "";
    const upto = clean(info.progress) ? ` (read up to: ${clean(info.progress)})` : "";
    return `Book companion: ${clean(info.title)}${by}${upto}`;
  }

  function toPlainText(parsed, info) {
    const b = typeof parsed === "string" ? parseBook(parsed) : parsed && typeof parsed === "object" ? parsed : null;
    if (!b || !parsedOk(b)) return "";
    const pair = (x, k) => (x[k] ? `- ${x.name} — ${x[k]}` : `- ${x.name}`);
    const blocks = [
      b.characters.length && `MAIN CHARACTERS\n${b.characters.map((x) => pair(x, "desc")).join("\n")}`,
      b.themes.length && `THEMES\n${b.themes.map((x) => pair(x, "where")).join("\n")}`,
      b.symbols && b.symbols.length && `SYMBOLS\n${b.symbols.map((x) => pair(x, "meaning")).join("\n")}`,
      `DISCUSSION QUESTIONS\n${b.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
      b.essays && b.essays.length && `ESSAY IDEAS\n${b.essays.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
    ].filter(Boolean);
    return `${heading(info)}\n\n${blocks.join("\n\n")}\n\n${NOTE}`;
  }

  return { MAX_TITLE, MAX_AUTHOR, MAX_PROGRESS, MAX_PASSAGE, CAPS, NOTE, passageTooLong, buildPrompt, parseBook, parsedOk, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAIBook = LocalAIBook;
if (typeof module !== "undefined") module.exports = LocalAIBook;

if (typeof document !== "undefined") (() => {
  const { MAX_TITLE, MAX_AUTHOR, MAX_PROGRESS, MAX_PASSAGE, NOTE, passageTooLong, buildPrompt, parseBook, parsedOk, toPlainText } = LocalAIBook;
  const SAVE_KEY = "local-ai-book";

  const style = document.createElement("style");
  style.textContent = `
    #book-dialog { width: min(980px, calc(100vw - 32px)); }
    .bk-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 0.8fr); gap: 12px; margin-top: 12px; }
    .bk-field { display: block; font-weight: 600; min-width: 0; margin-top: 12px; }
    .bk-row .bk-field { margin-top: 0; }
    .bk-field input, .bk-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .bk-field textarea { resize: vertical; min-height: 96px; line-height: 1.45; }
    .bk-field input:focus, .bk-field textarea:focus { border-color: var(--accent); }
    .bk-count { display: block; margin-top: 4px; font-size: 0.8em; font-weight: 400; color: var(--muted); }
    .bk-count.bk-over { color: var(--accent); font-weight: 600; }
    .bk-private { margin: 12px 0 0; font-size: 0.82em; color: var(--muted); }
    .bk-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .bk-for { margin: 4px 0 0; font-size: 0.88em; color: var(--muted); overflow-wrap: anywhere; }
    .bk-warn { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--accent); line-height: 1.45; font-size: 0.92em; }
    .bk-section { margin-top: 18px; }
    .bk-label { display: block; margin: 0 0 8px; font-size: 0.75em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .bk-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .bk-card { padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0; overflow-wrap: anywhere; }
    .bk-name { display: block; font-weight: 700; line-height: 1.3; }
    .bk-desc { margin: 3px 0 0; font-size: 0.92em; line-height: 1.45; color: var(--muted); }
    .bk-chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .bk-chip { padding: 8px 12px; border-radius: 14px; background: var(--accent-soft); min-width: 0; overflow-wrap: anywhere; }
    .bk-chip .bk-name { display: inline-block; padding: 2px 10px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 0.92em; }
    .bk-symbols { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .bk-symbols li { padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--card); border-radius: 0 10px 10px 0; overflow-wrap: anywhere; line-height: 1.45; }
    .bk-qs { margin: 0; padding: 0; list-style: none; counter-reset: bk-q; display: grid; gap: 8px; }
    .bk-qs li { counter-increment: bk-q; display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; min-width: 0; }
    .bk-qs li::before { content: counter(bk-q); flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: 700; margin-top: 1px; }
    .bk-q { flex: 1; min-width: 0; line-height: 1.45; overflow-wrap: anywhere; }
    .bk-qs button { flex-shrink: 0; white-space: nowrap; padding: 4px 10px; font-size: 0.88em; }
    .bk-essays { margin: 0; padding: 0 0 0 22px; display: grid; gap: 8px; }
    .bk-essays li { line-height: 1.5; overflow-wrap: anywhere; font-style: italic; }
    .bk-note { margin: 16px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 0.88em; line-height: 1.45; }
    .bk-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; }
    .bk-working { display: flex; align-items: center; gap: 10px; font-weight: 600; flex-wrap: wrap; margin-top: 12px; }
    .bk-working .bk-grow { flex: 1; }
    .bk-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: bk-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes bk-spin { to { transform: rotate(360deg); } }
    .bk-live { max-height: 280px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted);
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; font-family: inherit; }
    .bk-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .bk-buttons .bk-grow { flex: 1; }
    .bk-buttons button { white-space: nowrap; }
    #book-dialog button:disabled { opacity: 0.55; cursor: default; }
    @media (max-width: 860px) { .bk-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) {
      .bk-row, .bk-cards, .bk-chips { grid-template-columns: minmax(0, 1fr); }
      .bk-qs li { flex-wrap: wrap; }
      .bk-qs .bk-q { flex-basis: calc(100% - 34px); }
      .bk-qs button { margin-left: 34px; }
      .bk-buttons .bk-grow { display: none; }
      .bk-buttons button { flex: 1 1 auto; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "book-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📚 Book companion");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "book-dialog", "aria-labelledby": "book-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  const blank = () => ({ title: "", author: "", progress: "", passage: "" });
  let draft = blank();

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const forget = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked */ } };
  const str = (v) => (typeof v === "string" ? v : "");
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !str(d.title).trim() || !str(d.reply).trim()) return null;
      return { title: d.title, author: str(d.author), progress: str(d.progress), passage: str(d.passage), reply: d.reply };
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "book-title" }, "📚 Book companion"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));
  const privacy = () => el("p", { class: "bk-private" }, "🔒 Your answers stay on this computer.");
  const note = () => el("p", { class: "bk-note" }, `⚠️ ${NOTE}`);

  function drawInput(message) {
    const was = busy;
    busy = null;
    was?.abort();
    const msg = message ? el("p", { class: "bk-msg", role: "alert" }, message) : null;
    const field = (label, attrs, key) => {
      const input = el(attrs.tag || "input", { type: attrs.tag ? null : "text", maxlength: attrs.max ? String(attrs.max) : null, placeholder: attrs.placeholder, rows: attrs.rows });
      input.value = draft[key];
      input.addEventListener("input", () => { draft[key] = input.value; msg?.remove(); });
      return [el("label", { class: "bk-field" }, label, input), input];
    };
    const [titleBox, title] = field("Book title", { max: MAX_TITLE, placeholder: "e.g. To Kill a Mockingbird" }, "title");
    const [authorBox] = field("Author (optional)", { max: MAX_AUTHOR, placeholder: "e.g. Harper Lee" }, "author");
    const [progressBox] = field("How far you've read", { max: MAX_PROGRESS, placeholder: "e.g. Chapter 5, or finished" }, "progress");
    const [passageBox, passage] = field("Paste a passage (optional)", { tag: "textarea", rows: "4", placeholder: "Paste a page or paragraph from the book and the AI will use it." }, "passage");
    const count = el("span", { class: "bk-count" });
    const recount = () => {
      const n = passage.value.trim().length;
      const over = passageTooLong(passage.value);
      count.className = over ? "bk-count bk-over" : "bk-count";
      count.textContent = over ? `${n.toLocaleString()} characters. Only the first ${MAX_PASSAGE.toLocaleString()} will be used.` : n ? `${n.toLocaleString()} / ${MAX_PASSAGE.toLocaleString()} characters` : "";
    };
    passage.addEventListener("input", recount);
    recount();
    passageBox.append(count);
    const go = () => {
      if (!draft.title.trim()) { drawInput("Type the book's title first."); return; }
      run({ title: draft.title.trim(), author: draft.author.trim(), progress: draft.progress.trim(), passage: draft.passage.trim() });
    };
    for (const box of [titleBox, authorBox, progressBox]) box.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    setDialog(head(),
      el("p", { class: "note" }, "Tell the AI what you're reading and how far you've got. It lists the main characters, themes, symbols, discussion questions and essay ideas, with no spoilers past where you are."),
      el("div", { class: "bk-row" }, titleBox, authorBox, progressBox),
      passageBox,
      msg,
      privacy(),
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "📚 Help me with this book")));
    if (!message || message.startsWith("Type")) title.focus();
  }

  function forLine(data) {
    const bits = [data.author && `by ${data.author}`, `read up to: ${data.progress || "not given"}`].filter(Boolean);
    return el("p", { class: "bk-for" }, `${data.title} · ${bits.join(" · ")}`);
  }

  function discuss(question) {
    dialog.close();
    if (typeof closeSidebar === "function") closeSidebar();
    const box = $("input");
    box.value = question;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  }

  function section(label, node) {
    return el("section", { class: "bk-section", "aria-label": label }, el("h3", { class: "bk-label" }, label), node);
  }

  function bookView(b) {
    return el("div", {},
      b.characters.length ? section("Main characters", el("div", { class: "bk-cards" }, ...b.characters.map((c) => el("article", { class: "bk-card" },
        el("span", { class: "bk-name" }, c.name), c.desc ? el("p", { class: "bk-desc" }, c.desc) : null)))) : null,
      b.themes.length ? section("Themes", el("div", { class: "bk-chips" }, ...b.themes.map((t) => el("div", { class: "bk-chip", title: t.where || t.name },
        el("span", { class: "bk-name" }, t.name), t.where ? el("p", { class: "bk-desc" }, `Where you see it: ${t.where}`) : null)))) : null,
      b.symbols.length ? section("Symbols", el("ul", { class: "bk-symbols" }, ...b.symbols.map((s) => el("li", {},
        el("span", { class: "bk-name" }, s.name), s.meaning ? el("p", { class: "bk-desc" }, s.meaning) : null)))) : null,
      section("Discussion questions", el("ol", { class: "bk-qs" }, ...b.questions.map((q) => el("li", {},
        el("span", { class: "bk-q" }, q),
        el("button", { type: "button", title: "Put this question in the chat box", onclick: () => discuss(q) }, "💬 Discuss"))))),
      b.essays.length ? section("Essay ideas", el("ol", { class: "bk-essays" }, ...b.essays.map((q) => el("li", {}, q)))) : null);
  }

  function buttons(data, ready) {
    const parsed = ready ? parseBook(data.reply) : null;
    const ok = parsedOk(parsed);
    const info = { title: data.title, author: data.author, progress: data.progress };
    return el("div", { class: "bk-buttons" },
      el("span", { class: "bk-grow" }),
      el("button", { disabled: !ready, onclick: (e) => copyText(e.currentTarget, ok ? toPlainText(parsed, info) : `${data.reply.trim()}\n\n${NOTE}`) }, "📋 Copy as text"),
      el("button", { class: "primary", onclick: () => { forget(); draft = blank(); drawInput(); } }, "📖 New book"));
  }

  function drawResult(data, middle) {
    let body = middle;
    if (!body) {
      const parsed = parseBook(data.reply);
      body = parsedOk(parsed) ? bookView(parsed)
        : el("div", {}, el("p", { class: "bk-msg" }, "The AI didn't answer in the usual layout, so here is its answer as it wrote it."),
          el("pre", { class: "bk-raw" }, data.reply.trim()));
    }
    setDialog(head(), forLine(data),
      passageTooLong(data.passage) ? el("p", { class: "bk-warn" }, `✂️ Your passage was long, so only the first ${MAX_PASSAGE.toLocaleString()} characters were used.`) : null,
      body, note(), privacy(),
      buttons(data, !middle && !!data.reply));
  }

  async function run(input) {
    const data = { title: input.title, author: input.author, progress: input.progress, passage: input.passage, reply: "" };
    draft = { title: data.title, author: data.author, progress: data.progress, passage: data.passage };
    if (findModel(currentModel())?.experimental) {
      return drawInput("TinyGPT is a tiny practice model, so it can't help with books. Pick a real chat model in Models, then try again.");
    }
    const model = currentModel();
    const ctl = new AbortController();
    busy = ctl;
    const live = el("pre", { class: "bk-live" }, "Waiting for the AI...");
    drawResult(data, el("div", {},
      el("div", { class: "bk-working" }, el("span", { class: "bk-spin", "aria-hidden": "true" }),
        `Reading up on ${data.title}…`,
        el("span", { class: "bk-grow" }), el("button", { onclick: () => ctl.abort() }, "■ Stop")),
      el("p", { class: "bk-private" }, "A small model takes a few seconds; a big one can take a minute."),
      live));
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(data.title, data.author, data.progress, data.passage), think: false, auto_code: false }),
        signal: ctl.signal,
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
      data.reply = reply.trim();
      save(data);
      if (busy === ctl) drawResult(data);
    } catch (err) {
      if (busy !== ctl && err.name === "AbortError") return; // closed or moved on
      busy = null;
      drawInput(err.name === "AbortError" ? "Stopped. Press Help me with this book to try again." : `Couldn't get book help: ${err.message}`);
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) { draft = { title: saved.title, author: saved.author, progress: saved.progress, passage: saved.passage }; drawResult(saved); }
    else drawInput();
  }

  dialog.addEventListener("close", () => { busy?.abort(); });
})();
