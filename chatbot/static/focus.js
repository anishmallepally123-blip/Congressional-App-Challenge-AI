// "🎯 Focus timer": a study timer. The student writes what they'll work on, picks 15, 25 or 45
// minutes, and a pill in the header counts down. When time is up it chimes and asks how it went.
// The running session and a log of finished ones are kept in this browser only.

// Pure helpers (no page needed), so test_focus.py can run them with Node.
const FocusTimer = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  // 754000 -> "12:34". Rounds up so the clock shows 00:00 only when time is really up.
  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
  // Milliseconds left. A paused session keeps the time it had left when it was paused.
  function remaining(session, now) {
    if (!session) return 0;
    if (session.pausedLeft != null) return Math.max(0, session.pausedLeft);
    return Math.max(0, session.end - now);
  }
  function pause(session, now) {
    return session.pausedLeft != null ? session : { ...session, pausedLeft: remaining(session, now) };
  }
  function resume(session, now) {
    if (session.pausedLeft == null) return session;
    const { pausedLeft, ...rest } = session;
    return { ...rest, end: now + pausedLeft };
  }
  // Local date as YYYY-MM-DD (not toISOString, which is UTC and can be "tomorrow" in the evening).
  function localIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function todayStats(log, todayIso) {
    const today = (Array.isArray(log) ? log : []).filter((s) => s && s.date === todayIso);
    return { sessions: today.length, minutes: today.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0), recent: today.slice(-5).reverse() };
  }
  function addToLog(log, entry, keep = 100) {
    return [...(Array.isArray(log) ? log : []), entry].slice(-keep);
  }
  return { formatClock, remaining, pause, resume, localIso, todayStats, addToLog };
})();
if (typeof module !== "undefined") module.exports = FocusTimer;

if (typeof document !== "undefined") (() => {
  const { formatClock, remaining, localIso, todayStats, addToLog } = FocusTimer;
  const SESSION_KEY = "local-ai-focus";
  const LOG_KEY = "local-ai-focus-log";
  const LENGTHS = [15, 25, 45];
  const RESULTS = { yes: "✅ Finished", partly: "🌓 Partly", notyet: "⏳ Not yet" };

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #focus-dialog { width: min(460px, calc(100vw - 32px)); }
    #focus-dialog label { display: block; margin: 14px 0 6px; font-weight: 600; }
    #focus-dialog input[type=text] { display: block; width: 100%; margin-top: 6px; font-weight: 400; padding: 9px 12px;
      border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    #focus-dialog input[type=text]:focus { border-color: var(--accent); }
    #focus-dialog .segmented { width: fit-content; }
    #focus-dialog button:disabled { opacity: 1; color: inherit; }
    .focus-pill { flex-shrink: 0; display: block; max-width: 45vw; padding: 4px 12px;
      border: 1px solid var(--accent); border-radius: 999px; background: var(--accent-soft); color: var(--text);
      font-size: 0.85em; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .focus-pill.focus-paused { opacity: 0.7; border-style: dashed; }
    .focus-pill.focus-up { background: var(--accent); color: var(--accent-text); }
    .focus-clock { margin: 18px 0 4px; text-align: center; font-size: 3em; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
    .focus-goal { margin: 0; text-align: center; color: var(--muted); overflow-wrap: anywhere; }
    .focus-stats { margin: 18px 0 6px; padding-top: 12px; border-top: 1px solid var(--border); font-weight: 600; font-size: 0.92em; }
    .focus-list { list-style: none; margin: 0; padding: 0; font-size: 0.88em; color: var(--muted); }
    .focus-list li { display: flex; gap: 8px; padding: 3px 0; }
    .focus-list .focus-what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .focus-results { justify-content: center; flex-wrap: wrap; }`;
  document.head.append(style);

  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* blocked; fine for this visit */ } };

  let session = load(SESSION_KEY, null); // { goal, minutes, end, pausedLeft? } or with done: true when time is up
  if (session && (typeof session.minutes !== "number" || (typeof session.end !== "number" && session.pausedLeft == null))) session = null;
  let tick = null;
  const save = () => store(SESSION_KEY, session);

  const link = el("button", { id: "focus-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🎯 Focus timer");
  $("personal-link").before(link);

  const pill = el("button", { id: "focus-pill", class: "focus-pill", type: "button", hidden: true, title: "Focus timer", onclick: () => open() });
  $("chat-title").after(pill);

  const dialog = el("dialog", { id: "focus-dialog", "aria-labelledby": "focus-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "focus-title" }, "🎯 Focus timer"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.22;
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.65);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch { /* no sound on this browser; the toast and dialog still show */ }
  }

  function update() {
    if (!session) { pill.hidden = true; clearInterval(tick); tick = null; return; }
    const left = remaining(session, Date.now());
    if (!session.done && left <= 0) return timeUp();
    pill.hidden = false;
    pill.classList.toggle("focus-paused", session.pausedLeft != null && !session.done);
    pill.classList.toggle("focus-up", !!session.done);
    pill.textContent = session.done ? `🎯 Time's up · ${session.goal}` : `🎯 ${formatClock(left)} · ${session.goal}`;
    const clock = dialog.querySelector(".focus-clock");
    if (clock && !session.done) clock.textContent = formatClock(left);
  }

  function startTicking() {
    if (!tick) tick = setInterval(update, 1000);
    update();
  }

  function timeUp() {
    session = { ...session, done: true };
    save();
    clearInterval(tick);
    tick = null;
    update();
    chime();
    toast("Focus session done! Take a 5 minute break.");
    open();
  }

  function finish(result) {
    store(LOG_KEY, addToLog(load(LOG_KEY, []), { goal: session.goal, minutes: session.minutes, result, date: localIso(new Date()) }));
    session = null;
    save();
    update();
    drawIdle();
  }

  function stats() {
    const s = todayStats(load(LOG_KEY, []), localIso(new Date()));
    return [
      el("p", { class: "focus-stats" }, `Today: ${s.sessions} session${s.sessions === 1 ? "" : "s"} · ${s.minutes} minute${s.minutes === 1 ? "" : "s"}`),
      s.recent.length ? el("ul", { class: "focus-list" }, ...s.recent.map((r) =>
        el("li", {}, el("span", { class: "focus-what" }, r.goal), el("span", {}, `${r.minutes} min`), el("span", {}, RESULTS[r.result] || "")))) : null,
    ];
  }

  function drawIdle() {
    let minutes = 25;
    const goal = el("input", { type: "text", "data-focus": true, placeholder: "e.g. Read chapter 4 of biology", maxlength: "80" });
    const seg = el("div", { class: "segmented", role: "group", "aria-label": "How long" });
    for (const m of LENGTHS) {
      seg.append(el("button", { type: "button", class: m === minutes ? "on" : "", onclick: (e) => {
        minutes = m;
        seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      } }, `${m} min`));
    }
    const start = () => {
      if (!goal.value.trim()) return goal.focus();
      session = { goal: goal.value.trim(), minutes, end: Date.now() + minutes * 60000 };
      save();
      startTicking();
      dialog.close();
      toast(`Focus for ${minutes} minutes. You've got this!`);
    };
    goal.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
    setDialog(head(),
      el("p", { class: "note" }, "Pick one thing to work on and put your phone away. Take a short break when the timer ends."),
      el("label", {}, "What will you work on?", goal),
      el("label", {}, "How long"), seg,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: start }, "Start")),
      ...stats());
    if (dialog.open) goal.focus();
  }

  function drawRunning() {
    const paused = session.pausedLeft != null;
    const toggle = () => {
      session = paused ? FocusTimer.resume(session, Date.now()) : FocusTimer.pause(session, Date.now());
      save();
      update();
      drawRunning();
    };
    const stop = () => { session = null; save(); update(); drawIdle(); };
    setDialog(head(),
      el("div", { class: "focus-clock", role: "timer" }, formatClock(remaining(session, Date.now()))),
      el("p", { class: "focus-goal" }, `${paused ? "Paused · " : ""}${session.goal}`),
      el("div", { class: "dialog-buttons" },
        el("button", { onclick: stop }, "Stop"),
        el("button", { class: "primary", onclick: toggle }, paused ? "Resume" : "Pause")));
  }

  function drawDone() {
    const yes = el("button", { class: "primary", "data-focus": true, onclick: () => finish("yes") }, "Yes");
    setDialog(head(),
      el("div", { class: "focus-clock" }, "🎉"),
      el("p", { class: "focus-goal" }, `${session.minutes} minutes on: ${session.goal}`),
      el("h3", { style: "text-align:center;margin:16px 0 0" }, "Did you finish?"),
      el("div", { class: "dialog-buttons focus-results" },
        yes,
        el("button", { onclick: () => finish("partly") }, "Partly"),
        el("button", { onclick: () => finish("notyet") }, "Not yet")));
  }

  function open() {
    if (!session) drawIdle();
    else if (session.done) drawDone();
    else drawRunning();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("[data-focus]")?.focus();
  }

  if (session) startTicking();
})();
