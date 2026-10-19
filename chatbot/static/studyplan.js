// "📅 Study plan": tell the AI what a test is on and when it is, and it splits the studying into one
// short task per day up to the test. Each day can be ticked off, and "Study" starts a chat about that
// day's task. Plans are saved in this browser, like chats.
(() => {
  const STORE = "local-ai-study-plans";
  const MAX_DAYS = 14;
  const MAX_PLANS = 10;

  const style = document.createElement("style");
  style.textContent = `
    #plan-dialog { width: min(620px, 94vw); }
    #plan-dialog form { display: grid; gap: 10px; margin-top: 12px; }
    #plan-dialog label { display: grid; gap: 4px; font-weight: 600; font-size: 0.95em; }
    #plan-dialog input:not([type=checkbox]) { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--border-strong);
      border-radius: 8px; background: var(--card); color: var(--text); }
    #plan-dialog .plans { display: grid; gap: 8px; margin: 12px 0; }
    #plan-dialog .plan-card { text-align: left; display: grid; gap: 6px; padding: 10px 14px; white-space: normal; }
    #plan-dialog .bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
    #plan-dialog .bar span { display: block; height: 100%; background: var(--fast); }
    #plan-dialog .sub { color: var(--muted); font-size: 0.88em; font-weight: 400; }
    #plan-dialog ol { list-style: none; padding: 0; margin: 12px 0; max-height: calc(100vh - 280px); overflow-y: auto; }
    #plan-dialog li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; }
    #plan-dialog li.today { background: var(--accent-soft); }
    #plan-dialog li.done .task { text-decoration: line-through; color: var(--faint); }
    #plan-dialog li input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--fast); }
    #plan-dialog li .when { display: block; font-size: 0.82em; color: var(--muted); }
    #plan-dialog li.today .when { color: var(--accent); font-weight: 700; }
    #plan-dialog li .text { flex: 1; min-width: 0; }
    #plan-dialog li button { font-size: 0.85em; padding: 3px 10px; flex-shrink: 0; }
    #plan-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    #plan-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const link = el("button", { id: "plan-link", class: "sidebar-link plain", type: "button",
    title: "Let the AI split your studying into one task a day before a test", onclick: () => open() }, "📅 Study plan");
  ($("files-link") || $("personal-link")).after(link);

  const dialog = el("dialog", { id: "plan-dialog", "aria-labelledby": "plan-title" });
  document.body.append(dialog);
  let making = null;

  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
  };
  const save = (plans) => localStorage.setItem(STORE, JSON.stringify(plans.slice(0, MAX_PLANS)));

  // Dates are kept as "YYYY-MM-DD" in local time, so "today" doesn't shift with time zones.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 86400000);
  const nice = (s) => fromIso(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  // Read "Day 1: task" lines, tolerating bullets, bold text and dashes, and keep one task per day in order.
  function parsePlan(text, days) {
    const tasks = [];
    for (const raw of text.split("\n")) {
      const m = raw.replace(/\*\*/g, "").match(/^\W*day\s*(\d+)\s*(?:[:.)–—-]|\s)\s*(.+)$/i);
      if (!m) continue;
      const day = Number(m[1]);
      if (day >= 1 && day <= days && !tasks[day - 1]) tasks[day - 1] = m[2].trim().slice(0, 160);
    }
    return tasks.filter(Boolean);
  }

  // Spread the tasks over the days from today up to the day before the test.
  function schedule(tasks, start) {
    return tasks.map((task, i) => ({ date: addDays(start, i), task, done: false }));
  }

  async function makePlan(topic, days) {
    const model = currentModel();
    if (!model) throw new Error("Pick an AI model in Models first.");
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    const prompt = `Make a study plan for a student who has a test on: ${topic}\n`
      + `The test is in ${days} day${days === 1 ? "" : "s"}. Split the studying into exactly ${days} short tasks, one per day, `
      + "from the basics to harder parts, and make the last day a review with practice questions. "
      + `Write exactly ${days} lines in this form and nothing else:\nDay 1: what to study (under 15 words)`;
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], think: false, auto_code: false }),
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
    return parsePlan(text, days);
  }

  const head = (back) => el("div", { class: "dialog-head" },
    el("h2", { id: "plan-title" }, back ? el("button", { class: "icon", "aria-label": "All plans", onclick: () => drawHome() }, "←") : null, " 📅 Study plan"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  const progress = (plan) => {
    const done = plan.days.filter((d) => d.done).length;
    return el("div", { class: "bar", title: `${done} of ${plan.days.length} done` },
      el("span", { style: `width:${Math.round((done / plan.days.length) * 100)}%` }));
  };

  function drawHome(error) {
    const plans = load();
    const today = iso(new Date());
    const topic = el("input", { name: "topic", required: true, maxlength: 120, placeholder: "e.g. Chapter 5: the water cycle" });
    const date = el("input", { name: "date", type: "date", required: true, min: addDays(today, 1), max: addDays(today, MAX_DAYS),
      value: addDays(today, 5) });
    const form = el("form", { onsubmit: (e) => { e.preventDefault(); create(topic.value.trim(), date.value); } },
      el("label", {}, "What is the test on?", topic),
      el("label", {}, "When is the test?", date),
      error ? el("p", { class: "note", style: "color:var(--danger);margin:0" }, error) : null,
      el("div", { class: "footer" }, el("span", { class: "grow" }), el("button", { class: "primary", type: "submit" }, "Make my plan")));
    dialog.replaceChildren(head(false),
      plans.length ? el("div", { class: "plans" }, ...plans.map((plan) => {
        const left = daysBetween(today, plan.test);
        return el("button", { class: "plan-card", onclick: () => drawPlan(plan.id) },
          el("span", {}, plan.topic),
          el("span", { class: "sub" }, left > 1 ? `Test in ${left} days · ${nice(plan.test)}` : left === 1 ? "Test is tomorrow!" : left === 0 ? "Test is today. Good luck!" : `Test was ${nice(plan.test)}`),
          progress(plan));
      })) : el("p", { class: "note" }, "Tell the AI what your test is on and when, and it will plan one short study task for each day before it."),
      form);
    if (!plans.length) topic.focus();
  }

  function drawPlan(id) {
    const plans = load();
    const plan = plans.find((p) => p.id === id);
    if (!plan) return drawHome();
    const today = iso(new Date());
    const rows = plan.days.map((day, i) => {
      const box = el("input", { type: "checkbox", "aria-label": `Done: ${day.task}`, checked: day.done });
      const row = el("li", { class: [day.date === today ? "today" : "", day.done ? "done" : ""].join(" ").trim() },
        box, el("span", { class: "text" }, el("span", { class: "when" }, day.date === today ? "Today" : nice(day.date)),
          el("span", { class: "task" }, day.task)),
        el("button", { title: "Start a chat about this task", onclick: () => study(plan, day) }, "Study"));
      box.addEventListener("change", () => {
        plan.days[i].done = box.checked;
        row.classList.toggle("done", box.checked);
        save(plans);
        dialog.querySelector(".bar span").style.width = `${Math.round((plan.days.filter((d) => d.done).length / plan.days.length) * 100)}%`;
      });
      return row;
    });
    dialog.replaceChildren(head(true),
      el("p", { style: "margin:10px 0 6px;font-weight:600" }, plan.topic, el("span", { class: "sub" }, ` · test on ${nice(plan.test)}`)),
      progress(plan),
      el("ol", {}, ...rows),
      el("p", { class: "note" }, "Made by the AI. Check it against what your teacher said will be on the test."),
      el("div", { class: "footer" },
        el("button", { class: "danger", onclick: () => { save(plans.filter((p) => p.id !== id)); drawHome(); } }, "Delete plan"),
        el("span", { class: "grow" }),
        el("button", { class: "primary", onclick: () => dialog.close() }, "Done")));
  }

  function study(plan, day) {
    dialog.close();
    $("new-chat").click();
    inputEl.value = `Help me study for my test on ${plan.topic}. Task: ${day.task}. Teach it simply, then ask me a few questions.`;
    autoResize();
    inputEl.focus();
  }

  async function create(topic, test) {
    const today = iso(new Date());
    const days = Math.min(daysBetween(today, test), MAX_DAYS);
    if (!topic || !(days >= 1)) return drawHome("Pick a test date between tomorrow and two weeks from now.");
    dialog.replaceChildren(head(false), el("p", {}, "Planning your studying... This takes a few seconds with a small model, longer with a big one."));
    try {
      const tasks = await makePlan(topic, days);
      if (!tasks.length) return drawHome("The AI didn't write the plan in a form the app can read. Try again, or pick a bigger model.");
      const plan = { id: Date.now().toString(36), topic, test, days: schedule(tasks, today) };
      save([plan, ...load()]);
      if (dialog.open) drawPlan(plan.id);
    } catch (err) {
      if (err.name !== "AbortError") drawHome(`Couldn't make a plan: ${err.message}`);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    drawHome();
  }

  dialog.addEventListener("close", () => making?.abort());
})();
