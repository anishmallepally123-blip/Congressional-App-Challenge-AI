// "✉️ Write an email": the student says who the email is for and what they need, and the AI drafts
// a clear, polite email (to a teacher, coach, counselor or boss) that they can edit, check and send.
// The last draft is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_email.py can run them with Node.
const EmailWriter = (() => {
  const MAX_NEED = 2000;
  const MAILTO_MAX = 1800;
  const TONES = {
    polite: "polite and respectful, warm but not too casual",
    formal: "formal and professional, with no slang and no contractions",
    friendly: "friendly and relaxed, but still respectful",
  };
  const EXAMPLES = [
    ["Ask for an extension", "Can I have two more days for the essay due Friday? I've been sick and I'm about halfway done."],
    ["Missed class", "I was sick Monday and missed class and the quiz. What did I miss, and can I make up the quiz?"],
    ["Recommendation letter", "Would you be willing to write me a recommendation letter for a summer program? It's due March 1."],
    ["Thank you note", "Thank you for helping me after school with the project. I got a B+ and I couldn't have done it without you."],
  ];

  const countWords = (text) => (String(text || "").match(/\S+/g) || []).length;

  const FORMAT = "Answer in exactly this format and nothing else:\n"
    + "SUBJECT: one short, clear subject line\n"
    + "BODY:\n"
    + "the whole email, from the greeting (like \"Dear Ms. Lopez,\") to the sign-off and the student's name";

  function system(tone) {
    return "You help a high school student write a short, clear email to a teacher, coach, counselor, employer or other adult. "
      + `Write it ${TONES[tone] || TONES.polite}. Keep it under 150 words, say the request plainly, `
      + "be honest, don't make up facts or dates the student didn't give, and never use all-caps words.\n" + FORMAT;
  }

  function signName(name) {
    const n = String(name || "").trim();
    return n ? `Sign it with my name: ${n}` : "I didn't give my name, so sign it with [Your name]";
  }

  function buildPrompt(to, need, tone, name) {
    const user = `Write an email to: ${String(to || "").trim() || "my teacher"}\n`
      + `What I need to say: ${String(need || "").trim().slice(0, MAX_NEED)}\n`
      + `${signName(name)}`;
    return [{ role: "system", content: system(tone) }, { role: "user", content: user }];
  }

  const HOW = {
    shorter: "Make it shorter: about half as long. Keep the greeting, the main request and the sign-off.",
    formal: "Make it more formal and professional: no slang, no contractions, respectful wording.",
  };

  function buildRevisePrompt(email, how, tone, name) {
    const user = `Here is my email draft:\n\n${asText(email)}\n\n${HOW[how] || how}\n`
      + `Keep the same meaning. ${signName(name)}`;
    return [{ role: "system", content: system(how === "formal" ? "formal" : tone) }, { role: "user", content: user }];
  }

  const SUBJECT = /^\s*(?:#{1,6}\s*)?subject(?:\s*line)?\s*(?::|[-–—])\s*(.*)$/i;
  const BODY = /^\s*(?:#{1,6}\s*)?(?:body|email)\s*(?:(?::|[-–—])\s*(.*))?$/i;

  function parseEmail(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n")
      .filter((l) => !/^\s*```/.test(l))
      .map((l) => l.replace(/\*\*|__/g, ""));
    const si = lines.findIndex((l) => SUBJECT.test(l));
    if (si < 0) return { subject: "", body: lines.join("\n").trim() };
    const subject = lines[si].match(SUBJECT)[1].trim().replace(/^["']|["']$/g, "").trim();
    let rest = lines.slice(si + 1);
    const bi = rest.findIndex((l) => l.trim());
    if (bi >= 0 && BODY.test(rest[bi])) {
      rest = [rest[bi].match(BODY)[1] || "", ...rest.slice(bi + 1)];
    }
    return { subject, body: rest.join("\n").replace(/^\s*\n/, "").trim() };
  }

  const GREETING = /^(?:dear|hi|hello|hey|good\s+(?:morning|afternoon|evening)|greetings|to\s+whom)\b/i;
  const SIGNOFF = /^(?:sincerely|best|thanks?|thank\s+you|regards|kind\s+regards|warm\s+regards|best\s+regards|respectfully|cheers|all\s+the\s+best|best\s+wishes|yours|take\s+care|gratefully|with\s+gratitude)\b/i;
  const OK_CAPS = new Set(["PSAT", "STEM", "NASA", "FAFSA", "JROTC", "ASVAB", "HTML", "AP", "SAT", "ACT", "USA", "GPA", "FBLA", "DECA", "HOSA"]);

  function shoutingWords(text, recipient) {
    const allowed = new Set((String(recipient || "").match(/\b[A-Z]{2,}\b/g) || []));
    return [...new Set((String(text || "").match(/\b[A-Z][A-Z']{3,}\b/g) || []).filter((w) => !OK_CAPS.has(w) && !allowed.has(w)))];
  }

  function emailChecks(email, recipient) {
    const subject = String(email?.subject || "").trim();
    const body = String(email?.body || "");
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const words = countWords(body);
    const loud = shoutingWords(`${subject}\n${body}`, recipient);
    const greeting = lines.length > 0 && GREETING.test(lines[0]);
    const signoff = lines.slice(-3).some((l) => SIGNOFF.test(l));
    return [
      { key: "greeting", ok: greeting, text: greeting ? "Starts with a greeting" : "Add a greeting, like \"Dear Ms. Lopez,\"" },
      { key: "signoff", ok: signoff, text: signoff ? "Ends with a sign-off" : "Add a sign-off, like \"Thank you,\" and your name" },
      { key: "length", ok: words > 0 && words < 200, text: words < 200 ? `Short enough (${words} words)` : `Long: ${words} words. Try under 200` },
      { key: "subject", ok: !!subject, text: subject ? "Has a subject line" : "Add a subject line" },
      { key: "caps", ok: loud.length === 0, text: loud.length ? `ALL CAPS can sound like shouting: ${loud.slice(0, 3).join(", ")}` : "No shouting in ALL CAPS" },
    ];
  }

  const asText = (email) => {
    const subject = String(email?.subject || "").trim();
    const body = String(email?.body || "").trim();
    return subject ? `Subject: ${subject}\n\n${body}` : body;
  };

  // Empty when the link would be too long for some email apps to open.
  function mailtoLink(email) {
    const enc = (s) => encodeURIComponent(String(s || "").trim().replace(/\r?\n/g, "\r\n"));
    const link = `mailto:?subject=${enc(email?.subject)}&body=${enc(email?.body)}`;
    return link.length <= MAILTO_MAX ? link : "";
  }

  return { MAX_NEED, MAILTO_MAX, TONES, EXAMPLES, countWords, buildPrompt, buildRevisePrompt, parseEmail, emailChecks, asText, mailtoLink };
})();
if (typeof module !== "undefined") module.exports = EmailWriter;

if (typeof document !== "undefined") (() => {
  const { MAX_NEED, EXAMPLES, countWords, buildPrompt, buildRevisePrompt, parseEmail, emailChecks, asText, mailtoLink } = EmailWriter;
  const SAVE_KEY = "local-ai-email";

  const style = document.createElement("style");
  style.textContent = `
    #email-dialog { width: min(640px, calc(100vw - 32px)); }
    #email-dialog label.email-field { display: block; margin: 14px 0 0; font-weight: 600; }
    #email-dialog input.email-input, #email-dialog textarea.email-input { display: block; width: 100%; margin-top: 6px; font: inherit;
      font-weight: 400; line-height: 1.5; padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
      background: var(--card); color: var(--text); outline: none; box-sizing: border-box; }
    #email-dialog textarea.email-input { min-height: 96px; max-height: 40vh; resize: vertical; }
    #email-dialog textarea.email-body { min-height: 240px; max-height: 46vh; }
    #email-dialog .email-input:focus { border-color: var(--accent); }
    .email-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .email-examples .email-chip { font-weight: 400; }
    .email-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 14px; }
    .email-row > span { font-weight: 600; }
    .email-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .email-writing { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .email-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: email-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes email-spin { to { transform: rotate(360deg); } }
    .email-live { max-height: 260px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; font-family: inherit; }
    .email-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .email-checks { list-style: none; margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px;
      background: var(--panel); display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 4px 14px; font-size: 0.9em; }
    .email-checks li { display: flex; gap: 8px; align-items: baseline; line-height: 1.4; overflow-wrap: anywhere; }
    .email-checks .email-mark { flex-shrink: 0; width: 1.2em; text-align: center; font-weight: 700; color: var(--fast); }
    .email-checks li.email-warn { color: var(--text); }
    .email-checks li.email-warn .email-mark { color: var(--slow); }
    .email-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; align-items: center; }
    .email-buttons .email-grow { flex: 1; }
    a.email-mail { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-strong); border-radius: 10px; padding: 7px 14px;
      color: inherit; text-decoration: none; }
    a.email-mail:hover { background: var(--hover); }
    a.email-mail[hidden] { display: none; }
    #email-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 500px) {
      #email-dialog { padding: 18px 16px 20px; }
      .email-buttons { align-items: stretch; }
      .email-buttons > button, .email-buttons > a.email-mail { flex: 1 1 calc(50% - 8px); text-align: center; padding-left: 8px; padding-right: 8px; }
      #email-dialog textarea.email-body { min-height: 200px; }
      .email-buttons .email-grow { display: none; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "email-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "✉️ Write an email");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "email-dialog", "aria-labelledby": "email-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is writing
  let state = { to: "", need: "", tone: "polite", name: "", subject: "", body: "" };

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && typeof d === "object") for (const k of Object.keys(state)) if (typeof d[k] === "string") state[k] = d[k];
    } catch { /* nothing saved */ }
  };
  const hasDraft = () => !!(state.subject.trim() || state.body.trim());

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "email-title" }, "✉️ Write an email"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawSetup(message) {
    const to = el("input", { class: "email-input", type: "text", maxlength: "120", placeholder: "e.g. Ms. Lopez, my chemistry teacher" });
    to.value = state.to;
    to.addEventListener("input", () => { state.to = to.value; save(); });
    const need = el("textarea", { class: "email-input", maxlength: String(MAX_NEED), placeholder: "e.g. I was sick Monday and missed the quiz. Can I make it up?" });
    need.value = state.need;
    need.addEventListener("input", () => { state.need = need.value; save(); });
    const examples = el("div", { class: "email-examples", role: "group", "aria-label": "Examples" },
      ...EXAMPLES.map(([label, text]) => el("button", { type: "button", class: "chip email-chip", onclick: () => {
        need.value = text; state.need = text; save(); need.focus();
      } }, label)));
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "Tone" });
    for (const [value, label] of [["polite", "Polite"], ["formal", "Formal"], ["friendly", "Friendly"]]) {
      seg.append(el("button", { type: "button", class: value === state.tone ? "on" : "", "aria-pressed": String(value === state.tone), onclick: (e) => {
        state.tone = value; save();
        seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
      } }, label));
    }
    const name = el("input", { class: "email-input", type: "text", maxlength: "80", placeholder: "e.g. Jordan Smith", autocomplete: "name" });
    name.value = state.name;
    name.addEventListener("input", () => { state.name = name.value; save(); });
    const go = () => (need.value.trim() ? write() : (drawSetup("Write what you need to say first, or tap an example."), null));
    setDialog(head(),
      el("p", { class: "note" }, "Say who it's for and what you need. The AI on this computer drafts a clear, polite email you can edit before sending."),
      el("label", { class: "email-field" }, "Who is it to?", to),
      el("label", { class: "email-field" }, "What do you need to say?", need),
      examples,
      el("div", { class: "email-row" }, el("span", {}, "Tone"), seg),
      el("label", { class: "email-field" }, "Your name", name),
      message ? el("p", { class: "email-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" },
        hasDraft() ? el("button", { onclick: () => drawResult() }, "Back to draft") : null,
        el("button", { class: "primary", onclick: go }, "Write email")));
    (state.to ? need : to).focus();
  }

  function drawWriting(live, label) {
    setDialog(head(),
      el("div", { class: "email-writing" }, el("span", { class: "email-spin", "aria-hidden": "true" }), label),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function drawResult(message) {
    const subject = el("input", { class: "email-input", type: "text", "aria-label": "Subject" });
    subject.value = state.subject;
    const body = el("textarea", { class: "email-input email-body", "aria-label": "Email" });
    body.value = state.body;
    const count = el("span", { class: "email-count", "aria-live": "polite" });
    const checks = el("ul", { class: "email-checks", "aria-label": "Email checklist" });
    const mail = el("a", { class: "email-mail", href: "#" }, "📨 Open in email app");
    let tooLong = false;
    const update = (fromUser) => {
      state.subject = subject.value;
      state.body = body.value;
      if (fromUser) save();
      const n = countWords(body.value);
      count.textContent = `${n} ${n === 1 ? "word" : "words"}`;
      checks.replaceChildren(...emailChecks(state, state.to).map((c) =>
        el("li", { class: c.ok ? "" : "email-warn" }, el("span", { class: "email-mark", "aria-hidden": "true" }, c.ok ? "✓" : "⚠"), c.text)));
      const href = mailtoLink(state);
      mail.hidden = !href;
      if (href) mail.href = href;
      if (!href && !tooLong) toast("This email is too long to open in an email app. Use Copy and paste it instead.");
      tooLong = !href;
    };
    subject.addEventListener("input", () => update(true));
    body.addEventListener("input", () => update(true));
    update(false);
    setDialog(head(),
      state.to.trim() ? el("p", { class: "note" }, `To: ${state.to.trim()}. Read it over and change anything that isn't right.`) : null,
      el("label", { class: "email-field" }, "Subject", subject),
      el("label", { class: "email-field" }, "Email", body, count),
      checks,
      message ? el("p", { class: "email-msg", role: "alert" }, message) : null,
      el("div", { class: "email-buttons" },
        el("button", { onclick: () => revise("shorter") }, "✂️ Make it shorter"),
        el("button", { onclick: () => revise("formal") }, "🎩 More formal")),
      el("div", { class: "email-buttons" },
        el("button", { onclick: () => drawSetup() }, "Back"),
        el("span", { class: "email-grow" }),
        el("button", { onclick: (e) => copyText(e.currentTarget, asText(state)) }, "📋 Copy"),
        mail,
        el("button", { class: "primary", onclick: () => {
          state = { to: "", need: "", tone: state.tone, name: state.name, subject: "", body: "" };
          save();
          drawSetup();
        } }, "New email")));
  }

  // Sends the prompt and streams the reply; resolves with {subject, body}, or throws.
  async function stream(messages, label) {
    busy = new AbortController();
    const live = el("pre", { class: "email-live" }, "Waiting for the AI...");
    drawWriting(live, label);
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
      const email = parseEmail(reply);
      if (!email.body) throw new Error("the AI sent an empty answer");
      return email;
    } finally {
      busy = null;
    }
  }

  const tinyGPT = () => findModel(currentModel())?.experimental;
  const TINY = "TinyGPT is a tiny practice model and can't write emails. Pick a real chat model in Models first, then try again.";

  async function write() {
    if (tinyGPT()) return drawSetup(TINY);
    try {
      const email = await stream(buildPrompt(state.to, state.need, state.tone, state.name), "Writing…");
      Object.assign(state, email);
      save();
      if (dialog.open) drawResult();
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawSetup("Stopped. Press Write email to try again.");
      else drawSetup(`Couldn't write the email: ${err.message}`);
    }
  }

  async function revise(how) {
    if (tinyGPT()) return drawResult(TINY);
    if (!state.body.trim()) return drawResult("Write something in the email first.");
    try {
      const email = await stream(buildRevisePrompt(state, how, state.tone, state.name), how === "shorter" ? "Making it shorter…" : "Making it more formal…");
      if (!email.subject) email.subject = state.subject;
      Object.assign(state, email);
      save();
      if (dialog.open) drawResult();
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawResult("Stopped. Your draft is unchanged.");
      else drawResult(`Couldn't change the email: ${err.message}`);
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    load();
    if (hasDraft()) drawResult();
    else drawSetup();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
