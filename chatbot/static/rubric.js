// "🎯 Rubric check": before turning in an assignment, the student pastes their work and the teacher's
// rubric. The AI on this computer checks each rubric line, quotes evidence from the student's own
// text and suggests one fix. It gives feedback only; it never rewrites the work.
// Quotes are checked against the work, so a quote the AI made up shows a warning.
// The inputs and the last check are kept in this browser so reopening shows them again.

// Pure helpers (no page needed), so test_rubric.py can run them with Node.
const RubricCheck = (() => {
  const MAX_CHARS = 6000;
  const MAX_CRITERIA = 12;
  const BULLET = /^\s*(?:[-*•‣–]|\d{1,2}[.)]|\[\s?\])\s+/;

  // One criterion per line; bullets and numbers in front are dropped, blank lines skipped.
  function splitCriteria(text) {
    return String(text || "").split(/\r?\n/)
      .map((line) => line.replace(BULLET, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function buildPrompt(work, criteria) {
    const list = criteria.slice(0, MAX_CRITERIA);
    const system = "You are a fair teacher checking a student's work against a rubric before they turn it in. "
      + "Judge each criterion honestly: say MET only if the work clearly does it. "
      + "For evidence, copy a short exact phrase (under 15 words) from the student's work, word for word, or write NONE if nothing in the work shows it. "
      + "Never rewrite the work or write new paragraphs for the student; give one specific suggestion they can do themselves.\n"
      + "Answer in exactly this format, one block per criterion, in order, and nothing else:\n"
      + "CRITERION 1: MET | PARTLY | NOT YET\n"
      + "EVIDENCE: \"short quote\" or NONE\n"
      + "FIX: one specific suggestion";
    const user = `RUBRIC (${list.length} criteria):\n${list.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`
      + `STUDENT'S WORK:\n${String(work).slice(0, MAX_CHARS)}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  function toStatus(text) {
    const t = String(text || "").toLowerCase().replace(/[^a-z ]+/g, " ").trim();
    if (/\bnot\b|\bunmet\b|\bmissing\b|^no\b/.test(t)) return "notyet";
    if (/\bpartl|\bpartial|\bsomewhat\b/.test(t)) return "partly";
    if (/\bmet\b|^yes\b|\bmeets\b/.test(t)) return "met";
    return "unknown";
  }

  const stripQuotes = (s) => s.trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  const isNone = (s) => /^(?:none(?: needed)?|n\/a|no evidence|nothing(?: to fix)?|no (?:fix|change)s? needed)\.?$/i.test(s.trim());

  // The reply split into blocks by "CRITERION n", matched to the rubric lines by number.
  function parseRubric(text, criteria) {
    const found = {};
    let cur = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").replace(BULLET, "").trim();
      if (!line) continue;
      const head = line.match(/^criteri(?:on|a)\s*#?\s*(\d{1,2})\b\s*[:.)\-–]?\s*(.*)$/i);
      if (head) {
        cur = found[Number(head[1])] = { status: toStatus(head[2]), evidence: "", fix: "", field: null };
        continue;
      }
      if (!cur) continue;
      const field = line.match(/^(evidence|quote|fix|suggestion|status)\s*[:\-–]\s*(.*)$/i);
      if (field) {
        const name = field[1].toLowerCase();
        const value = field[2].trim();
        if (name === "status") { cur.status = toStatus(value); cur.field = null; } else {
          cur.field = name === "evidence" || name === "quote" ? "evidence" : "fix";
          cur[cur.field] = value;
        }
      } else if (cur.field) cur[cur.field] = `${cur[cur.field]} ${line}`.trim();
      else if (cur.status === "unknown") cur.status = toStatus(line);
    }
    return criteria.map((criterion, i) => {
      const b = found[i + 1];
      if (!b) return { criterion, status: "unknown", evidence: "", fix: "" };
      const ev = stripQuotes(b.evidence.replace(/^\*|\*$/g, ""));
      const fix = b.fix.replace(/^\*|\*$/g, "").trim();
      return { criterion, status: b.status, evidence: isNone(ev) ? "" : ev, fix: isNone(fix) ? "" : fix };
    });
  }

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

  // Where the quoted phrase sits in the work as [start, end], or null when it isn't there.
  // "..." inside a quote means words were skipped, so each piece must appear in order.
  function findQuote(evidence, work) {
    const parts = stripQuotes(String(evidence || "")).split(/\.\.\.|…/)
      .map((p) => normalize(p).out.replace(/^[\s.,;:!?"']+|[\s.,;:!?"']+$/g, ""))
      .filter(Boolean);
    if (!parts.length || isNone(parts.join(" "))) return null;
    const w = normalize(work);
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

  const checkQuote = (evidence, work) => findQuote(evidence, work) != null;

  function summarize(results) {
    const n = (s) => results.filter((r) => r.status === s).length;
    const parts = [`${n("met")} of ${results.length} met`];
    if (n("partly")) parts.push(`${n("partly")} partly`);
    if (n("notyet")) parts.push(`${n("notyet")} not yet`);
    if (n("unknown")) parts.push(`${n("unknown")} unclear`);
    return parts.join(" · ");
  }

  const LABELS = { met: "Met", partly: "Partly", notyet: "Not yet", unknown: "?" };

  function asText(results) {
    const lines = [`Rubric check: ${summarize(results)}`];
    results.forEach((r, i) => {
      lines.push("", `${i + 1}. ${r.criterion} — ${LABELS[r.status] || "?"}`);
      lines.push(`   Evidence: ${r.evidence ? `"${r.evidence}"` : "none"}`);
      if (r.fix) lines.push(`   Fix: ${r.fix}`);
    });
    return lines.join("\n");
  }

  return { MAX_CHARS, MAX_CRITERIA, LABELS, splitCriteria, buildPrompt, parseRubric, findQuote, checkQuote, summarize, asText };
})();
if (typeof module !== "undefined") module.exports = RubricCheck;

if (typeof document !== "undefined") (() => {
  const { MAX_CHARS, MAX_CRITERIA, LABELS, splitCriteria, buildPrompt, parseRubric, findQuote, summarize, asText } = RubricCheck;
  const SAVE_KEY = "local-ai-rubric";
  const fmt = (n) => n.toLocaleString("en-US");
  const SAMPLE_RUBRIC = "Clear thesis in the first paragraph\nAt least 3 pieces of evidence with citations\nCounterargument addressed\nConclusion restates thesis";
  const EXAMPLE_WORK = "Should students have to wear school uniforms? Many schools say uniforms make students equal. "
    + "However, I believe schools should not require uniforms because they limit self-expression and cost families money.\n\n"
    + "First, clothing is one of the main ways teenagers show who they are. A 2019 survey by the National Youth Council found that 64% of students "
    + "said their clothes help them express their personality. When everyone looks the same, students lose that voice.\n\n"
    + "Second, uniforms are expensive. Families often have to buy several sets, and those clothes can only be worn at school. "
    + "This is hard for families who already struggle to pay for school supplies.\n\n"
    + "Some people argue that uniforms stop bullying about clothes. That may be partly true, but students still find other things to tease each other about.\n\n"
    + "In the end, school uniforms cause more problems than they solve, and students should be free to choose what they wear.";

  const style = document.createElement("style");
  style.textContent = `
    #rubric-dialog { width: min(720px, calc(100vw - 32px)); }
    .rubric-field { margin: 14px 0 6px; }
    .rubric-field label { font-weight: 600; }
    .rubric-field-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; }
    #rubric-dialog textarea { display: block; width: 100%; margin-top: 6px; resize: vertical; font: inherit; font-weight: 400;
      line-height: 1.5; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card);
      color: var(--text); outline: none; }
    #rubric-dialog textarea.rubric-work-input { min-height: 200px; max-height: 45vh; }
    #rubric-dialog textarea.rubric-rubric-input { min-height: 120px; max-height: 35vh; }
    #rubric-dialog textarea:focus { border-color: var(--accent); }
    .rubric-linkbtn { background: none; border: none; padding: 0; font: inherit; font-size: 0.85em; font-weight: 400; color: var(--accent);
      text-decoration: underline; cursor: pointer; }
    .rubric-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .rubric-count.rubric-full { color: var(--accent); font-weight: 600; }
    .rubric-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .rubric-busy { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .rubric-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: rubric-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes rubric-spin { to { transform: rotate(360deg); } }
    .rubric-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .rubric-score { margin: 10px 0 4px; }
    .rubric-score b { display: block; font-size: 1.05em; margin-bottom: 8px; }
    .rubric-bar { display: flex; height: 10px; border-radius: 99px; overflow: hidden; background: var(--border); gap: 2px; }
    .rubric-bar span { display: block; height: 100%; }
    .rubric-met { --rubric-c: var(--fast); }
    .rubric-partly { --rubric-c: var(--slow); }
    .rubric-notyet { --rubric-c: var(--danger); }
    .rubric-unknown { --rubric-c: var(--blocked); }
    .rubric-bar span { background: var(--rubric-c); }
    .rubric-cards { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
    .rubric-card { border: 1px solid var(--border); border-left: 4px solid var(--rubric-c); border-radius: 12px; padding: 10px 14px;
      background: var(--card); min-width: 0; }
    .rubric-card-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
    .rubric-card-head b { overflow-wrap: anywhere; line-height: 1.4; }
    .rubric-badge { flex-shrink: 0; font-size: 0.78em; font-weight: 700; padding: 2px 10px; border-radius: 99px; color: #fff;
      background: var(--rubric-c); white-space: nowrap; }
    .rubric-line { margin: 8px 0 0; line-height: 1.5; overflow-wrap: anywhere; }
    .rubric-line > small { display: block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
    .rubric-quote { background: none; border: none; padding: 0; font: inherit; font-style: italic; color: var(--text); text-align: left;
      cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
    #rubric-dialog .rubric-quote, #rubric-dialog .rubric-quote:hover { background: none; box-shadow: none; }
    .rubric-quote:disabled { cursor: default; text-decoration: none; opacity: 1; color: inherit; }
    .rubric-tag { display: inline-block; margin-left: 6px; font-size: 0.8em; font-style: normal; white-space: nowrap; }
    .rubric-tag.rubric-ok { color: var(--fast); }
    .rubric-tag.rubric-bad { color: var(--danger); font-weight: 600; }
    .rubric-none { color: var(--muted); }
    .rubric-sec { display: block; margin: 18px 0 6px; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); }
    .rubric-work { max-height: 240px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 0;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); font-size: 0.92em; }
    .rubric-work mark { background: var(--accent-soft); color: var(--text); outline: 2px solid var(--accent); border-radius: 3px; }
    .rubric-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .rubric-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .rubric-buttons .rubric-grow { flex: 1; }
    #rubric-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "rubric-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🎯 Rubric check");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "rubric-dialog", "aria-labelledby": "rubric-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is checking
  let draft = { work: "", rubric: "" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && typeof d === "object" ? { work: String(d.work || ""), rubric: String(d.rubric || ""), reply: typeof d.reply === "string" ? d.reply : "" } : null;
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "rubric-title" }, "🎯 Rubric check"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawSetup(message) {
    const work = el("textarea", { id: "rubric-work", class: "rubric-work-input", maxlength: String(MAX_CHARS), placeholder: "Paste your essay, lab report or answer here...", "aria-label": "Your work" });
    const rubric = el("textarea", { id: "rubric-rubric", class: "rubric-rubric-input", placeholder: SAMPLE_RUBRIC, "aria-label": "Rubric, one criterion per line" });
    work.value = draft.work.slice(0, MAX_CHARS);
    rubric.value = draft.rubric;
    const workCount = el("span", { class: "rubric-count", "aria-live": "polite" });
    const rubricCount = el("span", { class: "rubric-count", "aria-live": "polite" });
    const update = () => {
      draft = { work: work.value, rubric: rubric.value };
      save({ ...(loadSaved() || {}), work: draft.work, rubric: draft.rubric, reply: "" });
      workCount.textContent = `${fmt(work.value.length)} / ${fmt(MAX_CHARS)} characters`;
      workCount.classList.toggle("rubric-full", work.value.length >= MAX_CHARS);
      const n = splitCriteria(rubric.value).length;
      rubricCount.textContent = `${n} / ${MAX_CRITERIA} criteria`;
      rubricCount.classList.toggle("rubric-full", n > MAX_CRITERIA);
    };
    work.addEventListener("input", update);
    rubric.addEventListener("input", update);
    const fill = (w, r) => { if (w != null) work.value = w; rubric.value = r; update(); };
    workCount.textContent = `${fmt(work.value.length)} / ${fmt(MAX_CHARS)} characters`;
    rubricCount.textContent = `${splitCriteria(rubric.value).length} / ${MAX_CRITERIA} criteria`;
    const go = () => {
      const criteria = splitCriteria(rubric.value);
      if (!work.value.trim()) return drawSetup("Paste your work first.");
      if (!criteria.length) return drawSetup("Add the rubric: one thing the teacher is looking for on each line.");
      if (criteria.length > MAX_CRITERIA) return drawSetup(`That rubric has ${criteria.length} lines. Keep it to ${MAX_CRITERIA} or fewer.`);
      return check(work.value.trim(), rubric.value);
    };
    setDialog(head(),
      el("p", { class: "note" }, "Before you turn it in: the AI on this computer checks each rubric line, quotes where your work shows it and suggests one fix. It won't rewrite your work."),
      el("div", { class: "rubric-field" },
        el("div", { class: "rubric-field-head" }, el("label", { for: "rubric-work" }, "Your work"),
          el("button", { type: "button", class: "rubric-linkbtn", onclick: () => fill(EXAMPLE_WORK, SAMPLE_RUBRIC) }, "Try an example")),
        work, workCount),
      el("div", { class: "rubric-field" },
        el("div", { class: "rubric-field-head" }, el("label", { for: "rubric-rubric" }, "Rubric (one criterion per line)"),
          el("button", { type: "button", class: "rubric-linkbtn", onclick: () => fill(null, SAMPLE_RUBRIC) }, "Use a sample essay rubric")),
        rubric, rubricCount),
      message ? el("p", { class: "rubric-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Check my work")));
    (work.value ? rubric : work).focus();
  }

  function drawChecking(live) {
    setDialog(head(),
      el("div", { class: "rubric-busy" }, el("span", { class: "rubric-spin", "aria-hidden": "true" }), "Checking…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function showWork(view, work, range) {
    if (!range) { view.replaceChildren(work); return; }
    const mark = el("mark", {}, work.slice(range[0], range[1]));
    view.replaceChildren(work.slice(0, range[0]), mark, work.slice(range[1]));
    view.scrollTop = Math.max(0, mark.offsetTop - view.offsetTop - view.clientHeight / 3);
    view.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function drawResult(data) {
    const criteria = splitCriteria(data.rubric);
    const results = parseRubric(data.reply, criteria);
    const ok = results.some((r) => r.status !== "unknown");
    const view = el("div", { class: "rubric-work", tabindex: "0", "aria-label": "Your work (read only)" }, data.work);
    const counts = ["met", "partly", "notyet", "unknown"].map((s) => [s, results.filter((r) => r.status === s).length]);
    const card = (r, i) => {
      const range = r.evidence ? findQuote(r.evidence, data.work) : null;
      const quote = r.evidence
        ? el("span", {},
          el("button", { type: "button", class: "rubric-quote", disabled: !range, title: range ? "Show it in your work" : null, onclick: () => showWork(view, data.work, range) }, `“${r.evidence}”`),
          el("span", { class: `rubric-tag ${range ? "rubric-ok" : "rubric-bad"}` }, range ? "✓ found in your work" : "⚠ not found in your work"))
        : el("span", { class: "rubric-none" }, "None found in your work");
      return el("li", { class: `rubric-card rubric-${r.status}` },
        el("div", { class: "rubric-card-head" }, el("b", {}, `${i + 1}. ${r.criterion}`), el("span", { class: "rubric-badge" }, LABELS[r.status] || "?")),
        el("p", { class: "rubric-line" }, el("small", {}, "Evidence"), quote),
        r.fix ? el("p", { class: "rubric-line" }, el("small", {}, "Fix"), r.fix) : null);
    };
    const plain = ok ? asText(results) : data.reply.trim();
    setDialog(head(),
      ok ? el("div", { class: "rubric-score" }, el("b", {}, summarize(results)),
        el("div", { class: "rubric-bar", role: "img", "aria-label": summarize(results) },
          ...counts.filter(([, n]) => n).map(([s, n]) => el("span", { class: `rubric-${s}`, style: `flex:${n}` })))) : null,
      ok ? el("ul", { class: "rubric-cards" }, ...results.map(card)) : el("p", { class: "rubric-raw" }, plain || "(no answer)"),
      el("span", { class: "rubric-sec" }, "Your work"),
      view,
      el("div", { class: "rubric-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy feedback"),
        el("button", { onclick: () => check(data.work, data.rubric) }, "↻ Check again"),
        el("span", { class: "rubric-grow" }),
        el("button", { onclick: () => { draft = { work: data.work, rubric: data.rubric }; save({ ...draft, reply: "" }); drawSetup(); } }, "Edit my work"),
        el("button", { class: "primary", onclick: () => { draft = { work: "", rubric: "" }; save({ ...draft, reply: "" }); drawSetup(); } }, "New check")));
  }

  async function check(work, rubric) {
    draft = { work, rubric };
    const model = currentModel();
    if (findModel(model)?.experimental) return drawSetup("TinyGPT is a tiny practice model and can't check a rubric. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "rubric-live" }, "Waiting for the AI...");
    drawChecking(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(work, splitCriteria(rubric)), think: false, auto_code: false }),
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
      const data = { work, rubric, reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Check my work to try again.");
      else drawSetup(`Couldn't check your work: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) draft = { work: saved.work, rubric: saved.rubric };
    if (saved?.reply && saved.work && saved.rubric) drawResult(saved);
    else drawSetup();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
