// "📄 Resume builder": a high-school student fills in a short form (school, jobs, volunteering,
// clubs) and the AI on this computer turns each "what did you do?" into 2–3 resume bullet points,
// using only the facts the student gave. The form and the resume are kept in this browser.

// Pure helpers (no page needed), so test_resume.py can run them with Node.
const ResumeBuilder = (() => {
  const MAX_JOBS = 6;
  const MAX_DID = 800;

  const clean = (s) => String(s == null ? "" : s).trim();
  const blankJob = () => ({ title: "", place: "", dates: "", did: "" });
  const blankData = () => ({ name: "", email: "", phone: "", city: "", school: "", gradYear: "", gpa: "", jobs: [blankJob()], skills: "", awards: "" });

  const EXAMPLE = {
    name: "Maya Rodriguez", email: "maya.rodriguez@example.com", phone: "(555) 214-7788", city: "Springfield, IL",
    school: "Lincoln High School", gradYear: "2027", gpa: "3.7",
    jobs: [
      { title: "Cashier", place: "Fresh Market Grocery", dates: "Jun 2025 – Present",
        did: "I work the register on weekends and help customers find things. I also restock shelves and train new cashiers on the register when the manager asks." },
      { title: "Volunteer Tutor", place: "Springfield Public Library", dates: "Sep 2024 – May 2025",
        did: "I helped middle school kids with math homework every Tuesday after school. I made practice worksheets for fractions." },
    ],
    skills: "Customer service, Spanish (fluent), Google Docs and Sheets, Teamwork",
    awards: "Honor Roll (2023–2025)\nVarsity Cross Country, team captain\nMath Club member",
  };

  // Only rows with something written in them count.
  const usedJobs = (data) => (data && Array.isArray(data.jobs) ? data.jobs : []).filter((j) => j && (clean(j.title) || clean(j.place) || clean(j.did)));
  const splitSkills = (s) => clean(s).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const splitLines = (s) => clean(s).split(/\r?\n/).map((x) => x.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean);

  function buildPrompt(data) {
    const jobs = usedJobs(data);
    const n = jobs.length;
    const system = "You help a high school student write their first resume. "
      + "Use ONLY the facts the student gives. Never make up numbers, names, awards, tools or results that are not in their words. "
      + "Start every bullet with a strong action verb (like Served, Organized, Trained, Built, Led, Helped). "
      + "Keep each bullet under 20 words. Write 2 or 3 bullets for each job.\n"
      + "Answer in exactly this format and nothing else:\n"
      + "OBJECTIVE: one sentence about what the student offers and is looking for\n"
      + "JOB 1:\n- bullet\n- bullet\n"
      + (n > 1 ? "JOB 2:\n- bullet\n- bullet\n" : "")
      + `(write one JOB section for each of the ${n} experience${n === 1 ? "" : "s"}, in the same order)`;
    const lines = [`Write a one-sentence objective and resume bullets for my ${n} experience${n === 1 ? "" : "s"}.`, ""];
    const school = [clean(data.school), clean(data.gradYear) ? `class of ${clean(data.gradYear)}` : ""].filter(Boolean).join(", ");
    if (school) lines.push(`School: ${school}`);
    jobs.forEach((j, i) => {
      const where = [clean(j.title), clean(j.place) ? `at ${clean(j.place)}` : ""].filter(Boolean).join(" ");
      lines.push("", `JOB ${i + 1}: ${where || "Experience"}${clean(j.dates) ? ` (${clean(j.dates)})` : ""}`,
        `What I did: ${clean(j.did).slice(0, MAX_DID) || "(not written)"}`);
    });
    const skills = splitSkills(data.skills);
    if (skills.length) lines.push("", `Skills: ${skills.join(", ")}`);
    const awards = splitLines(data.awards);
    if (awards.length) lines.push(`Awards and activities: ${awards.join("; ")}`);
    return [{ role: "system", content: system }, { role: "user", content: lines.join("\n") }];
  }

  // The student's own words, split into sentences, for a job the AI skipped.
  function sentences(text) {
    return clean(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().replace(/^[-*•]\s*/, ""))
      .filter((s) => /[a-z0-9]/i.test(s)).map((s) => s[0].toUpperCase() + s.slice(1)).slice(0, 3);
  }

  const OBJ = /^(?:career\s*)?(?:objective|summary|goal)\b\s*[:\-–—]?\s*(.*)$/i;
  const JOB = /^(?:job|experience|position|role|work)\s*#?\s*(\d{1,2})\b\s*[:.\-–—)]?\s*(.*)$/i;
  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const MAX_BULLETS = 4;

  // -> { objective, bullets: [[...], ...] } with exactly `count` lists.
  function parseResume(text, count, jobs) {
    const n = Math.max(0, count | 0);
    const bullets = Array.from({ length: n }, () => []);
    let objective = "";
    let section = null; // "obj" or a job index
    let lastJob = -1;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bare = line.replace(BULLET, "");
      const obj = bare.match(OBJ);
      const job = bare.match(JOB);
      if (obj) { section = "obj"; line = obj[1].trim(); if (!line) continue; objective = objective ? `${objective} ${line}` : line; continue; }
      if (job) { section = Number(job[1]) - 1; lastJob = section; continue; } // any title after "JOB 1:" is ours, not a bullet
      const isBullet = BULLET.test(line);
      const item = bare.replace(/^\*\s*|\s*\*$/g, "").replace(/^["“]|["”]$/g, "").trim();
      if (!item || /^(?:none|n\/a)\.?$/i.test(item)) continue;
      if (section === "obj" && !isBullet) { objective = `${objective} ${item}`.trim(); continue; }
      if (section === null || section === "obj") {
        if (!isBullet) continue; // chatty intro text
        section = lastJob + 1; lastJob = section; // bullets with no JOB heading: the next job
      }
      if (typeof section === "number" && section >= 0 && section < n && bullets[section].length < MAX_BULLETS) bullets[section].push(item);
    }
    const list = Array.isArray(jobs) ? jobs : [];
    for (let i = 0; i < n; i++) if (!bullets[i].length) bullets[i] = sentences(list[i] && list[i].did);
    return { objective: objective.replace(/^["“]|["”]$/g, "").trim(), bullets };
  }

  const contactLine = (d) => [clean(d.email), clean(d.phone), clean(d.city)].filter(Boolean);
  const educationLine = (d) => [clean(d.school), clean(d.gradYear) ? `Class of ${clean(d.gradYear)}` : "", clean(d.gpa) ? `GPA ${clean(d.gpa)}` : ""].filter(Boolean).join(" · ");
  const jobHead = (j) => [clean(j.title), clean(j.place)].filter(Boolean).join(" — ");

  function asText(data, result) {
    const r = result || { objective: "", bullets: [] };
    const out = [];
    if (clean(data.name)) out.push(clean(data.name));
    const contact = contactLine(data);
    if (contact.length) out.push(contact.join(" · "));
    if (clean(r.objective)) out.push("", "OBJECTIVE", clean(r.objective));
    if (educationLine(data)) out.push("", "EDUCATION", educationLine(data));
    const jobs = usedJobs(data);
    if (jobs.length) {
      out.push("", "EXPERIENCE");
      jobs.forEach((j, i) => {
        if (i) out.push("");
        out.push([jobHead(j), clean(j.dates)].filter(Boolean).join(" · ") || "Experience");
        for (const b of (r.bullets && r.bullets[i]) || []) if (clean(b)) out.push(`- ${clean(b)}`);
      });
    }
    const skills = splitSkills(data.skills);
    if (skills.length) out.push("", "SKILLS", skills.join(", "));
    const awards = splitLines(data.awards);
    if (awards.length) out.push("", "AWARDS & ACTIVITIES", ...awards.map((a) => `- ${a}`));
    return out.join("\n").trim();
  }

  const esc = (s) => clean(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // The resume as an HTML fragment (for printing). Every piece of user text is escaped.
  function resumeHtml(data, result) {
    const r = result || { objective: "", bullets: [] };
    const parts = [`<article class="resume-sheet">`];
    parts.push(`<h1 class="resume-name">${esc(data.name) || "Your Name"}</h1>`);
    const contact = contactLine(data);
    if (contact.length) parts.push(`<p class="resume-contact">${contact.map(esc).join(" · ")}</p>`);
    const sec = (title, body) => parts.push(`<section><h2 class="resume-h">${title}</h2>${body}</section>`);
    if (clean(r.objective)) sec("Objective", `<p>${esc(r.objective)}</p>`);
    if (educationLine(data)) sec("Education", `<p>${esc(educationLine(data))}</p>`);
    const jobs = usedJobs(data);
    if (jobs.length) {
      sec("Experience", jobs.map((j, i) => {
        const items = ((r.bullets && r.bullets[i]) || []).filter((b) => clean(b)).map((b) => `<li>${esc(b)}</li>`).join("");
        return `<div class="resume-job"><div class="resume-jobhead"><b>${esc(jobHead(j)) || "Experience"}</b>`
          + (clean(j.dates) ? `<span class="resume-dates">${esc(j.dates)}</span>` : "") + `</div>`
          + (items ? `<ul>${items}</ul>` : "") + `</div>`;
      }).join(""));
    }
    const skills = splitSkills(data.skills);
    if (skills.length) sec("Skills", `<p>${skills.map(esc).join(", ")}</p>`);
    const awards = splitLines(data.awards);
    if (awards.length) sec("Awards &amp; Activities", `<ul>${awards.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`);
    parts.push(`</article>`);
    return parts.join("");
  }

  // Styles for the resume sheet, shared by the dialog and the print page.
  const SHEET_CSS = `
    .resume-sheet { background: #fff; color: #1b1b1b; font-family: Georgia, "Times New Roman", serif; line-height: 1.4; overflow-wrap: anywhere; }
    .resume-sheet .resume-name { margin: 0; font-size: 1.9em; font-weight: 700; letter-spacing: -0.01em; text-align: center; }
    .resume-sheet .resume-contact { margin: 4px 0 0; text-align: center; color: #444; font-size: 0.92em; }
    .resume-sheet section { margin-top: 14px; }
    .resume-sheet .resume-h { margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #1b1b1b; font-size: 0.85em;
      font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-family: inherit; }
    .resume-sheet p { margin: 0; }
    .resume-sheet ul { margin: 4px 0 0; padding-left: 20px; }
    .resume-sheet li { margin: 2px 0; }
    .resume-sheet .resume-job + .resume-job { margin-top: 10px; }
    .resume-sheet .resume-jobhead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 12px; }
    .resume-sheet .resume-dates { color: #444; font-style: italic; }`;

  function printPage(data, result) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.name) || "Resume"} — Resume</title><style>${SHEET_CSS}
      body { margin: 0; background: #fff; } .resume-sheet { padding: 0.2in 0.1in; font-size: 11pt; }
      @page { size: letter; margin: 0.6in; }</style></head><body>${resumeHtml(data, result)}</body></html>`;
  }

  return { MAX_JOBS, MAX_DID, EXAMPLE, blankData, blankJob, usedJobs, buildPrompt, sentences, parseResume, asText, resumeHtml, printPage, esc, SHEET_CSS };
})();
if (typeof module !== "undefined") module.exports = ResumeBuilder;

if (typeof document !== "undefined") (() => {
  const { MAX_JOBS, MAX_DID, EXAMPLE, blankData, blankJob, usedJobs, buildPrompt, parseResume, asText, printPage, SHEET_CSS } = ResumeBuilder;
  const SAVE_KEY = "local-ai-resume";
  const copy = (o) => JSON.parse(JSON.stringify(o));

  const style = document.createElement("style");
  style.textContent = `${SHEET_CSS}
    #resume-dialog { width: min(760px, calc(100vw - 32px)); }
    .resume-private { display: inline-block; margin: 6px 0 0; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft);
      color: var(--accent); font-size: 0.8em; font-weight: 600; }
    .resume-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 14px; }
    #resume-dialog label.resume-field { display: block; font-weight: 600; font-size: 0.92em; min-width: 0; }
    #resume-dialog label.resume-field .resume-opt { font-weight: 400; color: var(--muted); }
    #resume-dialog .resume-field input, #resume-dialog .resume-field textarea { display: block; width: 100%; margin-top: 5px; font: inherit;
      font-weight: 400; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card);
      color: var(--text); outline: none; }
    #resume-dialog .resume-field textarea { min-height: 76px; resize: vertical; line-height: 1.45; }
    #resume-dialog .resume-field input:focus, #resume-dialog .resume-field textarea:focus { border-color: var(--accent); }
    .resume-sec { display: block; margin: 20px 0 8px; font-size: 0.78em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); }
    .resume-job-card { border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px 14px; margin: 0 0 10px; background: var(--card); min-width: 0; }
    .resume-job-card legend { font-weight: 650; padding: 0 6px; }
    .resume-job-card .resume-wide { grid-column: 1 / -1; }
    .resume-job-foot { display: flex; justify-content: flex-end; margin-top: 8px; }
    .resume-job-foot button { font-size: 0.85em; padding: 4px 10px; }
    .resume-topline { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: space-between; }
    .resume-example { background: none; border: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: 0.9em; }
    .resume-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .resume-writing { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .resume-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: resume-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes resume-spin { to { transform: rotate(360deg); } }
    .resume-live { max-height: 240px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    #resume-dialog .resume-sheet { margin-top: 12px; padding: 26px 30px; border: 1px solid var(--border); border-radius: 6px;
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.12)); }
    #resume-dialog .resume-sheet [contenteditable] { border-radius: 4px; outline: none; cursor: text; }
    #resume-dialog .resume-sheet [contenteditable]:hover { background: #fbf3df; }
    #resume-dialog .resume-sheet [contenteditable]:focus { background: #fff7e0; box-shadow: 0 0 0 2px #e8b35b; }
    .resume-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; align-items: center; }
    .resume-buttons .resume-grow { flex: 1; }
    #resume-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 520px) {
      #resume-dialog { padding: 18px 14px 18px; }
      #resume-dialog .resume-sheet { padding: 18px 14px; font-size: 0.92em; }
      .resume-sheet .resume-name { font-size: 1.6em; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "resume-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📄 Resume builder");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "resume-dialog", "aria-labelledby": "resume-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is writing
  let draft = blankData();

  const save = (saved) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch { /* blocked; fine for this visit */ } };
  function loadSaved() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d.data !== "object" || !d.data) return null;
      const data = { ...blankData(), ...d.data };
      data.jobs = Array.isArray(data.jobs) && data.jobs.length ? data.jobs.map((j) => ({ ...blankJob(), ...j })) : [blankJob()];
      const r = d.result;
      const result = r && Array.isArray(r.bullets) ? { objective: String(r.objective || ""), bullets: r.bullets.map((b) => (Array.isArray(b) ? b.map(String) : [])) } : null;
      return { data, result };
    } catch { return null; }
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "resume-title" }, "📄 Resume builder"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function field(label, value, onInput, { optional = false, type = "text", area = false, wide = false, ...attrs } = {}) {
    const input = el(area ? "textarea" : "input", area ? attrs : { type, ...attrs });
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    return el("label", { class: `resume-field${wide ? " resume-wide" : ""}` }, label, optional ? el("span", { class: "resume-opt" }, " (optional)") : null, input);
  }

  function drawForm(message) {
    const d = draft;
    const set = (k) => (v) => { d[k] = v; };
    const jobsBox = el("div", {});
    const drawJobs = () => {
      jobsBox.replaceChildren(...d.jobs.map((j, i) => el("fieldset", { class: "resume-job-card" },
        el("legend", {}, `Experience ${i + 1}`),
        el("div", { class: "resume-grid" },
          field("Title or role", j.title, (v) => { j.title = v; }, { placeholder: "Cashier, Volunteer, Club president", maxlength: "80" }),
          field("Place", j.place, (v) => { j.place = v; }, { placeholder: "Business, school or group", maxlength: "80" }),
          field("Dates", j.dates, (v) => { j.dates = v; }, { placeholder: "Jun 2025 – Present", maxlength: "40" }),
          field("What did you do?", j.did, (v) => { j.did = v; }, { area: true, wide: true, maxlength: String(MAX_DID),
            placeholder: "Write it like you'd tell a friend: what you did, who you helped, anything you learned." })),
        d.jobs.length > 1 ? el("div", { class: "resume-job-foot" },
          el("button", { type: "button", onclick: () => { d.jobs.splice(i, 1); drawJobs(); } }, "Remove")) : null)));
    };
    drawJobs();
    const add = el("button", { type: "button", onclick: () => {
      if (d.jobs.length >= MAX_JOBS) return toast(`Up to ${MAX_JOBS} experiences fit on a one-page resume.`);
      d.jobs.push(blankJob()); drawJobs(); jobsBox.lastElementChild?.querySelector("input")?.focus();
    } }, "+ Add experience");
    setDialog(head(),
      el("div", { class: "resume-topline" },
        el("span", { class: "resume-private" }, "🔒 Stays on this computer"),
        el("button", { type: "button", class: "resume-example", onclick: () => { draft = copy(EXAMPLE); drawForm(); } }, "Try an example")),
      el("p", { class: "note" }, "Write what you did in plain words. The AI turns it into resume bullet points using only your facts. Good for a part-time job, an internship or a college application."),
      el("span", { class: "resume-sec" }, "About you"),
      el("div", { class: "resume-grid" },
        field("Name", d.name, set("name"), { autocomplete: "name", maxlength: "80" }),
        field("Email", d.email, set("email"), { type: "email", autocomplete: "email", maxlength: "100" }),
        field("Phone", d.phone, set("phone"), { optional: true, type: "tel", autocomplete: "tel", maxlength: "30" }),
        field("City", d.city, set("city"), { optional: true, maxlength: "60", placeholder: "Springfield, IL" })),
      el("span", { class: "resume-sec" }, "School"),
      el("div", { class: "resume-grid" },
        field("School", d.school, set("school"), { maxlength: "100", placeholder: "Lincoln High School" }),
        field("Graduation year", d.gradYear, set("gradYear"), { inputmode: "numeric", maxlength: "4", placeholder: "2027" }),
        field("GPA", d.gpa, set("gpa"), { optional: true, maxlength: "10", placeholder: "3.7" })),
      el("span", { class: "resume-sec" }, "Experience: jobs, volunteering, clubs"),
      jobsBox,
      add,
      el("span", { class: "resume-sec" }, "More"),
      el("div", { class: "resume-grid" },
        field("Skills", d.skills, set("skills"), { wide: true, maxlength: "300", placeholder: "Customer service, Spanish, Google Sheets (separate with commas)" }),
        field("Awards & activities", d.awards, set("awards"), { area: true, wide: true, maxlength: "800", placeholder: "One per line, like Honor Roll (2024)" })),
      message ? el("p", { class: "resume-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: () => write() }, "Write my resume")));
    if (message) dialog.querySelector(".resume-msg")?.scrollIntoView({ block: "nearest" });
  }

  function drawWriting(live) {
    setDialog(head(),
      el("div", { class: "resume-writing" }, el("span", { class: "resume-spin", "aria-hidden": "true" }), "Writing…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function drawResume(data, result) {
    const persist = () => save({ data, result, at: Date.now() });
    // An editable piece of text: typing changes the saved resume.
    const editable = (tag, text, onSave, attrs = {}) => {
      const node = el(tag, { ...attrs, contenteditable: "plaintext-only", spellcheck: "true" }, text);
      if (node.contentEditable !== "plaintext-only") node.contentEditable = "true"; // older browsers
      node.addEventListener("input", () => { onSave(node.textContent.replace(/\s+/g, " ").trim()); persist(); });
      node.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); node.blur(); } });
      return node;
    };
    const jobs = usedJobs(data);
    const contact = [data.email, data.phone, data.city].map((s) => String(s || "").trim()).filter(Boolean);
    const edu = [data.school, data.gradYear ? `Class of ${data.gradYear}` : "", data.gpa ? `GPA ${data.gpa}` : ""].map((s) => String(s).trim()).filter(Boolean).join(" · ");
    const skills = String(data.skills || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    const awards = String(data.awards || "").split(/\r?\n/).map((s) => s.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean);
    const sec = (title, ...body) => el("section", {}, el("h2", { class: "resume-h" }, title), ...body);
    const sheet = el("article", { class: "resume-sheet", "aria-label": "Your resume" },
      el("h1", { class: "resume-name" }, String(data.name || "").trim() || "Your Name"),
      contact.length ? el("p", { class: "resume-contact" }, contact.join(" · ")) : null,
      sec("Objective", editable("p", result.objective || "", (v) => { result.objective = v; }, { "aria-label": "Objective" })),
      edu ? sec("Education", el("p", {}, edu)) : null,
      jobs.length ? sec("Experience", ...jobs.map((j, i) => {
        const what = [j.title, j.place].map((s) => String(s || "").trim()).filter(Boolean).join(" — ") || "Experience";
        const list = result.bullets[i] || (result.bullets[i] = []);
        return el("div", { class: "resume-job" },
          el("div", { class: "resume-jobhead" }, el("b", {}, what), String(j.dates || "").trim() ? el("span", { class: "resume-dates" }, j.dates.trim()) : null),
          el("ul", {}, ...list.map((b, k) => el("li", {}, editable("span", b, (v) => { list[k] = v; }, { "aria-label": `Bullet ${k + 1} for ${what}` })))));
      })) : null,
      skills.length ? sec("Skills", el("p", {}, skills.join(", "))) : null,
      awards.length ? sec("Awards & Activities", el("ul", {}, ...awards.map((a) => el("li", {}, a)))) : null);
    setDialog(head(),
      el("div", { class: "resume-topline" },
        el("span", { class: "resume-private" }, "🔒 Stays on this computer"),
        el("span", { class: "note" }, "Click any bullet or the objective to change it.")),
      sheet,
      el("p", { class: "note" }, "Check every line: the AI can get things wrong. Make sure each bullet is true before you send it."),
      el("div", { class: "resume-buttons" },
        el("button", { class: "primary", onclick: () => print(data, result) }, "🖨️ Print"),
        el("button", { onclick: (e) => copyText(e.currentTarget, asText(data, result)) }, "📋 Copy as text"),
        el("span", { class: "resume-grow" }),
        el("button", { onclick: () => { draft = copy(data); drawForm(); } }, "Edit details"),
        el("button", { onclick: () => {
          if (!confirm("Start a new resume? This clears the form and the resume.")) return;
          try { localStorage.removeItem(SAVE_KEY); } catch { /* fine */ }
          draft = blankData(); drawForm();
        } }, "Start over")));
  }

  // Print through a hidden frame holding only the resume, so no pop-up blocker gets in the way.
  function print(data, result) {
    const frame = el("iframe", { title: "Resume for printing", "aria-hidden": "true", style: "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden" });
    frame.srcdoc = printPage(data, result);
    frame.addEventListener("load", () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { toast("Couldn't open printing. Use Copy as text instead."); }
      setTimeout(() => frame.remove(), 60000);
    });
    document.body.append(frame);
  }

  async function write() {
    const data = copy(draft);
    data.jobs = data.jobs.filter((j) => j.title.trim() || j.place.trim() || j.did.trim());
    if (!data.jobs.length) data.jobs = [blankJob()];
    draft = copy(data);
    if (!data.name.trim()) return drawForm("Write your name first.");
    if (!usedJobs(data).some((j) => j.did.trim())) return drawForm("Add at least one experience and write what you did there. A job, volunteering, a club or a school project all count.");
    const model = currentModel();
    if (findModel(model)?.experimental) return drawForm("TinyGPT is a tiny practice model and can't write a resume. Pick a real chat model in Models first, then try again.");
    const jobs = usedJobs(data);
    busy = new AbortController();
    const live = el("pre", { class: "resume-live" }, "Waiting for the AI...");
    drawWriting(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(data), think: false, auto_code: false }),
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
      const result = parseResume(reply, jobs.length, jobs);
      save({ data, result, at: Date.now() });
      if (dialog.open) drawResume(data, result);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawForm("Stopped. Press Write my resume to try again.");
      else drawForm(`Couldn't write the resume: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved && saved.result) drawResume(saved.data, saved.result);
    else { if (saved) draft = saved.data; drawForm(); }
  }

  dialog.addEventListener("close", () => {
    busy?.abort();
    // Keep an unfinished form for next time too.
    if (!loadSaved()?.result) save({ data: draft, result: null, at: Date.now() });
  });
})();
