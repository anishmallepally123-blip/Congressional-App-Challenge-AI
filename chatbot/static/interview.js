// "💼 Interview practice": a mock interview coach. The AI asks one question at a time, the student
// types an answer and gets short feedback (a 1-5 score, what was good, what to improve and a
// stronger first sentence), then a summary at the end. The session in progress is kept in this
// browser so reopening continues where the student left off.

// Pure helpers (no page needed), so test_interview.py can run them with Node.
const InterviewPractice = (() => {
  const TYPES = {
    job: { label: "Part-time job", what: "a part-time job interview", rolePrompt: "the job" },
    college: { label: "College admission", what: "a college admission interview", rolePrompt: "the school" },
    scholarship: { label: "Scholarship", what: "a scholarship interview", rolePrompt: "the scholarship" },
    internship: { label: "Internship", what: "an internship interview", rolePrompt: "the internship" },
    club: { label: "Club or team", what: "a tryout or interview to join a school club or team", rolePrompt: "the club or team" },
  };
  const typeOf = (type) => (TYPES[type] ? type : "job");

  const BANK = {
    job: [
      "Tell me a little about yourself.",
      "Why do you want to work here?",
      "Tell me about a time you helped someone who was upset or confused.",
      "How would you balance this job with school?",
      "Describe a time you worked as part of a team. What did you do?",
    ],
    college: [
      "Tell me about yourself and what you enjoy learning.",
      "Why are you interested in our school?",
      "Tell me about a challenge you faced and how you handled it.",
      "What do you do outside of class that matters to you?",
      "What would you add to our campus community?",
    ],
    scholarship: [
      "Tell me about yourself and your goals.",
      "Why do you deserve this scholarship?",
      "Describe a time you showed leadership.",
      "Tell me about a time you failed and what you learned from it.",
      "How will this scholarship help you reach your goals?",
    ],
    internship: [
      "Tell me about yourself and why this field interests you.",
      "What do you hope to learn during this internship?",
      "Tell me about a project you are proud of.",
      "Describe a time you had to learn something new quickly.",
      "How do you stay organized when you have a lot to do?",
    ],
    club: [
      "Why do you want to join this club or team?",
      "What skills or strengths would you bring?",
      "Tell me about a time you worked with others toward a goal.",
      "How do you handle a disagreement with a teammate?",
      "How will you make time for practices and meetings?",
    ],
  };
  const fallbackQuestions = (type) => BANK[typeOf(type)].slice();

  const countWords = (text) => (String(text || "").match(/\S+/g) || []).length;
  const clean = (s) => String(s || "").replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();

  const BEHAVIORAL = /\b(?:tell me about a time|describe a (?:time|situation|moment)|give (?:me )?an example|a time (?:when|you)|when you (?:had|were|faced|made)|challenge|conflict|disagree|mistake|fail(?:ed|ure)?|difficult|showed leadership|proud of)\b/i;
  const isBehavioral = (question) => BEHAVIORAL.test(String(question || ""));
  const STAR_TIP = "Use the STAR method: Situation (where and when), Task (what you needed to do), Action (what you did) and Result (what happened and what you learned). Pick one real example and keep it short.";
  const GENERAL_TIP = "Answer in 3 or 4 sentences: say your main point first, give one real example from your life, then connect it back to the role or school.";
  const tipFor = (question) => (isBehavioral(question) ? STAR_TIP : GENERAL_TIP);

  const COACH = "You are a friendly interview coach helping a high school student practice. Be encouraging and specific. "
    + "Never invent experiences, jobs, grades or facts about the student; only use what they wrote.";

  function buildQuestionsPrompt(type, role, count) {
    const t = TYPES[typeOf(type)];
    const n = count === 5 ? 5 : 3;
    const target = String(role || "").trim().slice(0, 120);
    const system = `${COACH} Write realistic interview questions a high school student might hear in ${t.what}. `
      + "Mix one easy opening question, questions about their reasons and goals, and at least one \"Tell me about a time...\" question. "
      + "Each question is one short sentence. Answer in exactly this format and nothing else:\n"
      + Array.from({ length: n }, (_, i) => `Q${i + 1}: question`).join("\n");
    const user = `Write ${n} interview questions for ${t.what}` + (target ? ` for ${target}.` : ".");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // Lines like "Q1: ...", "1. ...", "Question 2 - ...", "- ..." with markdown stripped.
  function parseQuestions(text, count) {
    const out = [];
    const seen = new Set();
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = clean(raw);
      const m = line.match(/^(?:[-*•]\s*)?(?:(?:q|question)\s*\d{1,2}|\d{1,2})\s*[:.)\-–—]\s*(.+)$/i)
        || line.match(/^[-*•]\s+(.+\?)$/);
      if (!m) continue;
      const q = m[1].replace(/^["“*]+|["”*]+$/g, "").trim();
      const key = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (q.length < 8 || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (count && out.length >= count) break;
    }
    return out;
  }

  // The model's questions, topped up from the question bank when it gave fewer than asked.
  function fillQuestions(questions, type, count) {
    const out = (questions || []).slice(0, count);
    const have = new Set(out.map((q) => q.toLowerCase()));
    for (const q of fallbackQuestions(type)) {
      if (out.length >= count) break;
      if (!have.has(q.toLowerCase())) out.push(q);
    }
    return out;
  }

  function buildFeedbackPrompt(type, role, question, answer) {
    const t = TYPES[typeOf(type)];
    const target = String(role || "").trim().slice(0, 120);
    const system = `${COACH} Give short feedback on one answer from ${t.what}`
      + (target ? ` for ${target}` : "") + ". Score it from 1 (needs a lot of work) to 5 (excellent). "
      + "Answer in exactly this format and nothing else:\n"
      + "SCORE: a number from 1 to 5\n"
      + "GOOD: one sentence about what works in the answer\n"
      + "IMPROVE: one sentence with the single most useful change\n"
      + "BETTER START: a stronger first sentence the student could use, based only on what they wrote";
    const user = `QUESTION: ${question}\n\nSTUDENT'S ANSWER:\n${String(answer || "").slice(0, 3000)}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const FIELDS = [
    ["score", /^score\b\s*[:\-–]?\s*(.*)$/i],
    ["good", /^(?:good|strengths?|what works|what worked)\b\s*[:\-–]?\s*(.*)$/i],
    ["improve", /^(?:improve|to improve|improvement|next time|work on)\b\s*[:\-–]?\s*(.*)$/i],
    ["betterStart", /^(?:better\s*start|stronger\s*start|better\s*opening|stronger\s*(?:first\s*sentence|opening)|try starting(?: with)?)\b\s*[:\-–]?\s*(.*)$/i],
  ];

  function parseFeedback(text) {
    const out = { score: null, good: "", improve: "", betterStart: "" };
    let field = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = clean(raw).replace(/^[-*•]\s+/, "");
      if (!line) continue;
      const hit = FIELDS.find(([, re]) => re.test(line));
      if (hit) { field = hit[0]; line = line.match(hit[1])[1].trim(); }
      if (field === "score") {
        const m = line.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*5|out of 5)?/i);
        if (m && out.score == null) out.score = Math.min(5, Math.max(1, Math.round(Number(m[1]))));
        field = null;
        continue;
      }
      line = line.replace(/^["“*]+|["”*]+$/g, "").trim();
      if (!line || !field) continue;
      out[field] = out[field] ? `${out[field]} ${line}` : line;
    }
    return out;
  }

  const parsedOk = (f) => !!(f && (f.score != null || f.good || f.improve));

  // Average of the scored answers, to one decimal place; null when nothing has a score.
  function averageScore(items) {
    const scores = (items || []).map((i) => i && i.feedback && i.feedback.score).filter((s) => typeof s === "number" && s > 0);
    if (!scores.length) return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  }

  function buildFocusPrompt(items) {
    const lines = (items || []).map((i) => i.feedback && i.feedback.improve).filter(Boolean);
    const system = `${COACH} Read the improvement notes from a student's practice interview and name the single most useful thing to practice next. `
      + "Answer with one short, encouraging sentence and nothing else.";
    const user = "IMPROVEMENT NOTES:\n" + lines.map((l) => `- ${l}`).join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // The IMPROVE line of the lowest-scored answer.
  function fallbackFocus(items) {
    const withNote = (items || []).filter((i) => i.feedback && i.feedback.improve);
    if (!withNote.length) return "";
    const score = (i) => (typeof i.feedback.score === "number" ? i.feedback.score : 6);
    return withNote.reduce((low, i) => (score(i) < score(low) ? i : low)).feedback.improve;
  }

  const cleanFocus = (text) => clean(String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "")
    .replace(/^(?:focus|practice|answer)\s*:\s*/i, "").replace(/^["“]|["”]$/g, "").trim();

  function asText(session) {
    const s = session || {};
    const t = TYPES[typeOf(s.type)];
    const items = s.items || [];
    const avg = averageScore(items);
    const lines = [`Interview practice: ${t.label}` + (s.role ? ` (${s.role})` : "")];
    if (avg != null) lines.push(`Average score: ${avg} / 5`);
    items.forEach((item, i) => {
      const f = item.feedback || {};
      lines.push("", `Q${i + 1}: ${item.question}`, `My answer: ${item.answer || "(no answer)"}`);
      if (f.score != null) lines.push(`Score: ${f.score} / 5`);
      if (f.good) lines.push(`Good: ${f.good}`);
      if (f.improve) lines.push(`Improve: ${f.improve}`);
      if (f.betterStart) lines.push(`Better start: ${f.betterStart}`);
    });
    if (s.focus) lines.push("", `Most useful thing to practice: ${s.focus}`);
    return lines.join("\n").trim();
  }

  return { TYPES, STAR_TIP, GENERAL_TIP, countWords, fallbackQuestions, isBehavioral, tipFor, buildQuestionsPrompt, parseQuestions,
    fillQuestions, buildFeedbackPrompt, parseFeedback, parsedOk, averageScore, buildFocusPrompt, fallbackFocus, cleanFocus, asText };
})();
if (typeof module !== "undefined") module.exports = InterviewPractice;

if (typeof document !== "undefined") (() => {
  const { TYPES, countWords, tipFor, buildQuestionsPrompt, parseQuestions, fillQuestions, buildFeedbackPrompt, parseFeedback,
    parsedOk, averageScore, buildFocusPrompt, fallbackFocus, cleanFocus, asText } = InterviewPractice;
  const SAVE_KEY = "local-ai-interview";

  const style = document.createElement("style");
  style.textContent = `
    #interview-dialog { width: min(680px, calc(100vw - 32px)); overflow-x: hidden; }
    #interview-dialog * { box-sizing: border-box; }
    .interview-sec { display: block; margin: 16px 0 8px; font-weight: 600; }
    .interview-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    #interview-dialog .interview-chips .chip { font-size: 0.9em; padding: 6px 14px; }
    #interview-dialog label.interview-field { display: block; margin: 16px 0 0; font-weight: 600; }
    #interview-dialog label.interview-field small { font-weight: 400; color: var(--muted); }
    #interview-dialog input[type=text], #interview-dialog textarea { display: block; width: 100%; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #interview-dialog textarea { min-height: 150px; max-height: 45vh; resize: vertical; line-height: 1.5; }
    #interview-dialog input[type=text]:focus, #interview-dialog textarea:focus { border-color: var(--accent); }
    .interview-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 16px; }
    .interview-row > span { font-weight: 600; }
    .interview-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .interview-thinking { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .interview-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: interview-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes interview-spin { to { transform: rotate(360deg); } }
    .interview-live { max-height: 180px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .interview-count-row { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .interview-bar { height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 6px 0 0; }
    .interview-bar > span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
    .interview-question { margin: 16px 0 0; padding: 14px 16px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); font-size: 1.08em; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
    .interview-tip-btn { margin-top: 10px; }
    .interview-tip { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.9em; line-height: 1.5; }
    .interview-words { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .interview-words.interview-ok { color: var(--accent); font-weight: 600; }
    .interview-answer { margin: 14px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; white-space: pre-wrap;
      overflow-wrap: anywhere; line-height: 1.5; max-height: 30vh; overflow-y: auto; }
    .interview-answer small, .interview-label { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 3px; white-space: normal; }
    .interview-feedback { margin: 14px 0 0; padding: 14px 16px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--card); }
    .interview-feedback p { margin: 10px 0 0; line-height: 1.5; overflow-wrap: anywhere; }
    .interview-feedback p:first-of-type { margin-top: 8px; }
    .interview-stars { font-size: 1.35em; letter-spacing: 2px; color: var(--accent); line-height: 1; }
    .interview-stars .interview-off { color: var(--border-strong); }
    .interview-stars small { font-size: 0.6em; letter-spacing: 0; color: var(--muted); margin-left: 8px; vertical-align: middle; }
    .interview-better { font-style: italic; }
    .interview-raw { white-space: pre-wrap; overflow-wrap: anywhere; }
    .interview-score { margin: 16px 0 0; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .interview-big { font-size: 2.2em; font-weight: 700; color: var(--accent); line-height: 1; }
    .interview-focus { margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft); border-left: 4px solid var(--accent); line-height: 1.5; }
    .interview-list { margin: 14px 0 0; display: grid; gap: 8px; }
    .interview-list details { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--card); }
    .interview-list summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; justify-content: space-between; font-weight: 600; line-height: 1.4; }
    .interview-list summary span:first-child { overflow-wrap: anywhere; min-width: 0; }
    .interview-list summary .interview-stars { font-size: 0.95em; flex-shrink: 0; letter-spacing: 1px; }
    .interview-list details .interview-answer { max-height: none; }
    .interview-list details p { margin: 8px 0 0; line-height: 1.5; overflow-wrap: anywhere; }
    .interview-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .interview-buttons .interview-grow { flex: 1; }
    #interview-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 500px) {
      #interview-dialog { padding: 18px 16px 20px; }
      .interview-buttons > button { flex: 1 1 auto; }
      .interview-buttons .interview-grow { display: none; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "interview-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "💼 Interview practice");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "interview-dialog", "aria-labelledby": "interview-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  let settings = { type: "job", role: "", count: 3 };
  let session = null; // { type, role, count, questions, index, items: [{question, answer, feedback, raw}], done, focus }

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ settings, session })); } catch { /* blocked; fine for this visit */ } };
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && d.settings && TYPES[d.settings.type]) settings = { type: d.settings.type, role: String(d.settings.role || ""), count: d.settings.count === 5 ? 5 : 3 };
      if (d && d.session && Array.isArray(d.session.questions) && d.session.questions.length && Array.isArray(d.session.items)) session = d.session;
    } catch { /* nothing saved */ }
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "interview-title" }, "💼 Interview practice"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  const stars = (score) => (score == null ? null : el("span", { class: "interview-stars", role: "img", "aria-label": `${score} out of 5` },
    "★".repeat(score), el("span", { class: "interview-off" }, "★".repeat(5 - score)), el("small", {}, `${score} / 5`)));

  function drawSetup(message) {
    const chips = el("div", { class: "interview-chips", role: "group", "aria-label": "Interview type" });
    for (const [value, t] of Object.entries(TYPES)) {
      chips.append(el("button", { type: "button", class: "chip", "aria-pressed": String(value === settings.type), onclick: (e) => {
        settings.type = value;
        chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      } }, t.label));
    }
    const role = el("input", { type: "text", maxlength: "120", placeholder: "e.g. cashier at a grocery store", "aria-label": "Role or school" });
    role.value = settings.role;
    role.addEventListener("input", () => { settings.role = role.value; });
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Number of questions" });
    for (const n of [3, 5]) {
      seg.append(el("button", { type: "button", class: n === settings.count ? "on" : "", "aria-pressed": String(n === settings.count), onclick: (e) => {
        settings.count = n;
        seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
      } }, String(n)));
    }
    setDialog(head(),
      el("p", { class: "note" }, "Practice a real interview. The AI on this computer asks one question at a time and gives quick feedback on each answer."),
      el("span", { class: "interview-sec" }, "What are you practicing for?"),
      chips,
      el("label", { class: "interview-field" }, "Role or school ", el("small", {}, "(optional)"), role),
      el("div", { class: "interview-row" }, el("span", {}, "Questions"), seg),
      message ? el("p", { class: "interview-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: () => start() }, "Start")));
  }

  function drawThinking(live, what) {
    setDialog(head(),
      el("div", { class: "interview-thinking" }, el("span", { class: "interview-spin", "aria-hidden": "true" }), "Thinking…"),
      el("p", { class: "note" }, `${what} A small model takes a few seconds; a big one can take a minute.`),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  // One request to the AI on this computer; resolves to the full reply text.
  async function askAI(messages, what) {
    busy = new AbortController();
    const live = el("pre", { class: "interview-live" }, "Waiting for the AI...");
    drawThinking(live, what);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: currentModel(), messages, think: false, auto_code: false }),
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
      return reply.trim();
    } finally {
      busy = null;
    }
  }

  const tinyMessage = () => (findModel(currentModel())?.experimental
    ? "TinyGPT is a tiny practice model and can't run an interview. Pick a real chat model in Models first, then try again." : null);

  async function start() {
    const tiny = tinyMessage();
    if (tiny) return drawSetup(tiny);
    const { type, count } = settings;
    const role = settings.role.trim();
    try {
      const reply = await askAI(buildQuestionsPrompt(type, role, count), "Writing your interview questions.");
      const questions = fillQuestions(parseQuestions(reply, count), type, count);
      session = { type, role, count, questions, index: 0, items: questions.map((question) => ({ question, answer: "", feedback: null, raw: "" })), done: false, focus: "" };
      save();
      if (dialog.open) drawQuestion();
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Start to try again.");
      else drawSetup(`Couldn't start the interview: ${err.message}`);
    }
  }

  function feedbackCard(item) {
    const f = item.feedback || {};
    if (!parsedOk(f)) return el("div", { class: "interview-feedback" }, el("p", { class: "interview-raw" }, item.raw || "(no feedback)"));
    return el("div", { class: "interview-feedback" },
      stars(f.score),
      f.good ? el("p", {}, el("span", { class: "interview-label" }, "What works"), f.good) : null,
      f.improve ? el("p", {}, el("span", { class: "interview-label" }, "Try next time"), f.improve) : null,
      f.betterStart ? el("p", { class: "interview-better" }, el("span", { class: "interview-label" }, "A stronger start"), f.betterStart) : null);
  }

  function drawQuestion(message) {
    const i = session.index;
    const item = session.items[i];
    const total = session.items.length;
    const last = i === total - 1;
    const tip = el("p", { class: "interview-tip", hidden: true }, tipFor(item.question));
    const tipBtn = el("button", { type: "button", class: "chip interview-tip-btn", "aria-expanded": "false", onclick: () => {
      tip.hidden = !tip.hidden;
      tipBtn.setAttribute("aria-expanded", String(!tip.hidden));
      tipBtn.setAttribute("aria-pressed", String(!tip.hidden));
    } }, "💡 Tip");
    const top = [head(),
      el("div", { class: "interview-count-row" }, el("span", {}, `Question ${i + 1} of ${total}`), el("span", {}, TYPES[session.type]?.label || "")),
      el("div", { class: "interview-bar", "aria-hidden": "true" }, el("span", { style: `width:${Math.round(((i + (item.feedback || item.raw ? 1 : 0)) / total) * 100)}%` })),
      el("p", { class: "interview-question" }, item.question)];

    if (item.feedback || item.raw) {
      setDialog(...top,
        el("div", { class: "interview-answer" }, el("small", {}, "Your answer"), item.answer),
        feedbackCard(item),
        el("div", { class: "interview-buttons" },
          el("button", { onclick: () => { item.feedback = null; item.raw = ""; save(); drawQuestion(); } }, "Try again"),
          el("span", { class: "interview-grow" }),
          el("button", { class: "primary", onclick: () => {
            if (last) { session.done = true; save(); finish(); } else { session.index = i + 1; save(); drawQuestion(); }
          } }, last ? "See results" : "Next question")));
      return;
    }

    const area = el("textarea", { placeholder: "Type your answer the way you would say it...", "aria-label": "Your answer" });
    area.value = item.answer || "";
    const words = el("span", { class: "interview-words", "aria-live": "polite" });
    const update = () => {
      item.answer = area.value;
      const n = countWords(area.value);
      words.textContent = `${n} ${n === 1 ? "word" : "words"} · aim for 50–150`;
      words.classList.toggle("interview-ok", n >= 50 && n <= 150);
    };
    area.addEventListener("input", () => { update(); save(); });
    update();
    setDialog(...top, tipBtn, tip,
      el("label", { class: "interview-field" }, "Your answer", area, words),
      message ? el("p", { class: "interview-msg", role: "alert" }, message) : null,
      el("div", { class: "interview-buttons" },
        el("button", { onclick: () => { session = null; save(); drawSetup(); } }, "Change type"),
        el("span", { class: "interview-grow" }),
        el("button", { class: "primary", onclick: () => getFeedback() }, "Get feedback")));
    area.focus();
  }

  async function getFeedback() {
    const item = session.items[session.index];
    if (!item.answer.trim()) return drawQuestion("Type an answer first. Even a short one is fine for practice.");
    const tiny = tinyMessage();
    if (tiny) return drawQuestion(tiny);
    try {
      const reply = await askAI(buildFeedbackPrompt(session.type, session.role, item.question, item.answer.trim()), "Reading your answer.");
      const f = parseFeedback(reply);
      item.feedback = parsedOk(f) ? f : null;
      item.raw = reply;
      save();
      if (dialog.open) drawQuestion();
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawQuestion("Stopped. Press Get feedback to try again.");
      else drawQuestion(`Couldn't get feedback: ${err.message}`);
    }
  }

  async function finish() {
    if (!session.focus) {
      const fallback = fallbackFocus(session.items);
      if (session.items.some((i) => i.feedback?.improve) && !tinyMessage()) {
        try {
          session.focus = cleanFocus(await askAI(buildFocusPrompt(session.items), "Looking at all your answers.")) || fallback;
        } catch (err) {
          if (!dialog.open) return;
          session.focus = fallback;
        }
      } else session.focus = fallback;
      save();
    }
    if (dialog.open) drawSummary();
  }

  function drawSummary() {
    const avg = averageScore(session.items);
    const t = TYPES[session.type] || TYPES.job;
    const copy = el("button", { onclick: (e) => copyText(e.currentTarget, asText(session)) }, "📋 Copy results");
    setDialog(head(),
      el("p", { class: "note" }, `${t.label}${session.role ? ` · ${session.role}` : ""} · ${session.items.length} questions`),
      el("div", { class: "interview-score" },
        el("span", { class: "interview-big" }, avg == null ? "—" : `${avg}`),
        el("span", {}, avg == null ? "No scores yet" : "average score out of 5")),
      session.focus ? el("div", { class: "interview-focus" }, el("span", { class: "interview-label" }, "Most useful thing to practice"), session.focus) : null,
      el("div", { class: "interview-list" }, ...session.items.map((item, i) => el("details", {},
        el("summary", {}, el("span", {}, `${i + 1}. ${item.question}`), item.feedback?.score != null ? stars(item.feedback.score) : null),
        el("div", { class: "interview-answer" }, el("small", {}, "Your answer"), item.answer || "(no answer)"),
        item.feedback?.good ? el("p", {}, el("span", { class: "interview-label" }, "What works"), item.feedback.good) : null,
        item.feedback?.improve ? el("p", {}, el("span", { class: "interview-label" }, "Try next time"), item.feedback.improve) : null,
        item.feedback?.betterStart ? el("p", { class: "interview-better" }, el("span", { class: "interview-label" }, "A stronger start"), item.feedback.betterStart) : null,
        !item.feedback && item.raw ? el("p", { class: "interview-raw" }, item.raw) : null))),
      el("div", { class: "interview-buttons" },
        copy,
        el("span", { class: "interview-grow" }),
        el("button", { onclick: () => { session = null; save(); drawSetup(); } }, "Change type"),
        el("button", { class: "primary", onclick: () => {
          settings = { type: session.type, role: session.role, count: session.count };
          session = null; save(); start();
        } }, "Practice again")));
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    load();
    dialog.showModal();
    if (!session) drawSetup();
    else if (session.done) finish();
    else drawQuestion();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
