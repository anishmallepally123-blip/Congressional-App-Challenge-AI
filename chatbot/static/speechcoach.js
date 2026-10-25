// "🎤 Speech coach": a student pastes a speech or presentation script and picks how long it
// should be. The numbers are worked out right here with no AI: word count, speaking time,
// over/under the target, filler words (highlighted in the text) and sentence lengths.
// Then the AI on this computer gives coaching: is the opening strong, three strengths, three
// things to improve and a new opening line. A practice timer counts down the target length.
// The last result is kept in this browser.

// Pure helpers (no page needed), so test_speechcoach.py can run them with Node.
const LocalAISpeechCoach = (() => {
  const MAX_TEXT = 8000;
  const MAX_FIELD = 300;
  const MAX_ITEMS = 3;
  const WPM = 130;
  const WPM_SLOW = 110;
  const WPM_FAST = 150;
  const LONG_SENTENCE = 30;
  const TARGETS = [1, 2, 3, 5];
  const FILLERS = ["um", "uh", "like", "basically", "actually", "literally", "you know", "kind of", "sort of", "really", "very"];

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

  const countWords = (text) => (String(text || "").match(WORD) || []).length;

  // Seconds to say it at a normal pace, and the range from slow to fast speakers.
  function speakingTime(words, wpm = WPM) {
    const n = Math.max(0, Number(words) || 0);
    const at = (rate) => Math.round((n / rate) * 60);
    return { seconds: at(wpm), slow: at(WPM_SLOW), fast: at(WPM_FAST) };
  }

  // "1:05" for 65 seconds.
  function formatTime(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // How the length compares with the target. Within 5% (at least 10 words) counts as on target.
  function targetCheck(words, minutes) {
    const target = Math.round(Math.max(0, Number(minutes) || 0) * WPM);
    const diff = words - target;
    const slack = Math.max(10, Math.round(target * 0.05));
    const status = Math.abs(diff) <= slack ? "on" : diff > 0 ? "over" : "under";
    return { target, diff, status };
  }

  // Filler and weak words, as whole words only ("likely" is not "like"), multiword ones included.
  const FILLER_RE = new RegExp(`(?<![\\p{L}\\p{N}'’])(${FILLERS.map((f) => f.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}'’])`, "giu");
  function findFillers(text) {
    const s = String(text || "");
    const matches = [];
    const counts = {};
    for (const m of s.matchAll(FILLER_RE)) {
      const word = m[1].toLowerCase().replace(/\s+/g, " ");
      matches.push({ word, start: m.index, end: m.index + m[0].length });
      counts[word] = (counts[word] || 0) + 1;
    }
    return { total: matches.length, counts, matches };
  }

  // Sentences end at . ! ? (or a blank line). Gives the average and the longest ones.
  function sentenceStats(text) {
    const s = String(text || "");
    const sentences = [];
    for (const m of s.matchAll(/[^.!?\n]+(?:[.!?]+["'”’)\]]*|\n|$)/g)) {
      const t = m[0].replace(/\s+/g, " ").trim();
      const words = countWords(t);
      if (words) sentences.push({ text: t, words, start: m.index });
    }
    const total = sentences.reduce((a, x) => a + x.words, 0);
    const average = sentences.length ? Math.round((total / sentences.length) * 10) / 10 : 0;
    const longest = [...sentences].sort((a, b) => b.words - a.words || a.start - b.start).slice(0, MAX_ITEMS);
    const long = sentences.filter((x) => x.words > LONG_SENTENCE);
    return { count: sentences.length, average, longest, long };
  }

  // Everything worked out without AI, in one object.
  function analyze(text, minutes) {
    const words = countWords(text);
    return { words, time: speakingTime(words), target: targetCheck(words, minutes), fillers: findFillers(text), sentences: sentenceStats(text) };
  }

  function buildPrompt(text, minutes, stats) {
    const src = prepareText(text).text;
    const st = stats || analyze(src, minutes);
    const system = "You are a friendly speech coach for a high school student. Use simple words and be specific: point to real lines from the script. "
      + "Keep each point to one short sentence.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "STRONG OPENING: yes or no - one sentence saying why\n"
      + "STRENGTHS:\n- first strength\n- second strength\n- third strength\n"
      + "IMPROVEMENTS:\n- first thing to improve\n- second thing to improve\n- third thing to improve\n"
      + "SUGGESTED OPENING: one new opening line the student could say";
    const facts = [
      `Target length: ${formatTime(Math.round((Number(minutes) || 0) * 60))} minutes`,
      `Words: ${st.words} (about ${formatTime(st.time.seconds)} at ${WPM} words per minute)`,
      `Filler words: ${st.fillers.total}`,
      `Average sentence: ${st.sentences.average} words`,
    ];
    const user = `${facts.join("\n")}\n\nSpeech script:\n"""\n${src}\n"""`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const LABEL = /^(strong\s+opening|opening|strengths?|improvements?|things\s+to\s+improve|areas?\s+(?:to|for)\s+improve(?:ment)?|weaknesses|(?:suggested\s+|new\s+|suggested\s+new\s+)opening(?:\s+line)?)\s*(?:\([^)]{0,40}\))?\s*(?:\?\s*:?|:|\s[-–]\s)\s*(.*)$/i;
  const stripQuotes = (s) => s.trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  const isNone = (s) => /^(?:none|n\/a|nothing)\.?$/i.test(s.trim());

  function parseCoaching(text) {
    const out = { opening: "", why: "", strengths: [], improvements: [], newOpening: "" };
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bare = line.replace(BULLET, "");
      const m = bare.match(LABEL);
      if (m) {
        const name = m[1].toLowerCase();
        section = /suggested|new/.test(name) ? "newOpening" : /opening/.test(name) ? "why" : /strength/.test(name) ? "strengths" : "improvements";
        line = m[2].trim();
        if (!line) continue;
      } else line = bare;
      line = line.replace(/^\*+|\*+$/g, "").trim();
      if (!line || !section) continue;
      if (section === "why") {
        if (!out.opening) {
          const yn = line.match(/^(yes|no)\b[\s.,:;!–—-]*/i);
          if (yn) { out.opening = yn[1].toLowerCase(); line = line.slice(yn[0].length).trim(); }
        }
        if (line) out.why = clean(out.why ? `${out.why} ${line}` : line, MAX_FIELD);
      } else if (section === "newOpening") {
        const q = clean(stripQuotes(line), MAX_FIELD);
        if (q && !isNone(q)) out.newOpening = clean(out.newOpening ? `${out.newOpening} ${q}` : q, MAX_FIELD);
      } else {
        const list = out[section];
        const item = clean(line, MAX_FIELD);
        if (item && !isNone(item) && list.length < MAX_ITEMS && !list.includes(item)) list.push(item);
      }
    }
    return out;
  }

  // At least two of the four parts must be there to draw the coaching card.
  const parsedOk = (c) => !!c && [c.opening || c.why, c.strengths.length, c.improvements.length, c.newOpening].filter(Boolean).length >= 2;

  // coaching: a parsed result, the AI's raw answer as a string, or null when there is none.
  function toPlainText(text, minutes, coaching) {
    const st = analyze(text, minutes);
    const t = st.time;
    const g = st.target;
    const lines = [`Speech coach: target ${formatTime(Math.round((Number(minutes) || 0) * 60))} (about ${g.target} words)`, ""];
    lines.push(`Words: ${st.words}`);
    lines.push(`Speaking time: about ${formatTime(t.seconds)} (${formatTime(t.fast)} fast to ${formatTime(t.slow)} slow)`);
    lines.push(g.status === "on" ? "Length: on target" : `Length: ${Math.abs(g.diff)} words ${g.status} the target`);
    const fc = Object.entries(st.fillers.counts).map(([w, n]) => `${w} ×${n}`).join(", ");
    lines.push(`Filler words: ${st.fillers.total}` + (fc ? ` (${fc})` : ""));
    lines.push(`Sentences: ${st.sentences.count}, average ${st.sentences.average} words`);
    if (st.sentences.long.length) lines.push(`Long sentences (over ${LONG_SENTENCE} words): ${st.sentences.long.length}`, ...st.sentences.long.map((x) => `- (${x.words} words) ${x.text}`));
    if (typeof coaching === "string" && coaching.trim()) lines.push("", "Coaching:", coaching.trim());
    else if (coaching && typeof coaching === "object") {
      const c = coaching;
      if (c.opening || c.why) lines.push("", `Strong opening? ${c.opening ? c.opening[0].toUpperCase() + c.opening.slice(1) : "Not sure"}` + (c.why ? `: ${c.why}` : ""));
      if (c.strengths.length) lines.push("", "Strengths:", ...c.strengths.map((x) => `- ${x}`));
      if (c.improvements.length) lines.push("", "Improvements:", ...c.improvements.map((x) => `- ${x}`));
      if (c.newOpening) lines.push("", `Suggested new opening: "${c.newOpening}"`);
    }
    return lines.join("\n");
  }

  return { MAX_TEXT, WPM, WPM_SLOW, WPM_FAST, LONG_SENTENCE, TARGETS, FILLERS, prepareText, countWords, speakingTime, formatTime, targetCheck,
    findFillers, sentenceStats, analyze, buildPrompt, parseCoaching, parsedOk, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAISpeechCoach = LocalAISpeechCoach;
if (typeof module !== "undefined") module.exports = LocalAISpeechCoach;

if (typeof document !== "undefined") (() => {
  const { MAX_TEXT, WPM, WPM_SLOW, WPM_FAST, LONG_SENTENCE, TARGETS, prepareText, formatTime, analyze, buildPrompt, parseCoaching, parsedOk, toPlainText } = LocalAISpeechCoach;
  const SAVE_KEY = "local-ai-speech-coach";
  const fmt = (n) => n.toLocaleString("en-US");
  const EXAMPLE = "Good morning everyone. Um, so today I'm going to talk about why our school should start a community garden. "
    + "Basically, a garden is like a classroom without walls. Students would actually learn biology, math and teamwork while growing real food. "
    + "Last spring, I visited a school in the next town that has a garden, and the students there were really proud of it, you know, because they built it themselves and they take care of it every single week, even during the summer break when nobody makes them come in.\n\n"
    + "A garden also helps our cafeteria. Fresh vegetables taste better and they are very healthy. Our garden could give the cafeteria lettuce, tomatoes and herbs for months each year. "
    + "It is kind of amazing how much food a small space can grow.\n\n"
    + "Some people say it would cost too much. Actually, the local hardware store has offered free seeds and tools, and parents have offered to help build the beds. "
    + "The real cost is just our time, and I think that is worth it.\n\n"
    + "So here is what I am asking. Please sign our petition, join the garden club, and help us plant the first seeds this April. Thank you.";

  const style = document.createElement("style");
  style.textContent = `
    #speech-coach-dialog { width: min(900px, calc(100vw - 32px)); }
    .sc-field { display: block; font-weight: 600; margin-top: 12px; min-width: 0; }
    .sc-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400; resize: vertical;
      line-height: 1.5; min-height: 170px; padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
      background: var(--card); color: var(--text); outline: none; }
    .sc-field textarea:focus, .sc-custom input:focus { border-color: var(--accent); }
    .sc-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .sc-count.sc-over { color: var(--slow); font-weight: 600; }
    .sc-target { margin-top: 12px; font-weight: 600; }
    .sc-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; font-weight: 400; }
    .sc-chips button { padding: 5px 12px; border-radius: 999px; }
    .sc-chips button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .sc-custom { display: inline-flex; align-items: center; gap: 6px; font-size: 0.92em; }
    .sc-custom input { width: 4.5em; font: inherit; padding: 5px 8px; border: 1px solid var(--border-strong); border-radius: 8px;
      background: var(--card); color: var(--text); outline: none; }
    .sc-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .sc-examples button { font-size: 0.95em; padding: 4px 10px; border-radius: 999px; }
    .sc-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .sc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 8px; }
    .sc-stat { padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0; overflow-wrap: anywhere; }
    .sc-stat b { display: block; font-size: 1.45em; line-height: 1.2; }
    .sc-stat small { display: block; color: var(--muted); font-size: 0.8em; margin-top: 2px; }
    .sc-stat.sc-good { border-color: var(--fast); }
    .sc-stat.sc-good b { color: var(--fast); }
    .sc-stat.sc-warn { border-color: var(--slow); }
    .sc-stat.sc-warn b { color: var(--slow); }
    .sc-label { display: block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .sc-head { margin: 18px 0 6px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
    .sc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .sc-tags li { padding: 2px 10px; border-radius: 999px; background: color-mix(in srgb, #f5c542 35%, transparent); font-size: 0.88em; }
    .sc-long { margin: 0; padding-left: 1.3em; line-height: 1.45; overflow-wrap: anywhere; font-size: 0.92em; }
    .sc-long li + li { margin-top: 6px; }
    .sc-long .sc-n { font-weight: 700; color: var(--muted); }
    .sc-long .sc-n.sc-bad { color: var(--slow); }
    .sc-text { max-height: 240px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 0;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.92em; }
    .sc-text mark { background: color-mix(in srgb, #f5c542 55%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
    .sc-note { margin: 6px 0 0; font-size: 0.82em; color: var(--muted); }
    .sc-coach { margin-top: 18px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid var(--border-strong); line-height: 1.5; overflow-wrap: anywhere; }
    .sc-working { display: flex; align-items: center; gap: 12px; font-weight: 600; flex-wrap: wrap; }
    .sc-working .sc-grow { flex: 1; }
    .sc-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: sc-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes sc-spin { to { transform: rotate(360deg); } }
    .sc-live { max-height: 180px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted);
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; }
    .sc-verdict { display: inline-block; padding: 1px 10px; border-radius: 999px; font-weight: 700; font-size: 0.85em; margin-right: 6px; color: #fff; background: var(--muted); }
    .sc-verdict.sc-yes { background: var(--fast); }
    .sc-verdict.sc-no { background: var(--slow); }
    .sc-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .sc-col { padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); min-width: 0; }
    .sc-col ul { margin: 0; padding-left: 1.2em; }
    .sc-col li + li { margin-top: 4px; }
    .sc-opening { margin: 12px 0 0; padding: 10px 14px; border-left: 4px solid var(--accent); background: var(--accent-soft); border-radius: 10px; }
    .sc-opening blockquote { margin: 0; font-style: italic; font-size: 1.05em; }
    .sc-raw { white-space: pre-wrap; margin: 6px 0 0; }
    .sc-timer { margin-top: 18px; padding: 12px 14px; border-radius: 12px; border: 1.5px dashed var(--border-strong); }
    .sc-clock { font-size: 2.2em; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .sc-clock.sc-done { color: var(--slow); }
    .sc-bar { height: 10px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 8px 0 10px; }
    .sc-bar span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.25s linear; }
    .sc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .sc-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .sc-buttons .sc-grow { flex: 1; }
    #speech-coach-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 640px) {
      .sc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .sc-cols { grid-template-columns: minmax(0, 1fr); }
    }`;
  document.head.append(style);

  const link = el("button", { id: "speech-coach-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🎤 Speech coach");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "speech-coach-dialog", "aria-labelledby": "speech-coach-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  let timer = null; // the practice timer's interval
  let draft = { text: "", minutes: 2 };

  const stopTimer = () => { clearInterval(timer); timer = null; };
  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && typeof d.text === "string" && d.text && typeof d.reply === "string" && Number(d.minutes) > 0 ? d : null;
    } catch { return null; }
  };
  const minutesText = (m) => (Number.isInteger(m) ? `${m} min` : formatTime(m * 60));

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "speech-coach-title" }, "🎤 Speech coach"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    stopTimer();
    const area = el("textarea", { rows: "9", placeholder: "Paste your speech or presentation script here…" });
    area.value = draft.text;
    const count = el("span", { class: "sc-count", "aria-live": "polite" });
    const recount = () => {
      const n = area.value.trim().length;
      count.className = n > MAX_TEXT ? "sc-count sc-over" : "sc-count";
      count.textContent = n > MAX_TEXT ? `${fmt(n)} characters: only the first ${fmt(MAX_TEXT)} will be checked` : `${fmt(n)} / ${fmt(MAX_TEXT)} characters`;
    };
    area.addEventListener("input", () => { draft.text = area.value; recount(); });
    recount();

    const custom = el("input", { type: "number", min: "0.5", max: "60", step: "0.5", "aria-label": "Custom length in minutes" });
    if (!TARGETS.includes(draft.minutes)) custom.value = String(draft.minutes);
    const chips = TARGETS.map((m) => el("button", { type: "button", "aria-pressed": String(draft.minutes === m && !custom.value),
      onclick: () => { draft.minutes = m; custom.value = ""; mark(); } }, `${m} min`));
    const mark = () => chips.forEach((c, i) => c.setAttribute("aria-pressed", String(!custom.value && TARGETS[i] === draft.minutes)));
    custom.addEventListener("input", () => { const v = Number(custom.value); if (v > 0) draft.minutes = Math.min(60, v); mark(); });

    const go = () => {
      if (!area.value.trim()) return drawInput("Paste your speech first.");
      if (area.value.trim().split(/\s+/).length < 15) return drawInput("That's very short. Paste at least a few sentences of your speech.");
      if (custom.value && !(Number(custom.value) > 0)) return drawInput("Type a custom length in minutes, like 4 or 2.5.");
      run({ text: area.value, minutes: draft.minutes });
    };
    setDialog(head(),
      el("p", { class: "note" }, "Paste a speech or presentation script. You'll see how long it takes to say, filler words and long sentences right away, then the AI on this computer gives coaching tips."),
      el("label", { class: "sc-field" }, "Your speech", area, count),
      el("div", { class: "sc-target", role: "group", "aria-label": "Target length" }, "Target length",
        el("div", { class: "sc-chips" }, ...chips, el("label", { class: "sc-custom" }, "Custom:", custom, "min"))),
      el("div", { class: "sc-examples" }, "Try:",
        el("button", { type: "button", onclick: () => { draft = { text: EXAMPLE, minutes: 2 }; drawInput(); } }, "Example: community garden speech")),
      message ? el("p", { class: "sc-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Check my speech")));
    area.focus();
  }

  // The script with every filler word wrapped in <mark>, built from text nodes only.
  function textBox(text, matches) {
    const box = el("p", { class: "sc-text", tabindex: "0", "aria-label": "Your speech with filler words highlighted" });
    let at = 0;
    for (const m of matches) {
      box.append(text.slice(at, m.start), el("mark", {}, text.slice(m.start, m.end)));
      at = m.end;
    }
    box.append(text.slice(at));
    return box;
  }

  function stat(cls, label, big, small) {
    return el("div", { class: cls ? `sc-stat ${cls}` : "sc-stat", role: "listitem" }, el("span", { class: "sc-label" }, label), el("b", {}, big), el("small", {}, small));
  }

  function statsView(data) {
    const st = analyze(data.text, data.minutes);
    const g = st.target;
    const s = st.sentences;
    const lengthBig = g.status === "on" ? "On target" : `${fmt(Math.abs(g.diff))} ${g.status}`;
    const lengthSmall = g.status === "on" ? `Close to the ${fmt(g.target)} words for ${minutesText(data.minutes)}`
      : g.status === "over" ? `Cut about ${fmt(g.diff)} words to fit ${minutesText(data.minutes)} (${fmt(g.target)} words)`
        : `Add about ${fmt(-g.diff)} words to fill ${minutesText(data.minutes)} (${fmt(g.target)} words)`;
    const fillerCls = st.fillers.total === 0 ? "sc-good" : st.fillers.total > Math.max(3, st.words / 50) ? "sc-warn" : "";
    const tags = Object.entries(st.fillers.counts).sort((a, b) => b[1] - a[1]);
    return [
      el("div", { class: "sc-stats", role: "list", "aria-label": "Speech numbers" },
        stat("", "📝 Words", fmt(st.words), `${fmt(s.count)} sentences`),
        stat("", "⏱️ Speaking time", formatTime(st.time.seconds), `${formatTime(st.time.fast)} fast to ${formatTime(st.time.slow)} slow`),
        stat(g.status === "on" ? "sc-good" : "sc-warn", `🎯 Target ${minutesText(data.minutes)}`, lengthBig, lengthSmall),
        stat(fillerCls, "🙊 Filler words", fmt(st.fillers.total), `Average sentence: ${s.average} words`)),
      el("p", { class: "sc-note" }, `Speaking time uses ${WPM} words per minute; slow speakers say about ${WPM_SLOW}, fast ones about ${WPM_FAST}.`),
      tags.length ? el("div", { class: "sc-head" }, "Filler and weak words") : null,
      tags.length ? el("ul", { class: "sc-tags" }, ...tags.map(([w, n]) => el("li", {}, `“${w}” ×${n}`))) : null,
      s.longest.length ? el("div", { class: "sc-head" }, s.long.length ? `Longest sentences (${s.long.length} over ${LONG_SENTENCE} words: try splitting them)` : "Longest sentences (all under 30 words 👍)") : null,
      s.longest.length ? el("ol", { class: "sc-long" }, ...s.longest.map((x) => el("li", {},
        el("span", { class: x.words > LONG_SENTENCE ? "sc-n sc-bad" : "sc-n" }, `${x.words} words${x.words > LONG_SENTENCE ? " ⚠" : ""}: `), x.text))) : null,
      el("div", { class: "sc-head" }, tags.length ? "Your speech (filler words highlighted)" : "Your speech"),
      textBox(data.text, st.fillers.matches),
      data.truncated ? el("p", { class: "sc-note" }, `Your speech was ${fmt(data.length || 0)} characters, so only the first ${fmt(MAX_TEXT)} were checked.`) : null,
    ];
  }

  function coachingView(reply) {
    const c = parseCoaching(reply);
    if (!parsedOk(c)) return [el("span", { class: "sc-label" }, "🧑‍🏫 Coaching"), el("p", { class: "sc-raw" }, reply.trim() || "(no answer)")];
    const list = (title, items) => el("div", { class: "sc-col" }, el("span", { class: "sc-label" }, title),
      items.length ? el("ul", {}, ...items.map((x) => el("li", {}, x))) : el("p", { class: "sc-note" }, "None given."));
    return [
      el("span", { class: "sc-label" }, "🧑‍🏫 Coaching"),
      c.opening || c.why ? el("p", { style: "margin:4px 0 0" }, el("b", {}, "Strong opening? "),
        el("span", { class: c.opening === "yes" ? "sc-verdict sc-yes" : c.opening === "no" ? "sc-verdict sc-no" : "sc-verdict" },
          c.opening === "yes" ? "Yes" : c.opening === "no" ? "No" : "Maybe"), c.why) : null,
      el("div", { class: "sc-cols" }, list("💪 Strengths", c.strengths), list("🔧 Improvements", c.improvements)),
      c.newOpening ? el("div", { class: "sc-opening" }, el("span", { class: "sc-label" }, "✨ Suggested new opening"), el("blockquote", {}, `“${c.newOpening}”`)) : null,
    ];
  }

  function timerView(minutes) {
    const total = Math.round(minutes * 60) * 1000;
    let left = total;
    let endAt = 0;
    const clock = el("div", { class: "sc-clock", role: "timer", "aria-live": "off" }, formatTime(total / 1000));
    const fill = el("span", {});
    const bar = el("div", { class: "sc-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": "Time used" }, fill);
    const status = el("span", { class: "note", "aria-live": "polite" }, `Read your speech out loud. Aim to finish close to ${minutesText(minutes)}.`);
    const startBtn = el("button", { class: "primary" }, "▶ Start");
    const paint = () => {
      const pct = Math.min(100, Math.round(((total - left) / total) * 100));
      clock.textContent = formatTime(Math.ceil(left / 1000));
      fill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(pct));
    };
    const tick = () => {
      left = Math.max(0, endAt - Date.now());
      paint();
      if (left <= 0) { stopTimer(); clock.classList.add("sc-done"); startBtn.textContent = "▶ Start again"; status.textContent = "⏰ Time's up! How close were you?"; }
    };
    startBtn.addEventListener("click", () => {
      if (timer) { stopTimer(); startBtn.textContent = "▶ Resume"; status.textContent = "Paused."; return; }
      if (left <= 0) { left = total; clock.classList.remove("sc-done"); }
      stopTimer();
      endAt = Date.now() + left;
      timer = setInterval(tick, 250);
      startBtn.textContent = "⏸ Pause";
      status.textContent = "Go! The bar fills up as time runs out.";
    });
    const reset = el("button", { onclick: () => { stopTimer(); left = total; clock.classList.remove("sc-done"); startBtn.textContent = "▶ Start"; status.textContent = "Reset. Press Start when you're ready."; paint(); } }, "↺ Reset");
    return el("div", { class: "sc-timer" }, el("span", { class: "sc-label" }, `⏱️ Practice timer: ${minutesText(minutes)}`), clock, bar,
      el("div", { class: "sc-row" }, startBtn, reset, status));
  }

  // The stats right away; the coaching box fills in when the AI answers (or says why it can't).
  function drawResult(data, coachBox) {
    stopTimer();
    const box = coachBox || el("div", { class: "sc-coach" }, ...(data.reply ? coachingView(data.reply)
      : [el("span", { class: "sc-label" }, "🧑‍🏫 Coaching"), el("p", { class: "sc-note" }, data.note || "No AI coaching for this one. The numbers above are worked out without AI.")]));
    const timerSlot = el("div", {});
    const copy = () => {
      const c = data.reply ? parseCoaching(data.reply) : null;
      return toPlainText(data.text, data.minutes, c && parsedOk(c) ? c : data.reply || null);
    };
    setDialog(head(),
      ...statsView(data),
      box,
      timerSlot,
      el("div", { class: "sc-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, copy()) }, "📋 Copy as text"),
        el("button", { onclick: (e) => { if (!timerSlot.firstChild) timerSlot.append(timerView(data.minutes)); e.currentTarget.remove(); timerSlot.scrollIntoView({ block: "nearest" }); } }, "⏱️ Practice timer"),
        el("span", { class: "sc-grow" }),
        el("button", { onclick: () => { busy?.abort(); draft = { text: data.text, minutes: data.minutes }; drawInput(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { busy?.abort(); draft = { text: "", minutes: data.minutes }; drawInput(); } }, "New speech")));
  }

  async function run(input) {
    const model = currentModel();
    const prep = prepareText(input.text);
    const data = { text: prep.text, truncated: prep.truncated, length: prep.length, minutes: input.minutes, reply: "", at: Date.now() };
    if (findModel(currentModel())?.experimental) {
      data.note = "TinyGPT is a tiny practice model, so it can't coach a speech. The numbers above are worked out without AI. Pick a real chat model in Models to get coaching tips too.";
      save(data);
      return drawResult(data);
    }
    const ctl = new AbortController();
    busy = ctl;
    const live = el("pre", { class: "sc-live" }, "Waiting for the AI...");
    const box = el("div", { class: "sc-coach" },
      el("div", { class: "sc-working" }, el("span", { class: "sc-spin", "aria-hidden": "true" }), "Coach is reading your speech…",
        el("span", { class: "sc-grow" }), el("button", { onclick: () => ctl.abort() }, "■ Stop")),
      el("p", { class: "sc-note" }, "A small model takes a few seconds; a big one can take a minute."),
      live);
    drawResult(data, box);
    const show = (...nodes) => box.replaceChildren(...nodes.filter((n) => n != null));
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(prep.text, input.minutes), think: false, auto_code: false }),
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
      show(...coachingView(data.reply));
    } catch (err) {
      data.note = err.name === "AbortError" ? "Coaching stopped. The numbers above are still right. Press Back and Check my speech to try again."
        : `Couldn't get coaching: ${err.message}. The numbers above are still right.`;
      save(data);
      show(el("span", { class: "sc-label" }, "🧑‍🏫 Coaching"), el("p", { class: "sc-note" }, data.note));
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) { draft = { text: saved.text, minutes: Number(saved.minutes) }; drawResult(saved); }
    else drawInput();
  }

  dialog.addEventListener("close", () => { busy?.abort(); stopTimer(); });
})();
