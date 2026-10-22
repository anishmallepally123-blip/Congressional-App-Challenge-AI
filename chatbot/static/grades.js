// "📊 Grade calculator": a weighted-grade calculator plus "What do I need on the final?".
// All the math is done here in JavaScript, because small AI models are bad at arithmetic.
// The AI is only used for the optional "Get a study tip" button, and is told the numbers.
// Everything the student types is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_grades.py can run them with Node.
const GradeCalc = (() => {
  const DEFAULT_ROWS = [
    { name: "Homework", weight: "20", score: "" },
    { name: "Quizzes", weight: "30", score: "" },
    { name: "Tests", weight: "50", score: "" },
  ];
  const GOALS = [["A", 90], ["B", 80], ["C", 70]];

  // "" or null means blank; anything that isn't a number is NaN (shown as a message, never printed).
  const num = (v) => (v == null || String(v).trim() === "" ? null : Number(v));
  const isPct = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
  // Round to 1 decimal for display: 84.5 → "84.5", 90 → "90". Never prints NaN or -0.
  const fmt = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "";
    const r = Math.round(n * 10) / 10;
    return String(Object.is(r, -0) ? 0 : r);
  };

  // Average of the scores that are filled in, weighted, divided by the weight of just those rows,
  // so a class with no test grades yet still shows a fair grade. null when nothing is filled in.
  function weightedGrade(rows) {
    let total = 0, points = 0;
    for (const r of rows || []) {
      const w = num(r.weight), s = num(r.score);
      if (s == null || !Number.isFinite(s) || !(w > 0) || !Number.isFinite(w)) continue;
      total += w;
      points += w * s;
    }
    return total > 0 ? points / total : null;
  }

  // Sum of all the weights typed in, to warn when they don't add up to 100.
  const totalWeight = (rows) => (rows || []).reduce((t, r) => { const w = num(r.weight); return w > 0 && Number.isFinite(w) ? t + w : t; }, 0);

  // Inline problems with the table, one message each.
  function rowProblems(rows) {
    const out = [];
    (rows || []).forEach((r, i) => {
      const label = String(r.name || "").trim() || `Row ${i + 1}`;
      const w = num(r.weight), s = num(r.score);
      if (w == null) { if (s != null) out.push({ row: i, field: "weight", text: `${label}: add a weight.` }); }
      else if (!Number.isFinite(w) || w <= 0 || w > 100) out.push({ row: i, field: "weight", text: `${label}: the weight must be more than 0 and at most 100.` });
      if (s != null && !isPct(s)) out.push({ row: i, field: "score", text: `${label}: the score must be from 0 to 100.` });
    });
    return out;
  }

  // A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F; + at 7 and up, - below 3 (A+ at 97+, no F+/F-).
  function letter(pct) {
    if (typeof pct !== "number" || !Number.isFinite(pct)) return "";
    if (pct < 60) return "F";
    const base = pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : "D";
    const ones = Math.min(pct, 99.999) - Math.floor(Math.min(pct, 99.999) / 10) * 10;
    return base + (ones >= 7 ? "+" : ones < 3 ? "-" : "");
  }

  // The plain letter for a round goal (80 → "B"), otherwise the full letter (85 → "B").
  const goalLabel = (goal) => ([90, 80, 70, 60].includes(goal) ? letter(goal)[0] : letter(goal));

  // Final grade = current × (1 − w) + final × w, with w the final's share (20% → 0.2).
  const gradeWithFinal = (current, finalWeight, finalScore) => {
    const w = finalWeight / 100;
    return current * (1 - w) + finalScore * w;
  };

  // The score needed on the final to finish with the goal: (goal − current × (1 − w)) / w.
  const neededOnFinal = (current, finalWeight, goal) => {
    const w = finalWeight / 100;
    if (!(w > 0)) return null;
    return (goal - current * (1 - w)) / w;
  };

  // Checks the final-exam boxes; returns a message, or "" when they're fine.
  function finalProblem(current, finalWeight, goal) {
    if (current == null) return "Fill in your current grade (or the table above).";
    if (!isPct(current)) return "Your current grade must be from 0 to 100.";
    if (finalWeight == null) return "Fill in how much the final is worth.";
    if (!Number.isFinite(finalWeight) || finalWeight <= 0 || finalWeight > 100) return "The final's weight must be more than 0 and at most 100.";
    if (goal == null) return "Pick a goal grade.";
    if (!isPct(goal)) return "Your goal must be from 0 to 100.";
    return "";
  }

  // What to tell the student: {kind: "need" | "reach" | "done", needed, best, text}.
  function finalResult(current, finalWeight, goal) {
    const problem = finalProblem(current, finalWeight, goal);
    if (problem) return { kind: "error", text: problem };
    const needed = neededOnFinal(current, finalWeight, goal);
    const label = goalLabel(goal);
    const g = `${/^[AF]/.test(label) ? "an" : "a"} ${label} (${fmt(goal)}%)`;
    // A tiny allowance so float noise (100.00000000001) doesn't flip the answer.
    if (needed > 100 + 1e-9) {
      const best = gradeWithFinal(current, finalWeight, 100);
      return { kind: "reach", needed, best, text: `Getting ${g} is out of reach: you'd need ${fmt(needed)}% on the final. With 100% on the final you'd finish with ${fmt(best)}% (${letter(best)}).` };
    }
    if (needed <= 1e-9) {
      const worst = gradeWithFinal(current, finalWeight, 0);
      return { kind: "done", needed, best: worst, text: `You've already got ${g}, even with 0% on the final (you'd finish with ${fmt(worst)}%).` };
    }
    return { kind: "need", needed, text: `You need ${fmt(needed)}% on the final to get ${g}.` };
  }

  // "If you score 60 / 70 / 80 / 90 / 100 on the final" → final grade and letter.
  const whatIf = (current, finalWeight) => [60, 70, 80, 90, 100].map((score) => {
    const grade = gradeWithFinal(current, finalWeight, score);
    return { score, grade, letter: letter(grade) };
  });

  // The numbers the dialog shows, all worked out from the saved state.
  function compute(state) {
    const rows = state.rows || [];
    const tableGrade = rowProblems(rows).length ? null : weightedGrade(rows);
    const current = state.currentEdited ? num(state.current) : (tableGrade == null ? null : Math.round(tableGrade * 10) / 10);
    const finalWeight = num(state.finalWeight), goal = num(state.goal);
    const result = finalResult(current, finalWeight, goal);
    return { tableGrade, total: totalWeight(rows), current, finalWeight, goal, result,
      table: result.kind === "error" ? [] : whatIf(current, finalWeight) };
  }

  function asText(state) {
    const c = compute(state);
    const lines = ["Grade calculator"];
    for (const r of state.rows || []) {
      const name = String(r.name || "").trim() || "Category";
      const s = num(r.score);
      lines.push(`- ${name} (${fmt(num(r.weight)) || "?"}% of grade): ${s == null || !Number.isFinite(s) ? "no score yet" : `${fmt(s)}%`}`);
    }
    if (c.tableGrade != null) lines.push(`Weighted grade: ${fmt(c.tableGrade)}% (${letter(c.tableGrade)})`);
    if (c.result.kind !== "error") {
      lines.push("", `Current grade: ${fmt(c.current)}% (${letter(c.current)}). Final is worth ${fmt(c.finalWeight)}%. Goal: ${goalLabel(c.goal)} (${fmt(c.goal)}%).`, c.result.text);
      for (const t of c.table) lines.push(`- ${t.score}% on the final → ${fmt(t.grade)}% (${t.letter})`);
    }
    const tips = tipList(state.tips);
    if (tips.length) lines.push("", "Study tips:", ...tips.map((t, i) => `${i + 1}. ${t}`));
    return lines.join("\n");
  }

  function buildTipPrompt(state) {
    const c = compute(state);
    const cats = (state.rows || []).map((r) => {
      const s = num(r.score);
      return `- ${String(r.name || "").trim() || "Category"}: worth ${fmt(num(r.weight)) || "?"}% of the grade, score ${s == null || !Number.isFinite(s) ? "not graded yet" : `${fmt(s)}%`}`;
    });
    const facts = [`Categories:`, ...cats];
    if (c.result.kind !== "error") {
      facts.push(`Current grade: ${fmt(c.current)}% (${letter(c.current)})`, `The final exam is worth ${fmt(c.finalWeight)}% of the grade.`,
        `Goal: ${goalLabel(c.goal)} (${fmt(c.goal)}%)`, `Result: ${c.result.text}`);
    } else if (c.current != null && isPct(c.current)) facts.push(`Current grade: ${fmt(c.current)}% (${letter(c.current)})`);
    const system = "You are a kind, encouraging study coach for a high school student. "
      + "The grade math below is already done and is correct: do not recompute, check or change any numbers, and do not show any math. "
      + "Write exactly 3 short, specific study tips for the final exam as a numbered list (1. 2. 3.), one or two sentences each. "
      + "Focus on the weakest categories and on what the student needs. Be realistic but encouraging. No intro and no ending.";
    return [{ role: "system", content: system }, { role: "user", content: `My grades:\n${facts.join("\n")}\n\nGive me 3 study tips.` }];
  }

  // The tips as a list: numbered or bulleted lines, markdown bold removed.
  function tipList(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/\*\*|__/g, "").trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const m = line.match(/^(?:\d{1,2}[.)]|[-*•])\s+(.*)$/);
      if (m) items.push(m[1].trim());
      else if (items.length) items[items.length - 1] += ` ${line}`;
    }
    return items.length ? items : lines;
  }

  return { DEFAULT_ROWS, GOALS, num, fmt, weightedGrade, totalWeight, rowProblems, letter, goalLabel, gradeWithFinal,
    neededOnFinal, finalProblem, finalResult, whatIf, compute, asText, buildTipPrompt, tipList };
})();
if (typeof module !== "undefined") module.exports = GradeCalc;

if (typeof document !== "undefined") (() => {
  const { DEFAULT_ROWS, GOALS, fmt, letter, rowProblems, compute, asText, buildTipPrompt, tipList } = GradeCalc;
  const SAVE_KEY = "local-ai-grades";

  const style = document.createElement("style");
  style.textContent = `
    #grades-dialog { width: min(640px, calc(100vw - 32px)); }
    #grades-dialog input { font: inherit; font-weight: 400; min-width: 0; width: 100%; padding: 7px 9px; border: 1px solid var(--border-strong);
      border-radius: 9px; background: var(--card); color: var(--text); outline: none; }
    #grades-dialog input:focus { border-color: var(--accent); }
    #grades-dialog input[aria-invalid="true"] { border-color: var(--danger); }
    #grades-dialog button:disabled { opacity: 1; color: inherit; }
    .grades-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--accent); margin: 18px 0 8px; }
    .grades-grid { display: grid; grid-template-columns: minmax(0, 1fr) 5.2em 5.2em 2.2em; gap: 6px; align-items: center; }
    .grades-grid .grades-colhead { font-size: 0.8em; font-weight: 600; color: var(--muted); }
    .grades-grid button.grades-remove { padding: 4px 0; border: none; color: var(--muted); }
    .grades-grid button.grades-remove:hover:not(:disabled) { color: var(--danger); }
    .grades-under { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 10px; }
    .grades-now { margin: 12px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.45; }
    .grades-now b { font-size: 1.3em; white-space: nowrap; }
    .grades-msg { margin: 8px 0 0; padding: 8px 12px; border-radius: 10px; line-height: 1.4; font-size: 0.92em;
      background: color-mix(in srgb, var(--slow) 14%, transparent); }
    .grades-msg.grades-bad { background: color-mix(in srgb, var(--danger) 12%, transparent); }
    .grades-fields { display: flex; flex-wrap: wrap; gap: 10px 12px; }
    .grades-fields label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 0.9em; }
    #grades-dialog .grades-fields input { width: 7em; }
    .grades-chips { display: flex; gap: 6px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
    .grades-chips > span { font-size: 0.9em; color: var(--muted); }
    .grades-result { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; line-height: 1.45; font-weight: 600;
      background: var(--accent-soft); border-left: 4px solid var(--accent); }
    .grades-result.grades-reach { background: color-mix(in srgb, var(--danger) 10%, transparent); border-left-color: var(--danger); }
    .grades-result.grades-done { background: color-mix(in srgb, var(--fast) 12%, transparent); border-left-color: var(--fast); }
    .grades-whatif { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.92em; }
    .grades-whatif th, .grades-whatif td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    .grades-whatif th { font-weight: 600; color: var(--muted); font-size: 0.9em; }
    .grades-tips { margin: 10px 0 0; padding-left: 22px; line-height: 1.55; }
    .grades-tips li { margin: 4px 0; overflow-wrap: anywhere; }
    .grades-live { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted); max-height: 180px; overflow-y: auto;
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; }
    .grades-note { margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; font-size: 0.92em; }
    .grades-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .grades-buttons .grades-grow { flex: 1; }
    @media (max-width: 480px) {
      .grades-grid { grid-template-columns: minmax(0, 1fr) 4.3em 4.3em 1.8em; gap: 5px; }
      #grades-dialog input { padding: 7px 6px; }
      #grades-dialog .grades-fields input { width: 6em; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "grades-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📊 Grade calculator");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "grades-dialog", "aria-labelledby": "grades-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  const fresh = () => ({ rows: DEFAULT_ROWS.map((r) => ({ ...r })), current: "", currentEdited: false, finalWeight: "20", goal: "90", tips: "" });
  const str = (v) => (v == null ? "" : String(v));
  function loadSaved() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !Array.isArray(d.rows)) return null;
      return { rows: d.rows.map((r) => ({ name: str(r && r.name), weight: str(r && r.weight), score: str(r && r.score) })),
        current: str(d.current), currentEdited: !!d.currentEdited, finalWeight: str(d.finalWeight), goal: str(d.goal), tips: str(d.tips) };
    } catch { return null; }
  }
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };

  let state = fresh();
  let busy = null; // AbortController while the AI writes tips
  let rowsBox, nowBox, rowMsgs, currentInput, useTable, finalBox, chipsBox, tipsBox, tipButton;

  const numInput = (value, label, oninput) => el("input", { type: "number", inputmode: "decimal", min: "0", max: "100", step: "any",
    value, "aria-label": label, oninput });

  function drawRows() {
    const problems = rowProblems(state.rows);
    const bad = (i, f) => problems.some((p) => p.row === i && p.field === f);
    rowsBox.replaceChildren(
      el("span", { class: "grades-colhead" }, "Category"), el("span", { class: "grades-colhead" }, "Weight %"),
      el("span", { class: "grades-colhead" }, "Score %"), el("span"),
      ...state.rows.flatMap((r, i) => {
        const name = r.name || `row ${i + 1}`;
        const w = numInput(r.weight, `${name} weight percent`, (e) => { r.weight = e.target.value; changed(); });
        const s = numInput(r.score, `${name} score percent`, (e) => { r.score = e.target.value; changed(); });
        w.setAttribute("aria-invalid", String(bad(i, "weight")));
        s.setAttribute("aria-invalid", String(bad(i, "score")));
        w.dataset.row = s.dataset.row = String(i);
        w.dataset.field = "weight"; s.dataset.field = "score";
        return [
          el("input", { type: "text", value: r.name, maxlength: "40", placeholder: "Category", "aria-label": `Category ${i + 1} name`,
            oninput: (e) => { r.name = e.target.value; changed(); } }),
          w, s,
          el("button", { type: "button", class: "grades-remove", "aria-label": `Remove ${name}`, title: "Remove", disabled: state.rows.length <= 1,
            onclick: () => { state.rows.splice(i, 1); drawRows(); changed(); } }, "✕"),
        ];
      }));
  }

  // Updates everything worked out from the numbers, without redrawing the boxes being typed in.
  function changed() {
    const c = compute(state);
    const problems = rowProblems(state.rows);
    rowsBox.querySelectorAll("input[data-field]").forEach((inp) => {
      inp.setAttribute("aria-invalid", String(problems.some((p) => p.row === Number(inp.dataset.row) && p.field === inp.dataset.field)));
    });
    const msgs = problems.map((p) => el("p", { class: "grades-msg grades-bad", role: "alert" }, p.text));
    if (!problems.length && c.total > 0 && Math.abs(c.total - 100) > 0.001) {
      msgs.push(el("p", { class: "grades-msg" }, `Heads up: the weights add up to ${fmt(c.total)}%, not 100%. Check your syllabus.`));
    }
    rowMsgs.replaceChildren(...msgs);
    nowBox.replaceChildren(c.tableGrade == null
      ? el("span", {}, problems.length ? "Fix the boxes above to see your grade." : "Type your scores to see your grade.")
      : el("span", {}, "Your grade right now: ", el("b", {}, `${fmt(c.tableGrade)}% ${letter(c.tableGrade)}`)));
    if (!state.currentEdited && document.activeElement !== currentInput) currentInput.value = c.current == null ? "" : fmt(c.current);
    useTable.hidden = !state.currentEdited;
    currentInput.setAttribute("aria-invalid", String(c.current != null && !(c.current >= 0 && c.current <= 100)));

    chipsBox.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.goal) === c.goal && state.goal !== "")));
    const r = c.result;
    finalBox.replaceChildren(...[
      el("p", { class: r.kind === "error" ? "grades-msg" : `grades-result grades-${r.kind}`, "aria-live": "polite" }, r.text),
      c.table.length ? el("table", { class: "grades-whatif" },
        el("thead", {}, el("tr", {}, el("th", {}, "If you score"), el("th", {}, "Final grade"))),
        el("tbody", {}, ...c.table.map((t) => el("tr", {}, el("td", {}, `${t.score}% on the final`), el("td", {}, `${fmt(t.grade)}% (${t.letter})`))))) : null,
    ].filter((n) => n != null));
    save();
  }

  function drawTips(live) {
    if (live) return tipsBox.replaceChildren(live);
    const items = tipList(state.tips);
    tipsBox.replaceChildren(...(items.length ? [el("ol", { class: "grades-tips" }, ...items.map((t) => el("li", {}, t)))] : []));
  }
  const tipNote = (text) => tipsBox.replaceChildren(el("p", { class: "grades-note", role: "alert" }, text));

  async function getTips() {
    if (busy) return busy.abort();
    if (controller) return toast("Wait for the chat answer to finish first.");
    const model = currentModel();
    if (!model) return tipNote("Pick a chat model in Models to get study tips. The calculator works without one.");
    if (findModel(model)?.experimental) return tipNote("TinyGPT is a tiny practice model and can't give study tips. Pick a real chat model in Models for tips. The calculator above still works without it.");
    const c = compute(state);
    if (c.current == null && c.tableGrade == null) return tipNote("Type some scores first so the AI knows what to help with.");
    busy = new AbortController();
    tipButton.textContent = "■ Stop";
    const live = el("p", { class: "grades-live" }, "Thinking of tips...");
    drawTips(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildTipPrompt(state), think: false, auto_code: false }),
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
      state.tips = reply.trim();
      save();
      if (dialog.open) drawTips();
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") tipNote("Stopped. Press the button to try again.");
      else tipNote(`Couldn't get tips: ${err.message}`);
    } finally {
      busy = null;
      tipButton.textContent = "💡 Get a study tip";
    }
  }

  function draw() {
    rowsBox = el("div", { class: "grades-grid" });
    nowBox = el("p", { class: "grades-now", "aria-live": "polite" });
    rowMsgs = el("div");
    currentInput = numInput("", "Current grade percent", (e) => { state.current = e.target.value; state.currentEdited = true; changed(); });
    if (state.currentEdited) currentInput.value = state.current;
    useTable = el("button", { type: "button", class: "chip", onclick: () => { state.currentEdited = false; state.current = ""; changed(); } }, "↺ Use my table grade");
    const finalInput = numInput(state.finalWeight, "Final exam weight percent", (e) => { state.finalWeight = e.target.value; changed(); });
    const goalInput = numInput(state.goal, "Goal grade percent", (e) => { state.goal = e.target.value; changed(); });
    chipsBox = el("div", { class: "grades-chips", role: "group", "aria-label": "Goal grade" }, el("span", {}, "Goal:"),
      ...GOALS.map(([l, g]) => el("button", { type: "button", class: "chip", "data-goal": String(g), onclick: () => { state.goal = String(g); goalInput.value = String(g); changed(); } }, `${l} (${g}%)`)), useTable);
    finalBox = el("div");
    tipsBox = el("div", { "aria-live": "polite" });
    tipButton = el("button", { type: "button", onclick: getTips }, "💡 Get a study tip");
    setDialog(
      el("div", { class: "dialog-head" },
        el("h2", { id: "grades-title" }, "📊 Grade calculator"),
        el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
      el("p", { class: "note" }, "Type each part of your grade from the syllabus and your score in it. The math is done exactly on this computer, not by the AI."),
      el("span", { class: "grades-sec" }, "Your grades"),
      rowsBox,
      el("div", { class: "grades-under" },
        el("button", { type: "button", onclick: () => { state.rows.push({ name: "", weight: "", score: "" }); drawRows(); changed(); [...rowsBox.querySelectorAll('input[type="text"]')].at(-1)?.focus(); } }, "＋ Add category")),
      rowMsgs,
      nowBox,
      el("span", { class: "grades-sec" }, "What do I need on the final?"),
      el("div", { class: "grades-fields" },
        el("label", {}, "Current grade %", currentInput),
        el("label", {}, "Final is worth %", finalInput),
        el("label", {}, "Goal grade %", goalInput)),
      chipsBox,
      finalBox,
      el("span", { class: "grades-sec" }, "Study tips"),
      el("p", { class: "note" }, "Optional: the AI suggests 3 ways to study, using the numbers above."),
      tipsBox,
      el("div", { class: "grades-buttons" },
        tipButton,
        el("span", { class: "grades-grow" }),
        el("button", { type: "button", onclick: (e) => copyText(e.currentTarget, asText(state)) }, "📋 Copy"),
        el("button", { type: "button", onclick: () => { busy?.abort(); state = fresh(); draw(); } }, "Start over")));
    drawRows();
    drawTips();
    changed();
  }

  function open() {
    state = loadSaved() || fresh();
    dialog.showModal();
    draw();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
