// "🔢 Practice problems": the student names a topic and the AI writes a short worksheet.
// The student types an answer for each problem and the page checks it: right answers turn green,
// wrong ones turn red with a "Show answer" button. The last worksheet and the student's answers
// are kept in this browser so reopening shows them again.

// Pure helpers (no page needed), so test_problems.py can run them with Node.
const PracticeProblems = (() => {
  const GRADES = { "6-8": "grades 6 to 8", "9-10": "grades 9 to 10", "11-12": "grades 11 to 12" };
  const COUNTS = [3, 5, 8];

  function buildPrompt(topic, grade, count) {
    const n = COUNTS.includes(Number(count)) ? Number(count) : 5;
    const level = GRADES[grade] || GRADES["9-10"];
    const system = `You write practice problems for a student in ${level}. Each problem must have one clear, short final answer `
      + "that the student can type (a number, an expression, a word or an equation). Check every answer carefully. "
      + "Answer in exactly this format and nothing else:\n"
      + "PROBLEM 1: the problem\n"
      + "ANSWER: short final answer\n"
      + "STEPS: one or two sentences explaining how to solve it\n"
      + "\n"
      + "PROBLEM 2: ...\n"
      + "(and so on)";
    const user = `Write exactly ${n} practice problems about: ${String(topic).trim().slice(0, 200)}. Start easy and get a little harder.`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // "Problem 1:", "**Problem 1.**", "### Question 2", "Q3)" and plain "1)" / "1." all start a problem.
  const NAMED_HEAD = /^(?:problem|question|q)\s*#?\s*(\d{1,2})\s*(?:[:.)\-–]\s*|\s+|$)(.*)$/i;
  const BARE_HEAD = /^(\d{1,2})\s*[:.)]\s+(.*)$/;
  const ANSWER = /^(?:final\s+)?answer\s*(?:[:\-–]\s*|$)(.*)$/i;
  const STEPS = /^(?:steps?|how|explanation|solution|work|why)\s*(?:[:\-–]\s*|$)(.*)$/i;

  function parseProblems(text) {
    const items = [];
    let cur = null;
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-*•]\s+(?=\S)/, "").trim();
      if (!line) continue;
      const named = line.match(NAMED_HEAD);
      const bare = !named && line.match(BARE_HEAD);
      const startsNew = named || (bare && (!cur || (cur.answer && Number(bare[1]) === cur.num + 1)));
      if (startsNew) {
        const m = named || bare;
        cur = { num: Number(m[1]), question: m[2].trim(), answer: "", steps: "" };
        items.push(cur);
        section = "question";
        continue;
      }
      if (!cur) continue;
      const a = line.match(ANSWER);
      if (a) { section = "answer"; cur.answer = [cur.answer, a[1].trim()].filter(Boolean).join(" "); continue; }
      const s = line.match(STEPS);
      if (s) { section = "steps"; cur.steps = [cur.steps, s[1].trim()].filter(Boolean).join(" "); continue; }
      if (section === "question") cur.question = cur.question ? `${cur.question}\n${line}` : line;
      else if (section === "answer" && !cur.answer) cur.answer = line;
      else if (section === "answer" || section === "steps") { section = "steps"; cur.steps = cur.steps ? `${cur.steps} ${line}` : line; }
    }
    const tidy = (t) => t.replace(/^\*+|\*+$/g, "").trim();
    return items
      .map((p) => ({ question: tidy(p.question), answer: tidy(p.answer).replace(/\.$/, ""), steps: tidy(p.steps) }))
      .filter((p) => p.question && p.answer);
  }

  // ---------- Answer checking ----------

  const clean = (s) => String(s ?? "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[−–—]/g, "-").replace(/→|⟶|=>/g, "->").replace(/[×·]/g, "*").replace(/÷/g, "/")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .trim().replace(/[.!?]+$/, "").trim().toLowerCase();
  // "x = 4" and "y=-2" become "4" and "-2" so they compare as numbers.
  const dropVariable = (s) => s.replace(/^[a-z]\s*=\s*(?=\S)/, "");

  // Reads a number at the start: 4, -4.0, .5, 1/2, -3/4, 2 1/2, $5. Returns {value, decimals, rest} or null.
  function leadingNumber(s) {
    const m = s.match(/^([-+])?\s*\$?\s*(?:(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?)/);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    let value;
    let decimals = 0;
    if (m[2] != null) value = Number(m[2]) + Number(m[3]) / Number(m[4]);
    else if (m[6] != null) value = Number(m[5]) / Number(m[6]);
    else { value = Number(m[5]); decimals = (m[5].split(".")[1] || "").length; }
    if (!Number.isFinite(value)) return null;
    return { value: sign * value, decimals: m[6] != null || m[2] != null ? 0 : decimals, rest: s.slice(m[0].length).trim() };
  }

  // Words like "cm", "square units", "%", "°", "m^2", "dollars", "apples" after a number.
  const UNITS = /^(?:[a-zµ°%$²³]+(?:\^?[23])?\.?)(?:\s*(?:\/|per)?\s*[a-zµ°%²³]+(?:\^?[23])?\.?)*$/i;
  const isUnit = (rest, glued) => !rest || (UNITS.test(rest) && !(glued && /^[a-z]$/.test(rest) && !/^[mgslkn]$/.test(rest)));

  function numericValue(s) {
    const n = leadingNumber(s);
    if (!n) return null;
    const glued = n.rest && !/\s/.test(s.charAt(s.length - n.rest.length - 1));
    return isUnit(n.rest, glued) ? n : null;
  }

  const close = (student, key) => {
    const tol = student.decimals >= 2 ? 0.5 * 10 ** -student.decimals : 1e-9 * Math.max(1, Math.abs(key.value));
    return Math.abs(student.value - key.value) <= tol + 1e-12;
  };
  const squash = (s) => s.replace(/[\s,;:!?'"()[\]{}]/g, "").replace(/\.+$/, "");

  function answersMatch(student, answer) {
    const a = dropVariable(clean(student));
    const b = dropVariable(clean(answer));
    if (!a || !b) return false;
    const na = numericValue(a);
    const nb = numericValue(b);
    if (na && nb) return close(na, nb);
    return squash(a) === squash(b);
  }

  function score(problems, answers) {
    const list = problems || [];
    return list.reduce((n, p, i) => n + (answersMatch((answers || [])[i], p.answer) ? 1 : 0), 0);
  }

  function asText(problems, topic) {
    const lines = [];
    if (topic) lines.push(`Practice problems: ${topic}`, "");
    problems.forEach((p, i) => lines.push(`${i + 1}. ${p.question}`, ""));
    lines.push("Answer key:");
    problems.forEach((p, i) => lines.push(`${i + 1}. ${p.answer}${p.steps ? ` (${p.steps})` : ""}`));
    return lines.join("\n").trim();
  }

  return { GRADES, COUNTS, buildPrompt, parseProblems, answersMatch, score, asText };
})();
if (typeof module !== "undefined") module.exports = PracticeProblems;

if (typeof document !== "undefined") (() => {
  const { COUNTS, buildPrompt, parseProblems, answersMatch, score, asText } = PracticeProblems;
  const SAVE_KEY = "local-ai-practice-problems";

  const style = document.createElement("style");
  style.textContent = `
    #problems-dialog { width: min(680px, calc(100vw - 32px)); --problems-right: #2f9e5b; }
    #problems-dialog label.problems-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #problems-dialog label.problems-field input { display: block; width: 100%; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #problems-dialog input:focus { border-color: var(--accent); }
    .problems-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-top: 12px; }
    .problems-row > span { font-weight: 600; min-width: 76px; }
    .problems-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .problems-writing { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .problems-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: problems-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes problems-spin { to { transform: rotate(360deg); } }
    .problems-live { max-height: 220px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .problems-top { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; justify-content: space-between; margin-top: 4px; }
    .problems-topic { margin: 0; font-size: 0.9em; color: var(--muted); overflow-wrap: anywhere; }
    .problems-score { font-weight: 700; color: var(--accent); }
    .problems-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .problems-item { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--card); }
    .problems-item.problems-right { border-color: var(--problems-right); background: color-mix(in srgb, var(--problems-right) 8%, var(--card)); }
    .problems-item.problems-wrong { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 6%, var(--card)); }
    .problems-q { display: flex; gap: 8px; margin: 0; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .problems-num { font-weight: 700; color: var(--accent); flex-shrink: 0; }
    .problems-answer { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
    .problems-answer input { flex: 1; min-width: 0; font: inherit; font-weight: 400; padding: 7px 10px; border: 1px solid var(--border-strong);
      border-radius: 9px; background: var(--card); color: var(--text); outline: none; }
    .problems-result { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 8px; font-weight: 600; }
    .problems-result:empty { display: none; }
    .problems-right .problems-result { color: var(--problems-right); }
    .problems-wrong .problems-result { color: var(--danger); }
    .problems-result button { font-size: 0.85em; padding: 3px 10px; font-weight: 500; color: var(--text); }
    .problems-key { margin: 8px 0 0; padding: 8px 10px; border-radius: 9px; background: var(--accent-soft); line-height: 1.5; overflow-wrap: anywhere; }
    .problems-key b { color: var(--text); }
    .problems-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; align-items: center; }
    .problems-buttons .problems-grow { flex: 1; }
    #problems-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "problems-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🔢 Practice problems");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "problems-dialog", "aria-labelledby": "problems-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is writing
  let draft = { topic: "", grade: "9-10", count: 5 };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && Array.isArray(d.problems) && d.problems.length ? { answers: [], checked: [], shown: [], ...d } : null;
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "problems-title" }, "🔢 Practice problems"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function segmented(label, options, value, onPick) {
    const seg = el("div", { class: "segmented", role: "group", "aria-label": label });
    for (const [v, text] of options) {
      seg.append(el("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": String(v === value), onclick: (e) => {
        onPick(v);
        seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
      } }, text));
    }
    return seg;
  }

  function drawSetup(message) {
    const topic = el("input", { type: "text", maxlength: "200", placeholder: "e.g. two-step equations, finding the area of triangles, balancing chemical equations" });
    topic.value = draft.topic;
    topic.addEventListener("input", () => (draft.topic = topic.value));
    const go = () => (topic.value.trim() ? make({ ...draft, topic: topic.value.trim() }) : drawSetup("Type a topic first."));
    topic.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    setDialog(head(),
      el("p", { class: "note" }, "The AI on this computer writes practice problems on any topic. Type your answers and check them as you go."),
      el("label", { class: "problems-field" }, "Topic", topic),
      el("div", { class: "problems-row" }, el("span", {}, "Grade"),
        segmented("Grade", [["6-8", "6–8"], ["9-10", "9–10"], ["11-12", "11–12"]], draft.grade, (v) => (draft.grade = v))),
      el("div", { class: "problems-row" }, el("span", {}, "Problems"),
        segmented("Number of problems", COUNTS.map((n) => [n, String(n)]), draft.count, (v) => (draft.count = v))),
      message ? el("p", { class: "problems-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Make problems")));
    topic.focus();
  }

  function drawWriting(live) {
    setDialog(head(),
      el("div", { class: "problems-writing" }, el("span", { class: "problems-spin", "aria-hidden": "true" }), "Writing problems…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function drawSheet(data) {
    const scoreLine = el("span", { class: "problems-score", "aria-live": "polite" });
    const updateScore = () => {
      const anyChecked = data.checked.some(Boolean);
      scoreLine.textContent = anyChecked ? `${score(data.problems, data.problems.map((p, i) => (data.checked[i] ? data.answers[i] : "")))} of ${data.problems.length} right` : "";
    };
    const checks = [];
    const items = data.problems.map((p, i) => {
      const input = el("input", { type: "text", "aria-label": `Your answer to problem ${i + 1}`, placeholder: "Your answer", autocomplete: "off" });
      input.value = data.answers[i] || "";
      const result = el("div", { class: "problems-result", "aria-live": "polite" });
      const item = el("li", { class: "problems-item" },
        el("p", { class: "problems-q" }, el("span", { class: "problems-num" }, `${i + 1}.`), el("span", {}, p.question)),
        el("div", { class: "problems-answer" }, input, el("button", { type: "button", onclick: () => { check(); save(data); } }, "Check")),
        result);
      const showKey = () => {
        data.shown[i] = true;
        result.replaceChildren(el("span", {}, "✗ Not quite"));
        result.after(el("p", { class: "problems-key" }, el("b", {}, "Answer: "), p.answer, p.steps ? ` — ${p.steps}` : ""));
      };
      const paint = () => {
        item.querySelector(".problems-key")?.remove();
        item.classList.remove("problems-right", "problems-wrong");
        result.replaceChildren();
        if (!data.checked[i]) return;
        if (answersMatch(data.answers[i], p.answer)) {
          item.classList.add("problems-right");
          result.append(el("span", {}, "✓ Right!"));
        } else {
          item.classList.add("problems-wrong");
          if (data.shown[i]) showKey();
          else result.append(el("span", {}, "✗ Not quite"), el("button", { type: "button", onclick: () => { showKey(); save(data); } }, "Show answer"));
        }
      };
      const check = () => {
        data.answers[i] = input.value;
        data.checked[i] = !!input.value.trim();
        if (!data.checked[i]) data.shown[i] = false;
        paint();
        updateScore();
      };
      input.addEventListener("input", () => {
        data.answers[i] = input.value;
        if (data.checked[i]) { data.checked[i] = false; data.shown[i] = false; paint(); updateScore(); }
        save(data);
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); save(data); } });
      checks.push(check);
      paint();
      return item;
    });
    updateScore();
    setDialog(head(),
      el("div", { class: "problems-top" }, el("p", { class: "problems-topic" }, `${data.topic} · grade ${data.grade.replace("-", "–")}`), scoreLine),
      el("ol", { class: "problems-list" }, ...items),
      el("div", { class: "problems-buttons" },
        el("button", { class: "primary", onclick: () => { checks.forEach((c) => c()); save(data); } }, "Check all"),
        el("button", { onclick: (e) => copyText(e.currentTarget, asText(data.problems, data.topic)) }, "📋 Copy worksheet"),
        el("span", { class: "problems-grow" }),
        el("button", { onclick: () => { draft = { topic: data.topic, grade: data.grade, count: data.count }; drawSetup(); } }, "Change topic"),
        el("button", { onclick: () => make({ topic: data.topic, grade: data.grade, count: data.count }) }, "New problems")));
  }

  async function make(settings) {
    draft = { ...settings };
    const model = currentModel();
    if (findModel(model)?.experimental) return drawSetup("TinyGPT is a tiny practice model and can't write problems. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "problems-live" }, "Waiting for the AI...");
    drawWriting(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(settings.topic, settings.grade, settings.count), think: false, auto_code: false }),
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
      const problems = parseProblems(reply);
      if (!problems.length) throw new Error(reply.trim() ? "the AI didn't write them in the worksheet format. Try again, or try a bigger model" : "the AI sent an empty answer");
      const data = { ...settings, problems, answers: [], checked: [], shown: [], at: Date.now() };
      save(data);
      if (dialog.open) drawSheet(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Make problems to try again.");
      else drawSetup(`Couldn't make problems: ${err.message}.`.replace(/\.\.$/, "."));
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) drawSheet(saved);
    else drawSetup();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
