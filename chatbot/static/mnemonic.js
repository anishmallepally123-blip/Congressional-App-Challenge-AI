// "🧠 Memory tricks": a student types a list to memorize, one thing per line (the planets in order,
// the Great Lakes, steps of mitosis...). The AI on this computer makes an acronym, an acrostic
// sentence and a short rhyme or story. The page itself checks that the acronym and sentence really
// use the right first letters, then "Test yourself" hides the list so the student can recall it.
// Nothing leaves the computer; the last result is kept in this browser.

// Pure helpers (no page needed), so test_mnemonic.py can run them with Node.
const LocalAIMemoryTricks = (() => {
  const MIN_ITEMS = 2;
  const MAX_ITEMS = 15;
  const MAX_ITEM = 80;
  const MAX_TOPIC = 80;
  const NOTE = "Memory tricks help you remember the order, but you still need to know what each item means.";

  const clean = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)]|[a-z][.)])\s+/i;

  // One item per line; bullets and numbers are dropped. Commas also split a single-line list.
  function parseItems(text) {
    let lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].includes(",")) lines = lines[0].split(",");
    return lines.map((l) => clean(l.replace(BULLET, "").replace(/^\*\*|\*\*$/g, ""), MAX_ITEM)).filter(Boolean);
  }

  // The letter a word or item is remembered by: its first letter or digit, skipping a leading "the".
  const firstLetter = (s) => {
    const m = String(s || "").replace(/^\s*the\s+(?=\S)/i, "").match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : "";
  };
  const initials = (items) => (Array.isArray(items) ? items : []).map(firstLetter).filter(Boolean);

  function buildPrompt(items, topic) {
    const list = (Array.isArray(items) ? items : []).map((x) => clean(x, MAX_ITEM)).filter(Boolean);
    const t = clean(topic, MAX_TOPIC);
    const letters = initials(list).join(" ");
    const system = "You are a friendly study coach who makes memory tricks (mnemonics) for students. "
      + "Keep the items in the exact order given. Use simple, school-appropriate words.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "ACRONYM: one word whose letters are the first letters of the items, in order if possible. "
      + "If no real word works, write ACRONYM: none\n"
      + "SENTENCE: a short funny sentence with exactly one word per item, where each word starts with the same letter as that item, in the same order. No extra words.\n"
      + "RHYME: a short rhyme (2 to 4 lines) or a vivid mini-story (2 to 3 sentences) that mentions every item in order.";
    const lines = [];
    if (t) lines.push(`Topic: ${t}`);
    lines.push(`Things to memorize, in order (${list.length}):`, ...list.map((x, i) => `${i + 1}. ${x}`), "", `First letters: ${letters}`);
    return [{ role: "system", content: system }, { role: "user", content: lines.join("\n") }];
  }

  const LABEL = /^(acronym|sentence|acrostic(?:\s+sentence)?|rhyme|story|rhyme\s+or\s+story|rhyme\/story|mini[- ]story)\s*:\s*(.*)$/i;
  const strip = (s) => String(s).replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").replace(BULLET, "").trim();
  const unquote = (s) => clean(String(s).replace(/[*_`]/g, "").replace(/^["'“”]+|["'“”]+$/g, ""));
  const NONE = /^(?:none|n\/?a|not possible|no (?:real )?word.*|-+)\.?$/i;

  // { acronym, acronymNote, sentence, rhyme }; a missing part is "".
  function parseTricks(text) {
    const out = { acronym: "", acronymNote: "", sentence: "", rhyme: "" };
    const rhyme = [];
    let sec = null;
    for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      const line = strip(raw);
      if (!line) { if (sec === "rhyme" && rhyme.length) rhyme.push(""); continue; }
      const m = line.match(LABEL);
      if (m) {
        const key = m[1].toLowerCase();
        sec = key === "acronym" ? "acronym" : /^(sentence|acrostic)/.test(key) ? "sentence" : "rhyme";
        const rest = m[2].trim();
        if (sec === "rhyme") { if (rest) rhyme.push(unquote(rest)); }
        else if (rest) setPart(out, sec, rest);
        continue;
      }
      if (sec === "rhyme") rhyme.push(unquote(line));
      else if (sec && !out[sec]) setPart(out, sec, line);
    }
    out.rhyme = rhyme.join("\n").replace(/\n{2,}/g, "\n").trim();
    return out;
  }

  function setPart(out, sec, rest) {
    const s = unquote(rest);
    if (sec === "sentence") { out.sentence = s; return; }
    if (NONE.test(s)) { out.acronym = ""; out.acronymNote = "none"; return; }
    // "HOMES (Huron, Ontario...)" or "HOMES - stands for..." keeps just the word.
    const m = s.match(/^([\p{L}\p{N}.'-]+?)(?:\s*[(—–:]|\s+-\s|\s+[=]|$)/u) || s.match(/^(\S+)/);
    out.acronym = m ? m[1].replace(/[.'-]/g, "").toUpperCase() : "";
  }

  const parsedOk = (t) => !!t && typeof t === "object" && !!(t.acronym || t.sentence || t.rhyme);

  // { ok, inOrder, got, want }: in order, or (still a help) the same letters in another order.
  function checkAcronym(acronym, items) {
    const want = initials(items);
    const got = [...String(acronym || "").toUpperCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
    const same = got.join("") === want.join("");
    const sorted = (a) => [...a].sort().join("");
    const perm = !same && got.length === want.length && sorted(got) === sorted(want);
    return { ok: got.length > 0 && (same || perm), inOrder: got.length > 0 && same, got, want };
  }

  // The words of a sentence, punctuation removed.
  const sentenceWords = (s) => String(s || "").split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, "").replace(/^['’-]+|['’-]+$/g, "")).filter(Boolean);

  // Strict: one word per item, in order.
  function checkSentence(sentence, items) {
    const want = initials(items);
    const got = sentenceWords(sentence).map((w) => w[0].toUpperCase());
    return { ok: got.length > 0 && got.join("") === want.join(""), got, want };
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
  const checkAnswer = (typed, item) => norm(typed) !== "" && norm(typed) === norm(item);

  function toPlainText(tricks, items, topic) {
    const t = typeof tricks === "string" ? parseTricks(tricks) : tricks;
    if (!parsedOk(t)) return "";
    const list = Array.isArray(items) ? items : [];
    const head = clean(topic) ? `Memory tricks: ${clean(topic)}` : "Memory tricks";
    const blocks = [`${head}\n${list.map((x, i) => `${i + 1}. ${x}`).join("\n")}`];
    if (t.acronym) {
      const c = checkAcronym(t.acronym, list);
      blocks.push(`ACRONYM: ${t.acronym}${c.inOrder ? " (letters match, in order)" : c.ok ? " (same letters, different order)" : " (letters don't match)"}`);
    }
    if (t.sentence) blocks.push(`SENTENCE: ${t.sentence}${checkSentence(t.sentence, list).ok ? " (letters match)" : " (letters don't match)"}`);
    if (t.rhyme) blocks.push(`RHYME OR STORY:\n${t.rhyme}`);
    return `${blocks.join("\n\n")}\n\n${NOTE}`;
  }

  return { MIN_ITEMS, MAX_ITEMS, MAX_ITEM, MAX_TOPIC, NOTE, parseItems, buildPrompt, parseTricks, parsedOk, initials, sentenceWords, checkAcronym, checkSentence, checkAnswer, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAIMemoryTricks = LocalAIMemoryTricks;
if (typeof module !== "undefined") module.exports = LocalAIMemoryTricks;

if (typeof document !== "undefined") (() => {
  const { MIN_ITEMS, MAX_ITEMS, MAX_TOPIC, NOTE, parseItems, buildPrompt, parseTricks, parsedOk, initials, checkAcronym, checkSentence, checkAnswer, toPlainText } = LocalAIMemoryTricks;
  const SAVE_KEY = "local-ai-memory-tricks";

  const style = document.createElement("style");
  style.textContent = `
    #mnemonic-dialog { width: min(760px, calc(100vw - 32px)); }
    .mn-field { display: block; font-weight: 600; min-width: 0; margin-top: 12px; }
    .mn-field input, .mn-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .mn-field textarea { resize: vertical; min-height: 150px; line-height: 1.5; }
    .mn-field input:focus, .mn-field textarea:focus { border-color: var(--accent); }
    .mn-count { display: block; margin-top: 4px; font-size: 0.8em; font-weight: 400; color: var(--muted); }
    .mn-count.mn-over { color: var(--accent); font-weight: 600; }
    .mn-private { margin: 12px 0 0; font-size: 0.82em; color: var(--muted); }
    .mn-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .mn-for { margin: 4px 0 0; font-size: 0.88em; color: var(--muted); overflow-wrap: anywhere; }
    .mn-items { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
    .mn-items li { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border-strong); font-size: 0.9em; overflow-wrap: anywhere; min-width: 0; }
    .mn-items .mn-initial { font-weight: 800; color: var(--accent); }
    .mn-card { margin-top: 14px; padding: 12px 14px; border-radius: 14px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0; overflow-wrap: anywhere; }
    .mn-label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; font-size: 0.75em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .mn-word { font-size: 1.9em; font-weight: 800; letter-spacing: 0.14em; line-height: 1.2; color: var(--accent); overflow-wrap: anywhere; }
    .mn-sentence { font-size: 1.2em; line-height: 1.55; font-weight: 500; }
    .mn-sentence .mn-initial { display: inline-block; min-width: 0.8em; padding: 0 2px; border-radius: 5px; background: var(--accent); color: #fff; font-weight: 800; text-align: center; }
    .mn-w { white-space: nowrap; }
    .mn-rhyme { white-space: pre-wrap; line-height: 1.6; font-style: italic; margin: 0; }
    .mn-letters { margin: 6px 0 0; font-size: 0.86em; color: var(--muted); }
    .mn-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.95em; letter-spacing: 0; text-transform: none; font-weight: 700; }
    .mn-good { color: #23794a; background: color-mix(in srgb, #2f9e5b 16%, transparent); }
    .mn-bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
    .mn-none { margin: 0; color: var(--muted); }
    .mn-test { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; counter-reset: mn-t; }
    .mn-test li { counter-increment: mn-t; display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .mn-test li::before { content: counter(mn-t); flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: 700; }
    .mn-test input { flex: 1 1 160px; min-width: 0; box-sizing: border-box; font: inherit; padding: 7px 12px; border: 1px solid var(--border-strong);
      border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .mn-test input:focus { border-color: var(--accent); }
    .mn-test input.mn-right { border-color: #2f9e5b; }
    .mn-test input.mn-wrong { border-color: var(--danger); }
    .mn-mark { flex: 0 1 auto; min-width: 0; font-size: 0.9em; overflow-wrap: anywhere; }
    .mn-score { margin: 14px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-weight: 700; }
    .mn-note { margin: 16px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 0.88em; line-height: 1.45; }
    .mn-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; }
    .mn-working { display: flex; align-items: center; gap: 10px; font-weight: 600; flex-wrap: wrap; margin-top: 12px; }
    .mn-working .mn-grow { flex: 1; }
    .mn-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: mn-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes mn-spin { to { transform: rotate(360deg); } }
    .mn-live { max-height: 240px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted);
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; font-family: inherit; }
    .mn-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .mn-buttons .mn-grow { flex: 1; }
    .mn-buttons button { white-space: nowrap; }
    #mnemonic-dialog button:disabled { opacity: 0.55; cursor: default; }
    @media (prefers-color-scheme: dark) { .mn-good { color: #6fd39a; } }
    @media (max-width: 640px) {
      .mn-word { font-size: 1.6em; }
      .mn-buttons .mn-grow { display: none; }
      .mn-buttons button { flex: 1 1 auto; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "mnemonic-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🧠 Memory tricks");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "mnemonic-dialog", "aria-labelledby": "mnemonic-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  const blank = () => ({ topic: "", list: "" });
  let draft = blank();

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const forget = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked */ } };
  const str = (v) => (typeof v === "string" ? v : "");
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !Array.isArray(d.items) || !str(d.reply).trim()) return null;
      const items = d.items.filter((x) => typeof x === "string" && x.trim());
      if (items.length < MIN_ITEMS) return null;
      return { topic: str(d.topic), items, reply: d.reply };
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "mnemonic-title" }, "🧠 Memory tricks"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));
  const privacy = () => el("p", { class: "mn-private" }, "🔒 Your list stays on this computer.");
  const note = () => el("p", { class: "mn-note" }, `💡 ${NOTE}`);

  // Text with the first letter of each word (or of the whole thing) in a highlight <span>.
  function highlighted(text, cls, wholeOnly) {
    const out = el("span", { class: cls });
    const parts = wholeOnly ? [String(text)] : String(text).split(/(\s+)/);
    for (const part of parts) {
      const skip = wholeOnly ? (part.match(/^\s*the\s+(?=\S)/i) || [""])[0].length : 0;
      const i = part.slice(skip).search(/[\p{L}\p{N}]/u);
      if (/^\s*$/.test(part) || i < 0) { out.append(document.createTextNode(part)); continue; }
      const at = skip + i;
      // Each word stays in one piece so a line never breaks right after its highlighted letter.
      out.append(el("span", { class: "mn-w" }, document.createTextNode(part.slice(0, at)), el("span", { class: "mn-initial" }, part[at]), document.createTextNode(part.slice(at + 1))));
    }
    return out;
  }

  function drawInput(message) {
    const was = busy;
    busy = null;
    was?.abort();
    const msg = message ? el("p", { class: "mn-msg", role: "alert" }, message) : null;
    const topic = el("input", { type: "text", maxlength: String(MAX_TOPIC), placeholder: "e.g. The planets in order" });
    topic.value = draft.topic;
    const list = el("textarea", { rows: "8", placeholder: "Mercury\nVenus\nEarth\nMars\n..." });
    list.value = draft.list;
    const count = el("span", { class: "mn-count" });
    const recount = () => {
      const n = parseItems(list.value).length;
      const bad = n > MAX_ITEMS;
      count.className = bad ? "mn-count mn-over" : "mn-count";
      count.textContent = bad ? `${n} items. The most is ${MAX_ITEMS}, so split the list in two.` : n ? `${n} item${n === 1 ? "" : "s"} (${MIN_ITEMS} to ${MAX_ITEMS})` : `${MIN_ITEMS} to ${MAX_ITEMS} items`;
    };
    topic.addEventListener("input", () => { draft.topic = topic.value; msg?.remove(); });
    list.addEventListener("input", () => { draft.list = list.value; msg?.remove(); recount(); });
    recount();
    const go = () => {
      const items = parseItems(draft.list);
      if (items.length < MIN_ITEMS) { drawInput(`Type at least ${MIN_ITEMS} things to remember, one per line.`); return; }
      if (items.length > MAX_ITEMS) { drawInput(`That's ${items.length} items. Memory tricks work best with ${MAX_ITEMS} or fewer, so split the list in two.`); return; }
      run({ topic: draft.topic.trim(), items });
    };
    topic.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    setDialog(head(),
      el("p", { class: "note" }, "Type a list you need to memorize, one thing per line, in order. The AI makes an acronym, a silly sentence and a rhyme, and this page checks that the letters really match. Then test yourself."),
      el("label", { class: "mn-field" }, "Topic (optional)", topic),
      el("label", { class: "mn-field" }, "Things to memorize, one per line", list, count),
      msg,
      privacy(),
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "🧠 Make memory tricks")));
    (message && !message.startsWith("Type") && !message.startsWith("That's") ? null : draft.list ? list : topic)?.focus();
  }

  const forLine = (data) => el("p", { class: "mn-for" }, `${data.topic || "Your list"} · ${data.items.length} items`);
  const itemChips = (items) => el("ol", { class: "mn-items", "aria-label": "Your list" }, ...items.map((x) => el("li", {}, highlighted(x, "", true))));
  const badge = (ok, text) => el("span", { class: `mn-badge ${ok ? "mn-good" : "mn-bad"}` }, text);
  const letters = (items) => el("p", { class: "mn-letters" }, `First letters: ${initials(items).join(" ")}`);

  function card(label, status, ...body) {
    return el("section", { class: "mn-card", "aria-label": label }, el("h3", { class: "mn-label" }, label, status), ...body);
  }

  function tricksView(t, items) {
    const parts = [];
    if (t.acronym) {
      const c = checkAcronym(t.acronym, items);
      parts.push(card("Acronym", badge(c.ok, c.inOrder ? "✓ Letters match" : c.ok ? "✓ Letters match (different order)" : "⚠ Letters don't match — try again"),
        el("div", { class: "mn-word" }, t.acronym), letters(items)));
    } else {
      parts.push(card("Acronym", null, el("p", { class: "mn-none" }, "No real word fits these letters, so use the sentence instead."), letters(items)));
    }
    if (t.sentence) {
      const c = checkSentence(t.sentence, items);
      parts.push(card("Sentence", badge(c.ok, c.ok ? "✓ Letters match" : "⚠ Letters don't match — try again"), highlighted(t.sentence, "mn-sentence", false)));
    }
    if (t.rhyme) parts.push(card("Rhyme or story", null, el("p", { class: "mn-rhyme" }, t.rhyme)));
    return el("div", {}, itemChips(items), ...parts);
  }

  function buttons(data, ready, tricks) {
    const ok = ready && parsedOk(tricks);
    return el("div", { class: "mn-buttons" },
      el("button", { disabled: !ready, onclick: () => run({ topic: data.topic, items: data.items }) }, "🔄 Make new tricks"),
      el("button", { disabled: !ready, onclick: (e) => copyText(e.currentTarget, ok ? toPlainText(tricks, data.items, data.topic) : `${data.reply.trim()}\n\n${NOTE}`) }, "📋 Copy as text"),
      ok ? el("button", { onclick: () => drawTest(data, tricks) }, "✏️ Test yourself") : null,
      el("span", { class: "mn-grow" }),
      el("button", { class: "primary", onclick: () => { forget(); draft = blank(); drawInput(); } }, "📝 New list"));
  }

  function drawResult(data, middle) {
    let body = middle;
    let tricks = null;
    if (!body) {
      tricks = parseTricks(data.reply);
      body = parsedOk(tricks) ? tricksView(tricks, data.items)
        : el("div", {}, itemChips(data.items), el("p", { class: "mn-msg" }, "The AI didn't answer in the usual layout, so here is its answer as it wrote it."),
          el("pre", { class: "mn-raw" }, data.reply.trim()));
    }
    setDialog(head(), forLine(data), body, middle ? null : note(), privacy(), buttons(data, !middle && !!data.reply, tricks));
  }

  function drawTest(data, tricks) {
    const inputs = data.items.map((item, i) => el("input", { type: "text", "aria-label": `Item ${i + 1}`, autocomplete: "off", placeholder: `Starts with ${initials([item])[0] || "?"}` }));
    const marks = data.items.map(() => el("span", { class: "mn-mark", "aria-live": "polite" }));
    const score = el("p", { class: "mn-score", hidden: true, role: "status" });
    const check = () => {
      let right = 0;
      data.items.forEach((item, i) => {
        const ok = checkAnswer(inputs[i].value, item);
        if (ok) right++;
        inputs[i].className = ok ? "mn-right" : "mn-wrong";
        marks[i].className = `mn-mark ${ok ? "mn-good mn-badge" : "mn-bad mn-badge"}`;
        marks[i].textContent = ok ? "✓" : `✗ ${item}`;
      });
      score.hidden = false;
      score.textContent = `Score: ${right} / ${data.items.length}${right === data.items.length ? " 🎉 Perfect!" : ""}`;
    };
    inputs.forEach((input, i) => input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (i + 1 < inputs.length) inputs[i + 1].focus(); else check();
    }));
    const clue = tricks.sentence ? card("Sentence", null, highlighted(tricks.sentence, "mn-sentence", false))
      : tricks.acronym ? card("Acronym", null, el("div", { class: "mn-word" }, tricks.acronym))
        : card("Rhyme or story", null, el("p", { class: "mn-rhyme" }, tricks.rhyme));
    setDialog(head(), forLine(data),
      el("p", { class: "note" }, "Your list is hidden. Use the memory trick to type each item in order, then press Check."),
      clue,
      el("ol", { class: "mn-test" }, ...inputs.map((input, i) => el("li", {}, input, marks[i]))),
      score,
      el("div", { class: "mn-buttons" },
        el("button", { class: "primary", onclick: check }, "✅ Check"),
        el("button", { onclick: () => drawTest(data, tricks) }, "↺ Try again"),
        el("span", { class: "mn-grow" }),
        el("button", { onclick: () => drawResult(data) }, "← Back to tricks")));
    inputs[0]?.focus();
  }

  async function run(input) {
    const data = { topic: input.topic, items: input.items, reply: "" };
    draft = { topic: data.topic, list: data.items.join("\n") };
    if (findModel(currentModel())?.experimental) {
      return drawInput("TinyGPT is a tiny practice model, so it can't make memory tricks. Pick a real chat model in Models, then try again.");
    }
    const model = currentModel();
    const was = busy;
    const ctl = new AbortController();
    busy = ctl;
    was?.abort();
    const live = el("pre", { class: "mn-live" }, "Waiting for the AI...");
    drawResult(data, el("div", {},
      itemChips(data.items),
      el("div", { class: "mn-working" }, el("span", { class: "mn-spin", "aria-hidden": "true" }),
        "Making memory tricks…",
        el("span", { class: "mn-grow" }), el("button", { onclick: () => ctl.abort() }, "■ Stop")),
      el("p", { class: "mn-private" }, "A small model takes a few seconds; a big one can take a minute."),
      live));
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(data.items, data.topic), think: false, auto_code: false }),
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
      drawInput(err.name === "AbortError" ? "Stopped. Press Make memory tricks to try again." : `Couldn't make memory tricks: ${err.message}`);
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) { draft = { topic: saved.topic, list: saved.items.join("\n") }; drawResult(saved); }
    else drawInput();
  }

  dialog.addEventListener("close", () => { busy?.abort(); });
})();
