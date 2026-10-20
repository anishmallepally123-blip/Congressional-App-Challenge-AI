// "🧮 Check my steps": a student types a math (or science) problem and their own working, one step
// per line. The AI finds the first step with a mistake and explains it with a hint, without giving
// away the answer, so the student fixes it themselves instead of copying a solution.
(() => {
  const MAX_STEPS = 20;
  const PROMPT = "A student solved a problem step by step. Check the steps in order and find the FIRST step that has a mistake. "
    + "Do not solve the problem for them and do not give the final answer.\n"
    + "Reply in exactly this form:\n"
    + "VERDICT: CORRECT\n(if every step is right), or:\n"
    + "VERDICT: STEP <number>\nWHY: one or two simple sentences saying what went wrong in that step\n"
    + "HINT: one short hint that helps the student fix it\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #steps-dialog { width: min(640px, 94vw); }
    #steps-dialog label { display: grid; gap: 4px; font-weight: 600; font-size: 0.95em; margin-top: 12px; }
    #steps-dialog input, #steps-dialog textarea { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--border-strong);
      border-radius: 8px; background: var(--card); color: var(--text); box-sizing: border-box; width: 100%; }
    #steps-dialog textarea { min-height: 150px; max-height: 40vh; resize: vertical; font-family: ui-monospace, Menlo, Consolas, monospace; }
    #steps-dialog ol { list-style: none; padding: 0; margin: 14px 0; display: grid; gap: 6px; }
    #steps-dialog li { display: flex; gap: 10px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); }
    #steps-dialog li .mark { width: 22px; flex-shrink: 0; text-align: center; }
    #steps-dialog li .work { font-family: ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    #steps-dialog li.ok { border-color: color-mix(in srgb, var(--fast) 45%, var(--border)); }
    #steps-dialog li.bad { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--card)); }
    #steps-dialog li.later { opacity: 0.55; }
    #steps-dialog .why { margin: 6px 0 0; font-family: inherit; }
    #steps-dialog .step-hint { margin: 4px 0 0; color: var(--muted); }
    #steps-dialog .summary { margin: 12px 0 0; font-weight: 600; }
    #steps-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    #steps-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const link = el("button", { id: "steps-link", class: "sidebar-link plain", type: "button",
    title: "The AI finds the first mistake in your working, with a hint", onclick: () => open() }, "🧮 Check my steps");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "steps-dialog", "aria-labelledby": "steps-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let problem = "";
  let working = "";
  let making = null;

  // One step per non-empty line, with any "1." or "Step 2:" the student typed taken off.
  const splitSteps = (text) => text.split("\n")
    .map((line) => line.replace(/^\s*(?:step\s*)?\d+\s*[.):]\s*/i, "").trim())
    .filter(Boolean)
    .slice(0, MAX_STEPS);

  // Read the AI's verdict: { wrong: step number or 0 when every step is right, why, hint }, or null if unreadable.
  function parseVerdict(text, count) {
    const clean = text.replace(/\*\*/g, "");
    const verdict = clean.match(/verdict\s*:\s*(correct|all correct|step\s*(\d+))/i);
    if (!verdict) return null;
    const field = (name) => (clean.match(new RegExp(`^\\W*${name}\\s*:\\s*(.+)$`, "im"))?.[1] || "").trim();
    if (!verdict[2]) return { wrong: 0, why: "", hint: "" };
    const wrong = Number(verdict[2]);
    if (wrong < 1 || wrong > count) return null;
    return { wrong, why: field("why"), hint: field("hint") };
  }

  async function check(problemText, steps) {
    const model = currentModel();
    if (!model) throw new Error("Pick an AI model in Models first.");
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    const content = `${PROMPT}Problem: ${problemText}\n\nThe student's steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], think: true, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let text = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") text += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    return parseVerdict(text, steps.length);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "steps-title" }, "🧮 Check my steps"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(error) {
    const prob = el("input", { maxlength: 300, placeholder: "e.g. Solve 3x + 5 = 20" });
    prob.value = problem;
    const work = el("textarea", { placeholder: "3x + 5 = 20\n3x = 25\nx = 25 / 3", spellcheck: "false" });
    work.value = working;
    const go = el("button", { class: "primary", type: "button" }, "Check my steps");
    const update = () => {
      problem = prob.value;
      working = work.value;
      go.disabled = !prob.value.trim() || !splitSteps(work.value).length;
    };
    prob.addEventListener("input", update);
    work.addEventListener("input", update);
    go.addEventListener("click", () => run());
    update();
    setDialog(head(),
      el("p", { class: "note" }, "Write your working one step per line. The AI points to the first mistake and gives a hint, not the answer."),
      el("label", {}, "The problem", prob),
      el("label", {}, "Your steps", work),
      error ? el("p", { class: "note", style: "color:var(--danger)" }, error) : null,
      el("div", { class: "footer" }, el("span", { class: "grow" }), go));
    (problem ? work : prob).focus();
  }

  function drawResult(steps, result) {
    const rows = steps.map((step, i) => {
      const n = i + 1;
      const state = !result.wrong || n < result.wrong ? "ok" : n === result.wrong ? "bad" : "later";
      return el("li", { class: state },
        el("span", { class: "mark" }, state === "ok" ? "✅" : state === "bad" ? "❌" : `${n}`),
        el("div", {}, el("div", { class: "work" }, step),
          state === "bad" && result.why ? el("p", { class: "why" }, result.why) : null,
          state === "bad" && result.hint ? el("p", { class: "step-hint" }, `💡 Hint: ${result.hint}`) : null));
    });
    setDialog(head(),
      el("p", { class: "summary" }, result.wrong
        ? `Step ${result.wrong} has a mistake.${result.wrong === 2 ? " The step before it looks right." : result.wrong > 2 ? ` The ${result.wrong - 1} steps before it look right.` : ""}`
        : "✅ Every step looks right. Nice work!"),
      el("p", { class: "note", style: "margin:4px 0 0" }, problem),
      el("ol", {}, ...rows),
      el("p", { class: "note" }, "AI can make mistakes too. If you think your step is right, ask your teacher or try a bigger model."),
      el("div", { class: "footer" },
        el("span", { class: "grow" }),
        el("button", { class: "primary", onclick: () => drawInput() }, result.wrong ? "Fix my steps" : "Check another")));
  }

  async function run() {
    const steps = splitSteps(working);
    if (!problem.trim() || !steps.length) return;
    setDialog(head(), el("p", {}, "Checking each step... The AI thinks this through, so it can take a little longer than a normal answer."));
    try {
      const result = await check(problem.trim(), steps);
      if (!result) return drawInput("The AI didn't answer in a form the app can read. Try again, or pick a bigger model.");
      if (dialog.open) drawResult(steps, result);
    } catch (err) {
      if (err.name !== "AbortError") drawInput(`Couldn't check it: ${err.message}`);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    drawInput();
  }

  dialog.addEventListener("close", () => making?.abort());
})();
