// "📖 Reading level": a student, an English learner or a parent pastes hard text (a textbook
// paragraph, an article). The reading level is worked out right here with no AI: the
// Flesch-Kincaid grade and reading ease, from words, sentences and syllables. Then the AI on
// this computer rewrites the text at the level they pick, keeping every fact, and says which
// hard words it swapped. The rewrite gets its own score so they can see the level go down.
// The last result is kept in this browser.

// Pure helpers (no page needed), so test_readinglevel.py can run them with Node.
const LocalAIReadingLevel = (() => {
  const MAX_TEXT = 6000;
  const MAX_CHANGES = 8;
  const MAX_WORD = 60;
  const MAX_GRADE = 18;
  const TARGETS = [
    { id: "3", grade: 3, label: "Grade 3", how: "a 3rd grade student (about 8 years old): very short sentences and only everyday words" },
    { id: "6", grade: 6, label: "Grade 6", how: "a 6th grade student (about 11 years old): short sentences and common words" },
    { id: "9", grade: 9, label: "Grade 9", how: "a 9th grade student (about 14 years old): clear sentences, and explain any technical word the first time" },
    { id: "keep", grade: null, label: "Keep level, just clearer", how: "the same reader as the original, at about the same reading level, but clearer: untangle long sentences and cut extra words" },
  ];
  const findTarget = (id) => TARGETS.find((t) => t.id === String(id)) || TARGETS[1];

  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

  // The pasted text with spacing tidied; very long text is cut at a word.
  function prepareText(text) {
    const tidy = String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (tidy.length <= MAX_TEXT) return { text: tidy, truncated: false, length: tidy.length };
    let cut = tidy.slice(0, MAX_TEXT);
    const space = cut.search(/\s\S*$/);
    if (space > MAX_TEXT - 200) cut = cut.slice(0, space);
    return { text: cut.trim(), truncated: true, length: tidy.length };
  }

  // Syllables in one word, by the usual rule of thumb: count groups of vowels, minus a silent
  // "e" at the end (but "-le" as in "table" is a syllable). Numbers count as one. Always at least 1.
  function countSyllables(word) {
    let w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return /\p{N}/u.test(String(word || "")) ? 1 : 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, (m) => m[0]).replace(/^y/, "");
    const groups = (w.match(/[aeiouy]+/g) || []).length;
    return Math.max(1, groups);
  }

  const words = (text) => String(text || "").match(WORD) || [];

  // Sentences end at . ! ? (followed by a space or the end) or a line break. "3.5" isn't an end.
  function countSentences(text) {
    return String(text || "").split(/(?<=[.!?])["'”’)\]]*\s+|\n+/).filter((s) => words(s).length).length;
  }

  // How easy each reading-ease score feels.
  function easeLabel(ease) {
    return ease >= 90 ? "Very easy" : ease >= 80 ? "Easy" : ease >= 70 ? "Fairly easy" : ease >= 60 ? "Plain"
      : ease >= 50 ? "Fairly hard" : ease >= 30 ? "Hard" : "Very hard";
  }

  // Flesch-Kincaid grade (clamped 0 to 18) and Flesch reading ease (0 to 100).
  function readability(text) {
    const list = words(text);
    const n = list.length;
    if (!n) return { grade: 0, ease: 0, label: "No text yet", words: 0, sentences: 0, syllables: 0 };
    const sentences = Math.max(1, countSentences(text));
    const syllables = list.reduce((a, w) => a + countSyllables(w), 0);
    const wps = n / sentences;
    const spw = syllables / n;
    const round1 = (x) => Math.round(x * 10) / 10;
    const grade = round1(Math.min(MAX_GRADE, Math.max(0, 0.39 * wps + 11.8 * spw - 15.59)));
    const ease = round1(Math.min(100, Math.max(0, 206.835 - 1.015 * wps - 84.6 * spw)));
    return { grade, ease, label: easeLabel(ease), words: n, sentences, syllables };
  }

  // "Grade 6", "Grade 1" for very easy text, "College" above 12th grade.
  function gradeText(grade) {
    const g = Math.round(Number(grade) || 0);
    return g > 12 ? "College" : `Grade ${Math.max(1, g)}`;
  }

  function buildPrompt(text, targetId) {
    const src = prepareText(text).text;
    const t = findTarget(targetId);
    const now = readability(src);
    const system = "You rewrite hard text so a student can read it. Keep every fact, number, name and date: do not add new facts, opinions or advice, and do not leave anything out. "
      + `Write for ${t.how}. Keep paragraphs. Write in the same language as the text.\n`
      + "Answer in exactly this format and nothing else:\n"
      + "REWRITTEN:\nthe whole rewritten text\n"
      + `WORD CHANGES:\n- hard word -> simpler word\n(up to ${MAX_CHANGES} lines, only words you really changed)`;
    const user = `Target: ${t.grade ? t.label : "same level, just clearer"}\nThe text is now about ${gradeText(now.grade)} (Flesch-Kincaid).\n\nText:\n"""\n${src}\n"""`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const REWRITE_LABEL = /^(?:rewritten(?:\s+text)?|rewrite|simpler\s+(?:text|version)|new\s+text)\s*(?:\([^)]{0,40}\))?\s*:\s*(.*)$/i;
  const CHANGES_LABEL = /^(?:word\s+changes|words?\s+(?:that\s+)?changed|changed\s+words|word\s+swaps|vocabulary(?:\s+changes)?)\s*(?:\([^)]{0,40}\))?\s*:\s*(.*)$/i;
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const ARROW = /\s*(?:->|→|=>|⟶|⇒|—>|–>|>)\s*|\s+[-–—]\s+/;
  const stripQuotes = (s) => String(s).trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  const isNone = (s) => /^(?:none|n\/a|nothing|no changes?)\.?$/i.test(String(s).trim());

  function parseChange(line) {
    const parts = line.split(ARROW);
    if (parts.length < 2) return null;
    const from = clean(stripQuotes(parts[0].replace(/[*_]/g, "")), MAX_WORD);
    const to = clean(stripQuotes(parts.slice(1).join(" ").replace(/[*_]/g, "").replace(/[.;,]$/, "")), MAX_WORD);
    return from && to && from.toLowerCase() !== to.toLowerCase() ? { from, to } : null;
  }

  // { rewritten, changes: [{from, to}] }. With no REWRITTEN label, everything before WORD CHANGES is the rewrite.
  function parseRewrite(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const body = [];
    const changes = [];
    let section = "rewrite";
    let labelled = false;
    for (const raw of lines) {
      const bare = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      const head = bare.replace(BULLET, "");
      let m = head.match(CHANGES_LABEL);
      if (m) { section = "changes"; if (m[1].trim()) { const c = parseChange(m[1]); if (c) changes.push(c); } continue; }
      m = !labelled && head.match(REWRITE_LABEL);
      if (m) { labelled = true; section = "rewrite"; body.length = 0; if (m[1].trim()) body.push(m[1].trim()); continue; }
      if (section === "rewrite") body.push(raw.replace(/\*\*|__/g, "").trim());
      else if (bare) {
        const line = bare.replace(BULLET, "");
        if (isNone(line)) continue;
        const c = parseChange(line);
        if (c && changes.length < MAX_CHANGES && !changes.some((x) => x.from.toLowerCase() === c.from.toLowerCase())) changes.push(c);
      }
    }
    let rewritten = body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    rewritten = rewritten.replace(/^"""\s*|\s*"""$/g, "").replace(/^```\w*\s*|\s*```$/g, "").trim();
    if (/^["“][^"“”]*["”]$/.test(rewritten)) rewritten = stripQuotes(rewritten);
    return { rewritten, changes: changes.slice(0, MAX_CHANGES) };
  }

  // The rewritten text, ready to paste somewhere.
  function toPlainText(parsed) {
    const p = typeof parsed === "string" ? parseRewrite(parsed) : parsed || {};
    return String(p.rewritten || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  return { MAX_TEXT, MAX_CHANGES, MAX_GRADE, TARGETS, findTarget, prepareText, countSyllables, countSentences, easeLabel, readability, gradeText,
    buildPrompt, parseRewrite, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAIReadingLevel = LocalAIReadingLevel;
if (typeof module !== "undefined") module.exports = LocalAIReadingLevel;

if (typeof document !== "undefined") (() => {
  const { MAX_TEXT, MAX_GRADE, TARGETS, findTarget, prepareText, readability, gradeText, buildPrompt, parseRewrite, toPlainText } = LocalAIReadingLevel;
  const SAVE_KEY = "local-ai-reading-level";
  const fmt = (n) => n.toLocaleString("en-US");
  const EXAMPLE = "Photosynthesis is the biochemical process by which autotrophic organisms, including plants, algae and certain bacteria, convert light energy into chemical energy stored in glucose. "
    + "Within the chloroplasts, chlorophyll molecules absorb photons, predominantly in the blue and red wavelengths, initiating the light-dependent reactions that split water molecules and release oxygen as a byproduct. "
    + "The resulting ATP and NADPH subsequently power the Calvin cycle, in which atmospheric carbon dioxide is fixed into three-carbon intermediates that are ultimately assembled into carbohydrates.";

  const style = document.createElement("style");
  style.textContent = `
    #reading-level-dialog { width: min(980px, calc(100vw - 32px)); }
    .rl-field { display: block; font-weight: 600; margin-top: 12px; min-width: 0; }
    .rl-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400; resize: vertical;
      line-height: 1.5; min-height: 160px; padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
      background: var(--card); color: var(--text); outline: none; }
    .rl-field textarea:focus { border-color: var(--accent); }
    .rl-under { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .rl-under .rl-over { color: var(--slow); font-weight: 600; }
    .rl-target { margin-top: 12px; font-weight: 600; }
    .rl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; font-weight: 400; }
    .rl-chips button { padding: 5px 12px; border-radius: 999px; }
    .rl-chips button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .rl-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .rl-examples button { font-size: 0.95em; padding: 4px 10px; border-radius: 999px; }
    .rl-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .rl-change { margin: 6px 0 2px; padding: 10px 14px; border-radius: 12px; background: var(--accent-soft); font-weight: 700; font-size: 1.15em;
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
    .rl-change small { font-weight: 400; font-size: 0.7em; color: var(--muted); }
    .rl-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .rl-card { padding: 12px 14px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0;
      display: flex; flex-direction: column; }
    .rl-card.rl-new { border-color: var(--accent); }
    .rl-label { display: block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .rl-score { font-size: 1.3em; font-weight: 700; line-height: 1.25; }
    .rl-score .rl-word { font-weight: 600; }
    .rl-meter { height: 10px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 6px 0 4px; }
    .rl-meter span { display: block; height: 100%; border-radius: 999px; transition: width 0.3s ease; }
    .rl-easy { color: var(--fast); } .rl-meter .rl-easy { background: var(--fast); }
    .rl-mid { color: var(--good); } .rl-meter .rl-mid { background: var(--good); }
    .rl-hard { color: var(--slow); } .rl-meter .rl-hard { background: var(--slow); }
    .rl-vhard { color: var(--danger); } .rl-meter .rl-vhard { background: var(--danger); }
    .rl-ticks { display: flex; justify-content: space-between; font-size: 0.7em; color: var(--muted); }
    .rl-facts { margin: 4px 0 0; font-size: 0.8em; color: var(--muted); }
    .rl-text { flex: 1; max-height: 340px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 10px 0 0;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.95em; }
    .rl-note { margin: 8px 0 0; font-size: 0.85em; color: var(--muted); line-height: 1.45; }
    .rl-working { display: flex; align-items: center; gap: 10px; font-weight: 600; flex-wrap: wrap; margin-top: 8px; }
    .rl-working .rl-grow { flex: 1; }
    .rl-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: rl-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes rl-spin { to { transform: rotate(360deg); } }
    .rl-live { max-height: 260px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted);
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; font-family: inherit; }
    .rl-head { margin: 18px 0 6px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
    .rl-words { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
    .rl-words li { padding: 6px 10px; border-radius: 10px; background: var(--accent-soft); overflow-wrap: anywhere; font-size: 0.92em; }
    .rl-words s { color: var(--muted); }
    .rl-words b { color: var(--fast); }
    .rl-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .rl-buttons .rl-grow { flex: 1; }
    .rl-buttons button { white-space: nowrap; }
    #reading-level-dialog button:disabled { opacity: 0.55; cursor: default; }
    @media (max-width: 640px) {
      .rl-cols { grid-template-columns: minmax(0, 1fr); }
      .rl-text { max-height: 260px; }
      .rl-buttons .rl-grow { display: none; }
      .rl-buttons button { flex: 1 1 auto; }
      .rl-buttons button.rl-wide { flex-basis: 100%; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "reading-level-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📖 Reading level");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "reading-level-dialog", "aria-labelledby": "reading-level-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  let draft = { text: "", target: "6" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && typeof d.text === "string" && d.text.trim() && typeof d.target === "string" ? { ...d, reply: typeof d.reply === "string" ? d.reply : "" } : null;
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "reading-level-title" }, "📖 Reading level"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  const level = (g) => (g <= 5 ? "rl-easy" : g <= 8 ? "rl-mid" : g <= 12 ? "rl-hard" : "rl-vhard");

  // "Grade 11 · Hard" with a colored bar from grade 0 to 18.
  function meter(r) {
    const cls = level(r.grade);
    const pct = Math.max(3, Math.round((r.grade / MAX_GRADE) * 100));
    return [
      el("div", { class: "rl-score" }, el("span", { class: cls }, gradeText(r.grade)), " · ", el("span", { class: "rl-word" }, r.label)),
      el("div", { class: "rl-meter", role: "meter", "aria-valuemin": "0", "aria-valuemax": String(MAX_GRADE), "aria-valuenow": String(r.grade),
        "aria-label": `Reading level: ${gradeText(r.grade)}, ${r.label}` }, el("span", { class: cls, style: `width:${pct}%` })),
      el("div", { class: "rl-ticks", "aria-hidden": "true" }, el("span", {}, "Easy"), el("span", {}, "Grade 6"), el("span", {}, "Grade 12"), el("span", {}, "College")),
      el("p", { class: "rl-facts" }, `Score ${r.grade}${r.grade >= MAX_GRADE ? "+" : ""} · Reading ease ${r.ease}/100 · ${fmt(r.words)} words · ${fmt(r.sentences)} sentence${r.sentences === 1 ? "" : "s"}`),
    ];
  }

  function drawInput(message) {
    const was = busy;
    busy = null;
    was?.abort();
    const area = el("textarea", { rows: "8", placeholder: "Paste a textbook paragraph, an article or any hard text here…" });
    area.value = draft.text;
    const count = el("span", { "aria-live": "polite" });
    const live = el("span", {});
    const recount = () => {
      const n = area.value.trim().length;
      count.className = n > MAX_TEXT ? "rl-over" : "";
      count.textContent = n > MAX_TEXT ? `${fmt(n)} characters: only the first ${fmt(MAX_TEXT)} will be used` : `${fmt(n)} / ${fmt(MAX_TEXT)} characters`;
      const r = readability(prepareText(area.value).text);
      live.textContent = r.words ? `Now: ${gradeText(r.grade)} · ${r.label}` : "";
    };
    area.addEventListener("input", () => { draft.text = area.value; recount(); });
    recount();

    const chips = TARGETS.map((t) => el("button", { type: "button", "aria-pressed": String(draft.target === t.id),
      onclick: () => { draft.target = t.id; chips.forEach((c, i) => c.setAttribute("aria-pressed", String(TARGETS[i].id === t.id))); } }, t.label));

    const go = () => {
      if (!area.value.trim()) return drawInput("Paste some text first.");
      if (readability(area.value).words < 8) return drawInput("That's very short. Paste at least a sentence or two.");
      run({ text: area.value, target: draft.target });
    };
    setDialog(head(),
      el("p", { class: "note" }, "Paste hard text. You'll see its reading level right away (worked out without AI), then the AI on this computer rewrites it at the level you pick, keeping all the facts."),
      el("label", { class: "rl-field" }, "Text to make easier", area, el("span", { class: "rl-under" }, live, count)),
      el("div", { class: "rl-target", role: "group", "aria-label": "Rewrite for" }, "Rewrite for", el("div", { class: "rl-chips" }, ...chips)),
      el("div", { class: "rl-examples" }, "Try:",
        el("button", { type: "button", onclick: () => { draft = { text: EXAMPLE, target: draft.target }; drawInput(); } }, "Example: photosynthesis paragraph")),
      message ? el("p", { class: "rl-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Check & rewrite")));
    area.focus();
  }

  // The rewritten card's insides once the AI has answered (or why it hasn't).
  function rewriteView(data) {
    const t = findTarget(data.target);
    const label = el("span", { class: "rl-label" }, `✨ Rewritten · ${t.label}`);
    if (!data.reply) return [label, el("p", { class: "rl-note" }, data.note || "No rewrite for this one. The reading level of your text is worked out without AI.")];
    const p = parseRewrite(data.reply);
    const text = toPlainText(p) || data.reply.trim();
    return [label, ...meter(readability(text)), el("p", { class: "rl-text", tabindex: "0", "aria-label": "Rewritten text" }, text)];
  }

  function changesView(data) {
    if (!data.reply) return [];
    const { changes } = parseRewrite(data.reply);
    if (!changes.length) return [];
    return [el("div", { class: "rl-head" }, "Words that changed"),
      el("ul", { class: "rl-words" }, ...changes.map((c) => el("li", {}, el("s", {}, c.from), " → ", el("b", {}, c.to))))];
  }

  function summary(data, before) {
    if (!data.reply) return null;
    const after = readability(toPlainText(parseRewrite(data.reply)) || data.reply);
    const diff = Math.round(before.grade - after.grade);
    const plural = (n) => `${n} grade level${n === 1 ? "" : "s"}`;
    const said = diff >= 1 ? `${before.grade >= MAX_GRADE ? "at least " : ""}${plural(diff)} easier` : diff <= -1 ? `${plural(-diff)} harder: try a lower level` : "about the same level, written more clearly";
    return el("div", { class: "rl-change", role: "status" },
      el("span", { class: level(before.grade) }, gradeText(before.grade)), "→", el("span", { class: level(after.grade) }, gradeText(after.grade)),
      el("small", {}, said));
  }

  // The original's score right away; the rewritten card fills in when the AI answers.
  function drawResult(data, newBox) {
    const before = readability(data.text);
    const box = newBox || el("div", { class: "rl-card rl-new" }, ...rewriteView(data));
    const copyBtn = el("button", { class: "primary rl-wide", disabled: !data.reply, onclick: (e) => copyText(e.currentTarget, toPlainText(parseRewrite(data.reply)) || data.reply) }, "📋 Copy rewritten text");
    setDialog(head(),
      summary(data, before),
      el("div", { class: "rl-cols" },
        el("div", { class: "rl-card" }, el("span", { class: "rl-label" }, "📄 Original"), ...meter(before),
          el("p", { class: "rl-text", tabindex: "0", "aria-label": "Original text" }, data.text)),
        box),
      data.truncated ? el("p", { class: "rl-note" }, `Your text was ${fmt(data.length || 0)} characters, so only the first ${fmt(MAX_TEXT)} were used.`) : null,
      ...changesView(data),
      el("p", { class: "rl-note" }, "Grade levels use the Flesch-Kincaid formula (sentence length and syllables per word). It's a guide, not a test, so read the rewrite and check the facts."),
      el("div", { class: "rl-buttons" },
        copyBtn,
        el("span", { class: "rl-grow" }),
        el("button", { onclick: () => { draft = { text: data.text, target: data.target }; drawInput(); } }, "Try another level"),
        el("button", { onclick: () => { draft = { text: "", target: data.target }; drawInput(); } }, "New text")));
    return copyBtn;
  }

  async function run(input) {
    const model = currentModel();
    const prep = prepareText(input.text);
    const data = { text: prep.text, truncated: prep.truncated, length: prep.length, target: input.target, reply: "", at: Date.now() };
    if (findModel(currentModel())?.experimental) {
      data.note = "TinyGPT is a tiny practice model, so it can't rewrite text. The reading level of your text is worked out without AI. Pick a real chat model in Models to get a rewrite too.";
      save(data);
      return drawResult(data);
    }
    const ctl = new AbortController();
    busy = ctl;
    const live = el("pre", { class: "rl-live" }, "Waiting for the AI...");
    const box = el("div", { class: "rl-card rl-new" },
      el("span", { class: "rl-label" }, `✨ Rewritten · ${findTarget(input.target).label}`),
      el("div", { class: "rl-working" }, el("span", { class: "rl-spin", "aria-hidden": "true" }), "Rewriting…",
        el("span", { class: "rl-grow" }), el("button", { onclick: () => ctl.abort() }, "■ Stop")),
      el("p", { class: "rl-note" }, "A small model takes a few seconds; a big one can take a minute."),
      live);
    drawResult(data, box);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(prep.text, input.target), think: false, auto_code: false }),
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
      if (!toPlainText(parseRewrite(reply))) throw new Error("the AI sent an empty answer");
      data.reply = reply.trim();
      save(data);
      if (busy === ctl) drawResult(data);
    } catch (err) {
      if (busy !== ctl && err.name === "AbortError") return; // closed or moved on
      data.note = err.name === "AbortError" ? "Rewrite stopped. The reading level of your text is still right. Press Try another level to start again."
        : `Couldn't rewrite it: ${err.message}. The reading level of your text is still right.`;
      save(data);
      box.replaceChildren(...rewriteView(data));
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) { draft = { text: saved.text, target: saved.target }; drawResult(saved); }
    else drawInput();
  }

  dialog.addEventListener("close", () => { busy?.abort(); });
})();
