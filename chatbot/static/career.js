// "🧭 Career explorer": a student picks the school subjects they like, and can add hobbies and
// their grade. The AI on this computer suggests exactly 3 careers, each with what the job is,
// why it fits them, classes to take in high school, one free thing to try this week and the
// usual education path. "Show 3 different careers" asks again without the ones already shown.
// Nothing leaves the computer; the last result is kept in this browser.

// Pure helpers (no page needed), so test_career.py can run them with Node.
const LocalAICareer = (() => {
  const SUBJECTS = ["Math", "Science", "English", "History", "Art", "Music", "Computers", "Sports/PE", "Languages", "Building things", "Helping people", "Business"];
  const GRADES = ["6", "7", "8", "9", "10", "11", "12"];
  const MAX_HOBBIES = 300;
  const MAX_CAREERS = 3;
  const MAX_CLASSES = 3;
  const MAX_EXCLUDE = 30;
  const NOTE = "Salary and job data change, so check with a school counselor or the BLS Occupational Outlook Handbook.";

  const clean = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const ordinal = (g) => { const n = Number(g); return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`; };
  const gradeText = (g) => (GRADES.includes(String(g)) ? `${ordinal(g)} grade` : "");

  function buildPrompt(interests, hobbies, grade, exclude) {
    const picked = (Array.isArray(interests) ? interests : []).filter((s) => SUBJECTS.includes(s));
    const enjoy = clean(hobbies, MAX_HOBBIES);
    const skip = [...new Set((Array.isArray(exclude) ? exclude : []).map((x) => clean(x, 80)).filter(Boolean))].slice(-MAX_EXCLUDE);
    const system = "You are a friendly school career counselor. Suggest exactly 3 different real careers that fit this student. "
      + "Be honest and encouraging, use simple words, and do not give salaries or job numbers. "
      + "Tie WHY IT FITS to the student's own subjects and hobbies. TRY IT must be one free thing they can do this week. "
      + "EDUCATION is the usual path, such as 2-year degree, 4-year degree, apprenticeship or certificate.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "CAREER 1: career name\nWHAT THEY DO: 1 or 2 sentences\nWHY IT FITS: 1 or 2 sentences\nCLASSES: class, class, class\nTRY IT: one free thing to try this week\nEDUCATION: the usual path\n\n"
      + "CAREER 2: ...\n(same lines)\n\nCAREER 3: ...\n(same lines)";
    const lines = [];
    lines.push(`Favorite subjects: ${picked.length ? picked.join(", ") : "not given"}`);
    lines.push(`What I enjoy: ${enjoy || "not given"}`);
    if (gradeText(grade)) lines.push(`Grade: ${gradeText(grade)}`);
    if (skip.length) lines.push(`Do not suggest any of these careers (I already saw them): ${skip.join(", ")}`);
    return [{ role: "system", content: system }, { role: "user", content: lines.join("\n") }];
  }

  const FIELDS = [
    ["what", /^(?:what\s+(?:they|you)\s+do|what\s+it\s+is|job|description|about)$/i],
    ["why", /^(?:why\s+it\s+fits(?:\s+you)?|why\s+(?:it'?s\s+)?a\s+(?:good\s+)?fit|why\s+you|fit)$/i],
    ["classes", /^(?:(?:high\s+school\s+)?classes(?:\s+to\s+take)?(?:\s+in\s+high\s+school)?|courses|subjects\s+to\s+take)$/i],
    ["tryit", /^(?:try\s+it(?:\s+now|\s+this\s+week)?|try\s+this(?:\s+week)?|try)$/i],
    ["education", /^(?:education(?:\s+path)?|training|path|school(?:ing)?)$/i],
  ];
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const HEADER = /^(?:career|job|option)\s*#?\s*(\d)\s*(?:[:.)\-–—]\s*)?(.*)$/i;
  const NUMBERED = /^(\d)[.)]\s+(.*)$/;
  const strip = (s) => String(s).replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
  const tidyName = (s) => clean(String(s).replace(/^[-:–—\s]+/, "").replace(/[*_`]/g, "").replace(/\s*[:.]$/, "").replace(/^["'“”]+|["'“”]+$/g, ""), 80);

  function fieldOf(line) {
    const m = line.match(/^([A-Za-z' ]{2,40}?)\s*(?:\([^)]{0,40}\))?\s*:\s*(.*)$/);
    if (!m) return null;
    const hit = FIELDS.find(([, re]) => re.test(m[1].trim()));
    return hit ? { key: hit[0], rest: m[2].trim() } : null;
  }

  function addClasses(card, text) {
    for (const part of String(text).split(/\s*[,;|•]\s*|\s+-\s+/)) {
      const c = clean(part.replace(BULLET, "").replace(/[*_`]/g, "").replace(/\.$/, "").replace(/^and\s+/i, ""), 60);
      if (c && card.classes.length < MAX_CLASSES && !card.classes.some((x) => x.toLowerCase() === c.toLowerCase())) card.classes.push(c);
    }
  }

  // [{ name, what, why, classes: [..3], tryit, education }], at most 3.
  function parseCareers(text) {
    const cards = [];
    let card = null;
    let field = null;
    const start = (name) => { card = { name: tidyName(name), what: "", why: "", classes: [], tryit: "", education: "" }; cards.push(card); field = card.name ? null : "name"; };
    for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      const bare = strip(raw);
      if (!bare) continue;
      const line = bare.replace(/^[-*•‣–]\s+/, "");
      let m = line.match(HEADER);
      if (m && !fieldOf(line)) { start(m[2]); continue; }
      m = line.match(NUMBERED);
      if (m && !fieldOf(m[2]) && Number(m[1]) === cards.length + 1 && !(field === "classes" && card && card.classes.length < MAX_CLASSES)) { start(strip(m[2])); continue; }
      const f = fieldOf(line.replace(BULLET, ""));
      if (f && card) {
        field = f.key;
        if (field === "classes") addClasses(card, f.rest);
        else if (f.rest) card[field] = clean(f.rest);
        continue;
      }
      if (!card) continue;
      if (field === "name") { card.name = tidyName(line); field = null; }
      else if (field === "classes") addClasses(card, line);
      else if (field) card[field] = clean(`${card[field]} ${line.replace(BULLET, "")}`);
    }
    return cards.filter((c) => c.name).slice(0, MAX_CAREERS);
  }

  // Good enough to show as cards: at least one career with a name and a description.
  function parsedOk(cards) {
    return Array.isArray(cards) && cards.length > 0 && cards.every((c) => c && c.name && (c.what || c.why));
  }

  function toPlainText(parsed) {
    const cards = typeof parsed === "string" ? parseCareers(parsed) : Array.isArray(parsed) ? parsed : [];
    if (!cards.length) return "";
    const blocks = cards.map((c, i) => [
      `${i + 1}. ${c.name}`,
      c.what && `What they do: ${c.what}`,
      c.why && `Why it fits you: ${c.why}`,
      c.classes && c.classes.length && `Classes to take in high school: ${c.classes.join(", ")}`,
      c.tryit && `Try it now: ${c.tryit}`,
      c.education && `Education path: ${c.education}`,
    ].filter(Boolean).join("\n"));
    return `Career ideas\n\n${blocks.join("\n\n")}\n\n${NOTE}`;
  }

  return { SUBJECTS, GRADES, MAX_HOBBIES, MAX_CAREERS, MAX_CLASSES, NOTE, gradeText, buildPrompt, parseCareers, parsedOk, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAICareer = LocalAICareer;
if (typeof module !== "undefined") module.exports = LocalAICareer;

if (typeof document !== "undefined") (() => {
  const { SUBJECTS, GRADES, MAX_HOBBIES, NOTE, gradeText, buildPrompt, parseCareers, parsedOk, toPlainText } = LocalAICareer;
  const SAVE_KEY = "local-ai-career";

  const style = document.createElement("style");
  style.textContent = `
    #career-dialog { width: min(1040px, calc(100vw - 32px)); }
    .cr-group { margin-top: 12px; font-weight: 600; }
    .cr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; font-weight: 400; }
    .cr-chips button { padding: 5px 12px; border-radius: 999px; }
    .cr-chips button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .cr-row { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 12px; margin-top: 12px; }
    .cr-field { display: block; font-weight: 600; min-width: 0; }
    .cr-field input, .cr-field select { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .cr-field input:focus, .cr-field select:focus { border-color: var(--accent); }
    .cr-private { margin: 12px 0 0; font-size: 0.82em; color: var(--muted); }
    .cr-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .cr-for { margin: 4px 0 0; font-size: 0.88em; color: var(--muted); overflow-wrap: anywhere; }
    .cr-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .cr-card { padding: 14px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0; overflow-wrap: anywhere; }
    .cr-num { display: block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); }
    .cr-name { margin: 2px 0 6px; font-size: 1.15em; line-height: 1.3; }
    .cr-label { display: block; margin-top: 10px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
    .cr-text { margin: 2px 0 0; line-height: 1.5; font-size: 0.94em; }
    .cr-classes { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0; padding: 0; list-style: none; }
    .cr-classes li { padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); font-size: 0.86em; }
    .cr-try { margin: 4px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; font-size: 0.94em; }
    .cr-edu { display: inline-block; margin-top: 4px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); font-size: 0.86em; font-weight: 600; }
    .cr-note { margin: 12px 0 0; font-size: 0.85em; color: var(--muted); line-height: 1.45; }
    .cr-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; }
    .cr-working { display: flex; align-items: center; gap: 10px; font-weight: 600; flex-wrap: wrap; margin-top: 12px; }
    .cr-working .cr-grow { flex: 1; }
    .cr-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: cr-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes cr-spin { to { transform: rotate(360deg); } }
    .cr-live { max-height: 280px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em; color: var(--muted);
      padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 10px 0 0; font-family: inherit; }
    .cr-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .cr-buttons .cr-grow { flex: 1; }
    .cr-buttons button { white-space: nowrap; }
    #career-dialog button:disabled { opacity: 0.55; cursor: default; }
    @media (max-width: 860px) { .cr-cards { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) {
      .cr-row { grid-template-columns: minmax(0, 1fr); }
      .cr-buttons .cr-grow { display: none; }
      .cr-buttons button { flex: 1 1 auto; }
      .cr-buttons button.cr-wide { flex-basis: 100%; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "career-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🧭 Career explorer");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "career-dialog", "aria-labelledby": "career-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  const blank = () => ({ interests: [], hobbies: "", grade: "" });
  let draft = blank();

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const forget = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !Array.isArray(d.interests) || typeof d.reply !== "string" || !d.reply.trim()) return null;
      return { interests: d.interests.filter((s) => SUBJECTS.includes(s)), hobbies: typeof d.hobbies === "string" ? d.hobbies : "",
        grade: GRADES.includes(d.grade) ? d.grade : "", exclude: Array.isArray(d.exclude) ? d.exclude.filter((x) => typeof x === "string") : [], reply: d.reply };
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "career-title" }, "🧭 Career explorer"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));
  const privacy = () => el("p", { class: "cr-private" }, "🔒 Your answers stay on this computer.");

  function drawInput(message) {
    const was = busy;
    busy = null;
    was?.abort();
    const msg = message ? el("p", { class: "cr-msg", role: "alert" }, message) : null;
    const chips = SUBJECTS.map((s) => el("button", { type: "button", "aria-pressed": String(draft.interests.includes(s)),
      onclick: (e) => {
        msg?.remove();
        draft.interests = draft.interests.includes(s) ? draft.interests.filter((x) => x !== s) : [...draft.interests, s];
        e.currentTarget.setAttribute("aria-pressed", String(draft.interests.includes(s)));
      } }, s));
    const hobbies = el("input", { type: "text", maxlength: String(MAX_HOBBIES), placeholder: "e.g. drawing comics, video games, cooking, fixing bikes" });
    hobbies.value = draft.hobbies;
    hobbies.addEventListener("input", () => { draft.hobbies = hobbies.value; msg?.remove(); });
    const grade = el("select", {}, el("option", { value: "" }, "Not saying"), ...GRADES.map((g) => el("option", { value: g }, gradeText(g))));
    grade.value = draft.grade;
    grade.addEventListener("change", () => { draft.grade = grade.value; });
    const go = () => {
      if (!draft.interests.length && !draft.hobbies.trim()) return drawInput("Pick at least one subject or tell us something you enjoy.");
      run({ interests: SUBJECTS.filter((s) => draft.interests.includes(s)), hobbies: draft.hobbies.trim(), grade: draft.grade, exclude: [] });
    };
    hobbies.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    setDialog(head(),
      el("p", { class: "note" }, "Pick what you like at school and add your hobbies. The AI on this computer suggests 3 careers that fit you, with classes to take and something to try this week."),
      el("div", { class: "cr-group", role: "group", "aria-label": "Favorite subjects" }, "Favorite subjects", el("div", { class: "cr-chips" }, ...chips)),
      el("div", { class: "cr-row" },
        el("label", { class: "cr-field" }, "Hobbies or what you enjoy (optional)", hobbies),
        el("label", { class: "cr-field" }, "Grade (optional)", grade)),
      msg,
      privacy(),
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Suggest 3 careers")));
  }

  function forLine(data) {
    const bits = [data.interests.join(", "), data.hobbies && `enjoys ${data.hobbies}`, gradeText(data.grade)].filter(Boolean);
    return el("p", { class: "cr-for" }, `For: ${bits.join(" · ")}`);
  }

  function cardView(c, i) {
    const part = (label, node) => (node ? [el("span", { class: "cr-label" }, label), node] : []);
    return el("article", { class: "cr-card" },
      el("span", { class: "cr-num" }, `Career ${i + 1}`),
      el("h3", { class: "cr-name" }, c.name),
      ...part("What they do", c.what ? el("p", { class: "cr-text" }, c.what) : null),
      ...part("Why it fits you", c.why ? el("p", { class: "cr-text" }, c.why) : null),
      ...part("Classes to take in high school", c.classes.length ? el("ul", { class: "cr-classes" }, ...c.classes.map((x) => el("li", {}, x))) : null),
      ...part("Try it now", c.tryit ? el("p", { class: "cr-try" }, `✅ ${c.tryit}`) : null),
      ...part("Education path", c.education ? el("span", { class: "cr-edu" }, `🎓 ${c.education}`) : null));
  }

  function buttons(data, ready) {
    const cards = ready ? parseCareers(data.reply) : [];
    const ok = parsedOk(cards);
    return el("div", { class: "cr-buttons" },
      el("button", { class: "primary cr-wide", disabled: !ready, onclick: () => {
        run({ ...data, exclude: [...(data.exclude || []), ...cards.map((c) => c.name)] });
      } }, "🔄 Show 3 different careers"),
      el("span", { class: "cr-grow" }),
      el("button", { disabled: !ready, onclick: (e) => copyText(e.currentTarget, ok ? toPlainText(cards) : `${data.reply.trim()}\n\n${NOTE}`) }, "📋 Copy as text"),
      el("button", { onclick: () => { forget(); draft = blank(); drawInput(); } }, "Start over"));
  }

  function drawResult(data, middle) {
    let body = middle;
    if (!body) {
      const cards = parseCareers(data.reply);
      body = parsedOk(cards) ? el("div", { class: "cr-cards" }, ...cards.map(cardView))
        : el("div", {}, el("p", { class: "cr-msg" }, "The AI didn't answer in the usual layout, so here is its answer as it wrote it."),
          el("pre", { class: "cr-raw" }, data.reply.trim()));
    }
    setDialog(head(), forLine(data), body,
      el("p", { class: "cr-note" }, `💡 ${NOTE} These are ideas to explore, not a test result.`),
      privacy(),
      buttons(data, !middle && !!data.reply));
  }

  async function run(input) {
    const data = { interests: input.interests, hobbies: input.hobbies, grade: input.grade, exclude: input.exclude || [], reply: "" };
    draft = { interests: [...data.interests], hobbies: data.hobbies, grade: data.grade };
    if (findModel(currentModel())?.experimental) {
      return drawInput("TinyGPT is a tiny practice model, so it can't suggest careers. Pick a real chat model in Models, then try again.");
    }
    const model = currentModel();
    const ctl = new AbortController();
    busy = ctl;
    const live = el("pre", { class: "cr-live" }, "Waiting for the AI...");
    drawResult(data, el("div", {},
      el("div", { class: "cr-working" }, el("span", { class: "cr-spin", "aria-hidden": "true" }),
        data.exclude.length ? "Finding 3 different careers…" : "Finding careers that fit you…",
        el("span", { class: "cr-grow" }), el("button", { onclick: () => ctl.abort() }, "■ Stop")),
      el("p", { class: "cr-note" }, "A small model takes a few seconds; a big one can take a minute."),
      live));
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(data.interests, data.hobbies, data.grade, data.exclude), think: false, auto_code: false }),
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
      drawInput(err.name === "AbortError" ? "Stopped. Press Suggest 3 careers to try again." : `Couldn't get career ideas: ${err.message}`);
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) { draft = { interests: [...saved.interests], hobbies: saved.hobbies, grade: saved.grade }; drawResult(saved); }
    else drawInput();
  }

  dialog.addEventListener("close", () => { busy?.abort(); });
})();
