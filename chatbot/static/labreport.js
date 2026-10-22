// "🔬 Lab report": the student types rough notes from a science experiment and the AI organizes them
// into a lab report outline (question, hypothesis, variables, materials, procedure, results,
// conclusion). The AI is told to use only the student's own data and to write "[ADD: ...]" where
// something is missing, so the report never has made-up numbers. The last report is kept in this browser.

// Pure helpers (no page needed), so test_labreport.py can run them with Node.
const LabReport = (() => {
  const MAX_CHARS = 5000;

  function buildPrompt(title, notes) {
    const system = "You help a student turn their rough science experiment notes into an organized lab report outline. "
      + "Use ONLY the information and data in the student's notes. Never make up numbers, measurements, results, materials or steps. "
      + "If something a lab report needs is missing from the notes, write [ADD: what is missing] in its place instead of guessing. "
      + "Use simple words. Answer in exactly this format and nothing else:\n"
      + "QUESTION: the question the experiment tries to answer\n"
      + "HYPOTHESIS: If ..., then ..., because ...\n"
      + "VARIABLES: independent: ...; dependent: ...; controlled: ...\n"
      + "MATERIALS:\n"
      + "- one material per line\n"
      + "PROCEDURE:\n"
      + "1. one step per line\n"
      + "RESULTS: what the student's data shows, using only their numbers\n"
      + "CONCLUSION: whether the data supports the hypothesis and why\n"
      + "NEXT TIME: one improvement for the experiment";
    const t = String(title || "").trim();
    const user = `Organize my notes into a lab report.${t ? `\n\nEXPERIMENT TITLE: ${t}` : ""}\n\nMY NOTES:\n${String(notes || "").slice(0, MAX_CHARS)}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // Which section a line starts, and any text after its colon on the same line.
  const HEADS = [
    ["question", /^(?:research\s+)?question\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["hypothesis", /^hypothesis\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["variables", /^variables?\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["materials", /^(?:materials?|supplies|equipment)(?:\s+list)?\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["procedure", /^(?:procedure|method|steps)\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["results", /^(?:results?|data)\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["conclusion", /^conclusions?\b\s*(?:[:\-–]\s*(.*)|$)/i],
    ["nextTime", /^(?:next\s*time|improvements?)\b\s*(?:[:\-–]\s*(.*)|$)/i],
  ];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const VAR = /^(independent|dependent|control(?:led)?|constants?)(?:\s+variables?)?\s*(?:\([^)]*\))?\s*[:\-–]\s*(.*)$/i;
  const join = (a, b) => (a ? `${a} ${b}` : b);

  function parseLab(text) {
    const out = { question: "", hypothesis: "", variables: { independent: "", dependent: "", controlled: "" },
      materials: [], procedure: [], results: "", conclusion: "", nextTime: "" };
    let section = null;
    let lastVar = null;
    const addVars = (line) => {
      for (const part of line.split(/;\s*/)) {
        const p = part.replace(BULLET, "").trim();
        if (!p) continue;
        const m = p.match(VAR);
        if (m) {
          const key = /^ind/i.test(m[1]) ? "independent" : /^dep/i.test(m[1]) ? "dependent" : "controlled";
          lastVar = key;
          out.variables[key] = out.variables[key] ? `${out.variables[key]}; ${m[2].trim()}` : m[2].trim();
        } else if (lastVar) out.variables[lastVar] += `; ${p}`;
      }
    };
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bare = line.replace(BULLET, "");
      const head = HEADS.find(([, re]) => re.test(bare));
      if (head) {
        section = head[0];
        line = (bare.match(head[1])[1] || "").trim();
        if (!line) continue;
      }
      const item = line.replace(BULLET, "").replace(/^\*\s*|\s*\*$/g, "").trim();
      if (!item || /^(?:none|n\/a)\.?$/i.test(item)) continue;
      if (section === "variables") addVars(item);
      else if (section === "materials" || section === "procedure") out[section].push(item);
      else if (section === "results") out.results = out.results ? `${out.results}\n${item}` : item;
      else if (section) out[section] = join(out[section], item);
    }
    return out;
  }

  const parsedOk = (lab) => !!(lab && (lab.question || lab.hypothesis || lab.procedure.length || lab.results || lab.conclusion));

  const SECTION_NAMES = [["question", "Question"], ["hypothesis", "Hypothesis"], ["materials", "Materials"], ["procedure", "Procedure"],
    ["results", "Results"], ["conclusion", "Conclusion"], ["nextTime", "Next time"]];
  const VAR_NAMES = [["independent", "Independent variable"], ["dependent", "Dependent variable"], ["controlled", "Controlled variables"]];

  // Every "[ADD: ...]" the AI left, then every section that came back empty.
  function missingItems(lab) {
    const all = [lab.question, lab.hypothesis, ...Object.values(lab.variables), ...lab.materials, ...lab.procedure, lab.results, lab.conclusion, lab.nextTime].join("\n");
    const found = [...all.matchAll(/\[ADD:?\s*([^\]]*)\]/gi)].map((m) => m[1].trim()).filter(Boolean);
    const empty = [];
    for (const [key, name] of SECTION_NAMES.slice(0, 2)) if (!lab[key]) empty.push(`${name} (empty)`);
    for (const [key, name] of VAR_NAMES) if (!lab.variables[key]) empty.push(`${name} (empty)`);
    for (const [key, name] of SECTION_NAMES.slice(2)) if (!(Array.isArray(lab[key]) ? lab[key].length : lab[key])) empty.push(`${name} (empty)`);
    return [...new Set([...found, ...empty])];
  }

  function asText(lab, title) {
    const lines = [];
    if (String(title || "").trim()) lines.push(`Lab report: ${title.trim()}`, "");
    if (lab.question) lines.push(`Question: ${lab.question}`, "");
    if (lab.hypothesis) lines.push(`Hypothesis: ${lab.hypothesis}`, "");
    const vars = VAR_NAMES.filter(([k]) => lab.variables[k]);
    if (vars.length) lines.push("Variables:", ...vars.map(([k, n]) => `- ${n}: ${lab.variables[k]}`), "");
    if (lab.materials.length) lines.push("Materials:", ...lab.materials.map((m) => `- ${m}`), "");
    if (lab.procedure.length) lines.push("Procedure:", ...lab.procedure.map((s, i) => `${i + 1}. ${s}`), "");
    if (lab.results) lines.push(`Results: ${lab.results}`, "");
    if (lab.conclusion) lines.push(`Conclusion: ${lab.conclusion}`, "");
    if (lab.nextTime) lines.push(`Next time: ${lab.nextTime}`);
    return lines.join("\n").trim();
  }

  // A table from simple "label value unit" pairs in the notes, like "0g 100°C, 10g 100.8°C".
  // Only when every pair uses the same two units and there are at least two; otherwise null.
  function numbersTable(notes) {
    const re = /(?:^|[\s,;(])(-?\d+(?:\.\d+)?)\s?(%|°\s?[CF]|[a-zA-Zµ]{1,6})\s*(?:[:=→]|->|-)?\s*(-?\d+(?:\.\d+)?)\s?(%|°\s?[CF]|[a-zA-Zµ]{1,6})(?=$|[\s,;.)])/g;
    const pairs = [...String(notes || "").matchAll(re)].map((m) => ({ a: m[1], ua: m[2].replace(/\s/g, ""), b: m[3], ub: m[4].replace(/\s/g, "") }));
    if (pairs.length < 2 || pairs.length > 20) return null;
    const { ua, ub } = pairs[0];
    if (ua === ub || pairs.some((p) => p.ua !== ua || p.ub !== ub)) return null;
    return { columns: [`What you changed (${ua})`, `What you measured (${ub})`], rows: pairs.map((p) => [`${p.a} ${ua}`, `${p.b} ${ub}`]) };
  }

  return { MAX_CHARS, buildPrompt, parseLab, parsedOk, missingItems, asText, numbersTable };
})();
if (typeof module !== "undefined") module.exports = LabReport;

if (typeof document !== "undefined") (() => {
  const { MAX_CHARS, buildPrompt, parseLab, parsedOk, missingItems, asText, numbersTable } = LabReport;
  const SAVE_KEY = "local-ai-lab-report";
  const fmt = (n) => n.toLocaleString("en-US");
  const EXAMPLE = {
    title: "Does salt change the boiling point of water?",
    notes: "Tested how salt changes the boiling point of water. Used a pot on the same stove burner every time and a kitchen thermometer. "
      + "500 mL of tap water each time, stirred until the salt dissolved, then heated until it was boiling hard and read the thermometer.\n"
      + "3 trials each with 0g, 10g, 20g salt. Averages: 0g 100°C, 10g 100.8°C, 20g 101.5°C.\n"
      + "More salt = higher boiling point. I thought it would go up a lot more. The thermometer was hard to read when the steam fogged it up.",
  };

  const style = document.createElement("style");
  style.textContent = `
    #lab-dialog { width: min(720px, calc(100vw - 32px)); }
    #lab-dialog label.lab-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #lab-dialog label.lab-field input, #lab-dialog label.lab-field textarea { display: block; width: 100%; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #lab-dialog label.lab-field textarea { min-height: 200px; max-height: 50vh; resize: vertical; line-height: 1.5; }
    #lab-dialog label.lab-field input:focus, #lab-dialog label.lab-field textarea:focus { border-color: var(--accent); }
    .lab-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .lab-count.lab-full { color: var(--accent); font-weight: 600; }
    .lab-example { background: none; border: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: 0.92em; }
    .lab-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .lab-writing { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .lab-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: lab-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes lab-spin { to { transform: rotate(360deg); } }
    .lab-live { max-height: 260px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .lab-card { margin-top: 12px; padding: 4px 18px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--card); }
    .lab-card h3 { margin: 0; padding: 14px 0 2px; font-size: 1.15em; overflow-wrap: anywhere; }
    .lab-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--accent); margin: 16px 0 4px; }
    .lab-card p { margin: 0; line-height: 1.55; overflow-wrap: anywhere; }
    .lab-results { white-space: pre-line; }
    .lab-list { margin: 0; padding-left: 22px; line-height: 1.55; }
    .lab-list li { margin: 3px 0; overflow-wrap: anywhere; }
    .lab-table { width: 100%; border-collapse: collapse; font-size: 0.92em; margin-top: 2px; }
    .lab-table th, .lab-table td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; line-height: 1.45; overflow-wrap: anywhere; }
    .lab-table th { background: var(--panel); font-weight: 600; }
    .lab-vars { table-layout: fixed; }
    .lab-nums { width: auto; min-width: 50%; }
    .lab-add { background: #fde9b8; color: #6b4a00; border-radius: 4px; padding: 0 3px; font-weight: 600; }
    .lab-todo { margin-top: 14px; padding: 10px 14px; border-radius: 12px; border: 1px solid #e8c36a; background: rgba(232, 180, 60, 0.12); }
    .lab-todo b { display: block; margin-bottom: 4px; }
    .lab-todo ul { margin: 0; padding-left: 20px; line-height: 1.5; }
    .lab-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .lab-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .lab-buttons .lab-grow { flex: 1; }
    .lab-setup-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    #lab-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 560px) {
      .lab-card { padding: 2px 12px 12px; }
      .lab-vars thead { display: none; }
      .lab-vars, .lab-vars tbody, .lab-vars tr, .lab-vars td { display: block; width: 100%; }
      .lab-vars td { border-bottom-width: 0; }
      .lab-vars td:last-child { border-bottom-width: 1px; }
      .lab-vars td::before { content: attr(data-label); display: block; font-size: 0.8em; font-weight: 700; color: var(--muted); }
      .lab-nums { width: 100%; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "lab-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🔬 Lab report");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "lab-dialog", "aria-labelledby": "lab-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is writing
  let draft = { title: "", notes: "" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && typeof d.reply === "string" ? d : null; } catch { return null; } };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "lab-title" }, "🔬 Lab report"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  // Text with every "[ADD: ...]" highlighted so the student sees what to fill in.
  const rich = (text) => String(text).split(/(\[ADD:?[^\]]*\])/i).filter(Boolean)
    .map((part) => (/^\[ADD/i.test(part) ? el("mark", { class: "lab-add" }, part) : part));

  function drawSetup(message) {
    const titleIn = el("input", { type: "text", maxlength: "120", placeholder: "Does salt change the boiling point of water?", "aria-label": "Experiment title" });
    titleIn.value = draft.title;
    titleIn.addEventListener("input", () => { draft.title = titleIn.value; });
    const area = el("textarea", { maxlength: String(MAX_CHARS), "aria-label": "Your notes",
      placeholder: "Tested how salt changes the boiling point of water. 3 trials each with 0g, 10g, 20g salt in 500 mL. Times/temps: 0g 100°C, 10g 100.8°C, 20g 101.5°C..." });
    area.value = draft.notes.slice(0, MAX_CHARS);
    const count = el("span", { class: "lab-count", "aria-live": "polite" });
    const update = () => {
      draft.notes = area.value;
      count.textContent = `${fmt(area.value.length)} / ${fmt(MAX_CHARS)} characters`;
      count.classList.toggle("lab-full", area.value.length >= MAX_CHARS);
    };
    area.addEventListener("input", update);
    update();
    const example = el("button", { type: "button", class: "lab-example", onclick: () => {
      titleIn.value = draft.title = EXAMPLE.title;
      area.value = EXAMPLE.notes;
      update();
    } }, "Try an example");
    const go = () => (area.value.trim() ? write(titleIn.value.trim(), area.value.trim()) : (drawSetup("Type your experiment notes first."), null));
    setDialog(head(),
      el("div", { class: "lab-setup-row" },
        el("p", { class: "note" }, "Type your rough notes. The AI on this computer organizes them into a lab report, using only your data."),
        example),
      el("label", { class: "lab-field" }, "Experiment title", titleIn),
      el("label", { class: "lab-field" }, "Your notes", area, count),
      message ? el("p", { class: "lab-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Make lab report")));
    (titleIn.value ? area : titleIn).focus();
  }

  function drawWriting(live) {
    setDialog(head(),
      el("div", { class: "lab-writing" }, el("span", { class: "lab-spin", "aria-hidden": "true" }), "Writing…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  const section = (name, ...body) => [el("span", { class: "lab-sec" }, name), ...body];

  function drawResult(data) {
    const lab = parseLab(data.reply);
    const ok = parsedOk(lab);
    const title = data.title || "";
    const plain = ok ? asText(lab, title) : data.reply.trim();
    const todo = ok ? missingItems(lab) : [];
    const nums = numbersTable(data.notes);
    const v = lab.variables;
    const card = el("div", { class: "lab-card" },
      el("h3", {}, title || "My experiment"),
      ...(lab.question ? section("Question", el("p", {}, ...rich(lab.question))) : []),
      ...(lab.hypothesis ? section("Hypothesis", el("p", {}, ...rich(lab.hypothesis))) : []),
      ...(v.independent || v.dependent || v.controlled ? section("Variables", el("table", { class: "lab-table lab-vars" },
        el("thead", {}, el("tr", {}, el("th", {}, "Independent"), el("th", {}, "Dependent"), el("th", {}, "Controlled"))),
        el("tbody", {}, el("tr", {},
          el("td", { "data-label": "Independent" }, ...rich(v.independent || "—")),
          el("td", { "data-label": "Dependent" }, ...rich(v.dependent || "—")),
          el("td", { "data-label": "Controlled" }, ...rich(v.controlled || "—")))))) : []),
      ...(lab.materials.length ? section("Materials", el("ul", { class: "lab-list" }, ...lab.materials.map((m) => el("li", {}, ...rich(m))))) : []),
      ...(lab.procedure.length ? section("Procedure", el("ol", { class: "lab-list" }, ...lab.procedure.map((s) => el("li", {}, ...rich(s))))) : []),
      ...(lab.results ? section("Results", el("p", { class: "lab-results" }, ...rich(lab.results))) : []),
      ...(nums ? section("Results table (from your notes)", el("table", { class: "lab-table lab-nums" },
        el("thead", {}, el("tr", {}, el("th", {}, nums.columns[0]), el("th", {}, nums.columns[1]))),
        el("tbody", {}, ...nums.rows.map((r) => el("tr", {}, el("td", {}, r[0]), el("td", {}, r[1])))))) : []),
      ...(lab.conclusion ? section("Conclusion", el("p", {}, ...rich(lab.conclusion))) : []),
      ...(lab.nextTime ? section("Next time", el("p", {}, ...rich(lab.nextTime))) : []));
    setDialog(head(),
      ok ? card : el("p", { class: "lab-raw" }, plain || "(no answer)"),
      todo.length ? el("div", { class: "lab-todo" }, el("b", {}, "✏️ To finish"),
        el("ul", {}, ...todo.map((t) => el("li", {}, t)))) : null,
      el("div", { class: "lab-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy"),
        el("button", { onclick: () => ask(title || lab.question || "my experiment") }, "💬 Ask about it"),
        el("span", { class: "lab-grow" }),
        el("button", { onclick: () => { draft = { title, notes: data.notes || "" }; drawSetup(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { draft = { title: "", notes: "" }; drawSetup(); } }, "New report")));
  }

  function ask(topic) {
    dialog.close();
    $("new-chat").click();
    inputEl.value = `Help me improve the conclusion of my lab report on ${topic}`;
    autoResize();
    inputEl.focus();
  }

  async function write(title, notes) {
    draft = { title, notes };
    const model = currentModel();
    if (findModel(model)?.experimental) return drawSetup("TinyGPT is a tiny practice model and can't write lab reports. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "lab-live" }, "Waiting for the AI...");
    drawWriting(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(title, notes), think: false, auto_code: false }),
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
      const data = { title, notes, reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Make lab report to try again.");
      else drawSetup(`Couldn't write the lab report: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) drawResult(saved);
    else drawSetup();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
