// "🧐 Fact or opinion": a media-literacy check. The student pastes a news article, speech, ad or post and
// the AI on this computer labels each sentence as a FACT (a claim you can check), an OPINION, or LOADED
// (an opinion using emotional words), then lists questions to ask about the source. It does not say
// whether the facts are true, only which claims are worth checking.
// The last check is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_factopinion.py can run them with Node.
const FactOpinion = (() => {
  const MAX_CHARS = 4000;
  const MAX_SENTENCES = 40;
  const KINDS = ["fact", "opinion", "loaded"];

  // Words that end in a period without ending a sentence.
  const ABBREV = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "ft", "vs", "etc", "inc", "ltd", "co", "corp",
    "gov", "sen", "rep", "gen", "col", "capt", "lt", "sgt", "rev", "vol", "fig", "approx", "dept", "est", "ave", "blvd", "rd",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "e.g", "i.e", "a.m", "p.m"]);
  const CLOSERS = "\"'”’)]»";

  function splitParagraph(par) {
    const out = [];
    let start = 0;
    const re = /[.!?…]+/g;
    let m;
    while ((m = re.exec(par))) {
      let end = m.index + m[0].length;
      while (end < par.length && CLOSERS.includes(par[end])) end++;
      // Only a space (or the end) after the mark can end a sentence: "3.5" and "U.S.-made" stay whole.
      if (end < par.length && !/\s/.test(par[end])) continue;
      const rest = par.slice(end).trimStart();
      if (rest && /^[a-z,;:]/.test(rest)) continue; // "a.m. on Tuesday", "Wow! said Kim" (lowercase goes on)
      if (m[0] === ".") {
        const word = (par.slice(start, m.index).match(/(\S+)$/) || ["", ""])[1].replace(/^["'“‘(\[]+/, "");
        const low = word.toLowerCase();
        if (ABBREV.has(low) || (low === "no" && /^\d/.test(rest))) continue;
        if (/^(?:[a-z]\.)+[a-z]$/i.test(word)) continue; // U.S, D.C, a.m: initialisms with dots
        if (/^[A-Z]$/.test(word)) continue; // a middle initial: "John F. Smith"
      }
      const s = par.slice(start, end).trim();
      if (s) out.push(s);
      start = end;
      re.lastIndex = end;
    }
    const tail = par.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  function splitSentences(text, limit = MAX_SENTENCES) {
    const out = [];
    for (const par of String(text || "").replace(/\r/g, "").split(/\n+/)) {
      const clean = par.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      for (const s of splitParagraph(clean)) {
        // A lone quote mark or bullet is not a sentence; glue it to the previous one.
        if (!/[A-Za-z0-9]/.test(s) && out.length) out[out.length - 1] += ` ${s}`;
        else out.push(s);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  function buildPrompt(sentences) {
    const list = sentences.slice(0, MAX_SENTENCES).map((s, i) => `${i + 1}: ${s}`).join("\n");
    const system = "You teach media literacy to students. You read numbered sentences from an article, speech, ad or post and label each one.\n"
      + "FACT = a claim that could be checked with evidence (numbers, dates, events, who said what). It may be true or false; do not judge that.\n"
      + "OPINION = a belief, judgment, prediction or feeling that cannot be proven.\n"
      + "LOADED = an opinion that uses emotional or loaded words to persuade.\n"
      + "Answer in exactly this format and nothing else, one line for every sentence number:\n"
      + "1: FACT — short reason\n"
      + "2: OPINION — short reason\n"
      + "3: LOADED — short reason naming the loaded words in quotes, like \"disaster\"\n"
      + "ASK:\n"
      + "- a question the reader should ask about the source or what is missing (write 2 to 4 questions)";
    const user = `Label every sentence (${Math.min(sentences.length, MAX_SENTENCES)} in total).\n\nSENTENCES:\n${list}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const KIND_WORDS = [["loaded", /^(?:loaded|emotional|biased|persuasive)\b/i], ["opinion", /^(?:opinion|judg(?:e)?ment|belief)\b/i],
    ["fact", /^(?:fact(?:ual)?|claim|checkable)\b/i]];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const NUMBERED = /^(?:sentence|line|s)?\s*#?\s*(\d{1,2})\s*(?:[:.)\]|–—-]|\s(?=[a-z]))\s*(.*)$/i;
  const ASK_HEAD = /^(?:ask|questions?(?:\s+to\s+ask)?|questions? for the reader)\s*[:\-–]?\s*(.*)$/i;

  function quotedWords(reason) {
    const words = [];
    const re = /["“”]([^"“”]{1,40})["“”]|(?:^|[\s(,:])['‘]([^'‘’]{1,40})['’](?=[\s,.;:)!?]|$)/g;
    let m;
    while ((m = re.exec(reason))) {
      const w = (m[1] || m[2] || "").trim();
      if (w && !words.some((x) => x.toLowerCase() === w.toLowerCase())) words.push(w);
    }
    return words;
  }

  function parseLabels(text, count) {
    const n = Math.max(0, Math.min(Number(count) || 0, MAX_SENTENCES));
    const labels = Array.from({ length: n }, (_, i) => ({ n: i + 1, kind: "unknown", reason: "", words: [] }));
    const seen = new Set();
    const questions = [];
    let inAsk = false;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").replace(/^\s*>\s*/, "").trim();
      if (!line) continue;
      const head = line.replace(BULLET, "").match(ASK_HEAD);
      if (head && !NUMBERED.test(line)) {
        inAsk = true;
        line = head[1].trim();
        if (!line) continue;
      }
      if (!inAsk) {
        const num = line.replace(/^[-*•]\s+/, "").match(NUMBERED);
        if (!num) continue;
        const i = Number(num[1]);
        if (i < 1 || i > n || seen.has(i)) continue;
        let rest = num[2].replace(/^[\[(*\s]+/, "");
        const kind = KIND_WORDS.find(([, re]) => re.test(rest));
        if (!kind) continue;
        rest = rest.replace(kind[1], "").replace(/^[\])*\s]*(?:[—–:|,.-]+\s*)?/, "").trim();
        seen.add(i);
        labels[i - 1] = { n: i, kind: kind[0], reason: rest, words: kind[0] === "loaded" ? quotedWords(rest) : [] };
      } else {
        const q = line.replace(BULLET, "").replace(/^\*\s*|\s*\*$/g, "").trim();
        if (q && !/^(?:none|n\/a)\.?$/i.test(q) && questions.length < 6) questions.push(q);
      }
    }
    return { labels, questions };
  }

  const parsedOk = (r) => !!(r && r.labels.some((l) => l.kind !== "unknown"));

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Split a sentence into [{text, bold}] pieces, bolding each loaded word that really appears in it.
  function markWords(sentence, words) {
    const s = String(sentence || "");
    const spans = [];
    for (const w of (words || []).map((x) => String(x || "").trim()).filter(Boolean).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "giu");
      let m;
      while ((m = re.exec(s))) {
        const a = m.index, b = a + m[0].length;
        if (!spans.some(([x, y]) => a < y && b > x)) spans.push([a, b]);
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    const out = [];
    let at = 0;
    for (const [a, b] of spans) {
      if (a > at) out.push({ text: s.slice(at, a), bold: false });
      out.push({ text: s.slice(a, b), bold: true });
      at = b;
    }
    if (at < s.length || !out.length) out.push({ text: s.slice(at), bold: false });
    return out;
  }

  function counts(labels) {
    const c = { fact: 0, opinion: 0, loaded: 0, unknown: 0 };
    for (const l of labels || []) c[KINDS.includes(l.kind) ? l.kind : "unknown"]++;
    return c;
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const countsText = (c) => [plural(c.fact, "fact to check", "facts to check"), plural(c.opinion, "opinion", "opinions"), `${c.loaded} loaded`].join(" · ");

  const TAGS = { fact: "FACT", opinion: "OPINION", loaded: "LOADED", unknown: "?" };
  function asText(sentences, result) {
    const lines = sentences.map((s, i) => {
      const l = result.labels[i] || { kind: "unknown", reason: "" };
      return `${i + 1}. [${TAGS[l.kind] || "?"}] ${s}${l.reason ? ` (${l.reason})` : ""}`;
    });
    lines.push("", countsText(counts(result.labels)));
    if (result.questions.length) lines.push("", "Questions to ask:", ...result.questions.map((q) => `- ${q}`));
    lines.push("", "Facts here are claims you can check, not things the AI has confirmed are true.");
    return lines.join("\n");
  }

  const EXAMPLE = "The Maple Grove school board voted 5 to 2 on Tuesday to move the high school start time from 7:30 a.m. to 8:15 a.m. next fall. "
    + "The change will cost about $40,000 a year for extra bus routes, according to the district's budget office. "
    + "Dr. Lena Ortiz, who chairs the board, said the later start is \"the right choice for our students.\" "
    + "Some parents called the plan a disaster that will wreck family schedules. "
    + "A 2023 district survey found that 62% of students sleep less than seven hours on school nights. "
    + "Honestly, any board that ignores teenagers' sleep is failing them. "
    + "Supporters say it is the smartest decision the board has made in years.";

  return { MAX_CHARS, MAX_SENTENCES, EXAMPLE, splitSentences, buildPrompt, parseLabels, parsedOk, markWords, counts, countsText, asText };
})();
if (typeof module !== "undefined") module.exports = FactOpinion;

if (typeof document !== "undefined") (() => {
  const { MAX_CHARS, MAX_SENTENCES, EXAMPLE, splitSentences, buildPrompt, parseLabels, parsedOk, markWords, counts, countsText, asText } = FactOpinion;
  const SAVE_KEY = "local-ai-fact-opinion";
  const fmt = (n) => n.toLocaleString("en-US");

  const style = document.createElement("style");
  style.textContent = `
    #fo-dialog { width: min(700px, calc(100vw - 32px)); --fo-fact: var(--good); --fo-opinion: var(--slow); --fo-loaded: var(--danger); }
    #fo-dialog label.fo-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #fo-dialog textarea { display: block; width: 100%; margin-top: 6px; min-height: 200px; max-height: 50vh; resize: vertical;
      font: inherit; font-weight: 400; line-height: 1.5; padding: 10px 12px; border: 1px solid var(--border-strong);
      border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #fo-dialog textarea:focus { border-color: var(--accent); }
    .fo-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .fo-count.fo-full { color: var(--accent); font-weight: 600; }
    .fo-example { background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 0.9em;
      text-decoration: underline; cursor: pointer; }
    .fo-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .fo-reading { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .fo-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: fo-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes fo-spin { to { transform: rotate(360deg); } }
    .fo-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .fo-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 0; font-size: 0.88em; color: var(--muted); }
    .fo-legend span { display: inline-flex; align-items: center; gap: 6px; }
    .fo-legend i { width: 14px; height: 14px; border-radius: 4px; border-bottom: 3px solid; flex-shrink: 0; }
    .fo-legend-total { width: 100%; color: var(--text); font-weight: 600; font-size: 1.05em; }
    .fo-text { margin: 12px 0 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card);
      line-height: 1.9; overflow-wrap: anywhere; }
    .fo-sent { cursor: pointer; border-radius: 3px; padding: 1px 2px; color: var(--text); text-decoration: none;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .fo-sent:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .fo-sent sup { font-size: 0.65em; color: var(--muted); margin-right: 2px; font-weight: 600; }
    .fo-fact { background: color-mix(in srgb, var(--fo-fact) 14%, transparent); border-bottom: 2px solid var(--fo-fact); }
    .fo-opinion { background: color-mix(in srgb, var(--fo-opinion) 18%, transparent); border-bottom: 2px solid var(--fo-opinion); }
    .fo-loaded { background: color-mix(in srgb, var(--fo-loaded) 14%, transparent); border-bottom: 2px solid var(--fo-loaded); }
    .fo-unknown { border-bottom: 1px dashed var(--border-strong); }
    .fo-sent b { font-weight: 750; text-decoration: underline wavy var(--fo-loaded); text-underline-offset: 3px; }
    .fo-sent.fo-open { outline: 2px solid var(--border-strong); }
    .fo-reason { display: block; margin: 6px 0 8px; padding: 8px 12px; border-radius: 10px; font-size: 0.9em; line-height: 1.45;
      background: var(--panel); border-left: 4px solid var(--border-strong); }
    .fo-reason strong { margin-right: 6px; }
    .fo-reason.fo-k-fact { border-left-color: var(--fo-fact); }
    .fo-reason.fo-k-opinion { border-left-color: var(--fo-opinion); }
    .fo-reason.fo-k-loaded { border-left-color: var(--fo-loaded); }
    .fo-tip { margin: 6px 0 0; font-size: 0.82em; color: var(--muted); }
    .fo-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--accent); margin: 18px 0 6px; }
    .fo-list { margin: 0; padding-left: 22px; line-height: 1.55; }
    .fo-list li { margin: 4px 0; overflow-wrap: anywhere; }
    .fo-caveat { margin: 16px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 0.9em; line-height: 1.45; }
    .fo-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 12px 0 0; font-size: 0.9em; color: var(--muted); }
    .fo-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .fo-buttons .fo-grow { flex: 1; }
    #fo-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "fo-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🧐 Fact or opinion");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "fo-dialog", "aria-labelledby": "fo-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is reading
  let state = { draft: "", result: null, view: "input" };

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d !== "object") return;
      const r = d.result;
      state = {
        draft: typeof d.draft === "string" ? d.draft.slice(0, MAX_CHARS) : "",
        result: r && typeof r.reply === "string" && Array.isArray(r.sentences) ? r : null,
        view: d.view === "result" ? "result" : "input",
      };
    } catch { /* nothing saved */ }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "fo-title" }, "🧐 Fact or opinion"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    state.view = "input";
    save();
    const area = el("textarea", { id: "fo-text", maxlength: String(MAX_CHARS), placeholder: "Paste a news article, a speech, an ad or a social media post...", "aria-label": "Text to check" });
    area.value = state.draft;
    const count = el("span", { class: "fo-count", "aria-live": "polite" });
    const update = () => {
      state.draft = area.value;
      save();
      const n = area.value.trim() ? splitSentences(area.value).length : 0;
      count.textContent = `${fmt(area.value.length)} / ${fmt(MAX_CHARS)} characters · ${n >= MAX_SENTENCES ? `${MAX_SENTENCES}+` : n} sentence${n === 1 ? "" : "s"}`;
      count.classList.toggle("fo-full", area.value.length >= MAX_CHARS || n >= MAX_SENTENCES);
    };
    area.addEventListener("input", update);
    update();
    const example = el("button", { type: "button", class: "fo-example", onclick: () => { area.value = EXAMPLE; update(); dialog.querySelector(".fo-msg")?.remove(); area.focus(); } }, "Try an example");
    const go = () => (area.value.trim() ? check(area.value.trim()) : drawInput("Paste some text first, or press Try an example."));
    setDialog(head(),
      el("p", { class: "note" }, "The AI on this computer marks each sentence as a fact you can check, an opinion, or an opinion with loaded words, and suggests questions to ask about the source."),
      el("label", { class: "fo-field" }, "Article, speech, ad or post", area, count),
      example,
      message ? el("p", { class: "fo-msg", role: "alert" }, message) : null,
      el("p", { class: "note" }, `Checks up to ${MAX_SENTENCES} sentences. It does not tell you if a fact is true; it shows you which claims to look up.`),
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Check it")));
    area.focus();
  }

  function drawReading(live) {
    setDialog(head(),
      el("div", { class: "fo-reading" }, el("span", { class: "fo-spin", "aria-hidden": "true" }), "Reading…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  const NAMES = { fact: "Fact to check", opinion: "Opinion", loaded: "Loaded words", unknown: "Not labeled" };

  function drawResult(data) {
    state.view = "result";
    save();
    const sentences = data.sentences;
    const r = parseLabels(data.reply, sentences.length);
    const ok = parsedOk(r);
    const c = counts(r.labels);
    const box = el("div", { class: "fo-text" });
    sentences.forEach((s, i) => {
      const l = r.labels[i] || { n: i + 1, kind: "unknown", reason: "", words: [] };
      const span = el("span", { class: `fo-sent fo-${l.kind}`, role: "button", tabindex: "0", "aria-expanded": "false",
        title: NAMES[l.kind], "aria-label": `Sentence ${i + 1}, ${NAMES[l.kind]}` },
        el("sup", {}, String(i + 1)),
        ...markWords(s, l.words).map((p) => (p.bold ? el("b", {}, p.text) : p.text)));
      const toggle = () => {
        const next = span.nextElementSibling;
        if (next?.classList.contains("fo-reason")) { next.remove(); span.classList.remove("fo-open"); span.setAttribute("aria-expanded", "false"); return; }
        span.classList.add("fo-open");
        span.setAttribute("aria-expanded", "true");
        span.after(el("span", { class: `fo-reason fo-k-${l.kind}` }, el("strong", {}, `${NAMES[l.kind]}.`), " ",
          l.reason || (l.kind === "unknown" ? "The AI didn't label this sentence." : "No reason given.")));
      };
      span.addEventListener("click", toggle);
      span.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      box.append(span, " ");
    });
    const legend = el("div", { class: "fo-legend", "aria-label": "Legend" },
      el("span", { class: "fo-legend-total" }, countsText(c)),
      el("span", {}, el("i", { class: "fo-fact" }), "Fact: a claim you can check"),
      el("span", {}, el("i", { class: "fo-opinion" }), "Opinion"),
      el("span", {}, el("i", { class: "fo-loaded" }), "Loaded: opinion with emotional words"));
    const plain = ok ? asText(sentences, r) : data.reply;
    setDialog(head(),
      ok ? legend : el("p", { class: "fo-msg", role: "alert" }, "The AI's answer wasn't in the usual format, so here is what it said. Try again, or pick a bigger model."),
      box,
      ok ? el("p", { class: "fo-tip" }, "Tap a sentence to see why it got its label.") : null,
      ok ? null : el("p", { class: "fo-raw" }, data.reply),
      data.cut ? el("p", { class: "note" }, `Only the first ${MAX_SENTENCES} sentences were checked.`) : null,
      ok && r.questions.length ? el("span", { class: "fo-sec" }, "Questions to ask") : null,
      ok && r.questions.length ? el("ul", { class: "fo-list" }, ...r.questions.map((q) => el("li", {}, q))) : null,
      el("p", { class: "fo-caveat" }, "Facts here are claims you can check, not things the AI has confirmed are true."),
      el("div", { class: "fo-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy"),
        el("span", { class: "fo-grow" }),
        el("button", { onclick: () => { state.draft = data.text || ""; drawInput(); } }, "Edit text"),
        el("button", { class: "primary", onclick: () => { state.draft = ""; state.result = null; drawInput(); } }, "New check")));
  }

  async function check(text) {
    const model = currentModel();
    if (findModel(model)?.experimental) return drawInput("TinyGPT is a tiny practice model and can't sort facts from opinions. Pick a real chat model in Models first, then try again.");
    const sentences = splitSentences(text);
    if (!sentences.length) return drawInput("Paste some sentences first.");
    const cut = splitSentences(text, MAX_SENTENCES + 1).length > MAX_SENTENCES;
    busy = new AbortController();
    const live = el("pre", { class: "fo-live" }, "Waiting for the AI...");
    drawReading(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(sentences), think: false, auto_code: false }),
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
      state.result = { text, sentences, cut, reply: reply.trim(), at: Date.now() };
      state.draft = text;
      save();
      if (dialog.open) drawResult(state.result);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press Check it to try again.");
      else drawInput(`Couldn't check it: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    load();
    dialog.showModal();
    if (state.view === "result" && state.result) drawResult(state.result);
    else drawInput();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
