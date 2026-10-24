// "🔗 Cause and effect": the student names an event or phenomenon (the Great Depression,
// deforestation...) and the AI on this computer lists what caused it and what it led to,
// split into short-term and long-term effects. The page draws it as a diagram:
// cause boxes → the event → effect boxes, plus a "Why it matters" line.
// The last result is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_causeeffect.py can run them with Node.
const LocalAICauseEffect = (() => {
  const MAX_TOPIC = 100;
  const MAX_CONTEXT = 120;
  const MAX_ITEMS = 6; // boxes per group
  const MAX_ITEM_CHARS = 140;

  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  function buildPrompt(topic, context) {
    topic = clean(topic, MAX_TOPIC); context = clean(context, MAX_CONTEXT);
    const system = "You explain causes and effects for a student. Use simple words and true, well-known facts. Keep every item short (under 12 words). "
      + "Answer in exactly this format and nothing else:\n"
      + "CAUSES:\n- something that led to it (3 to 5 items)\n"
      + "SHORT-TERM EFFECTS:\n- something that happened soon after (2 to 4 items)\n"
      + "LONG-TERM EFFECTS:\n- something that lasted for years or still matters (2 to 4 items)\n"
      + "WHY IT MATTERS: one sentence on why a student should care";
    const user = `Event or phenomenon: ${topic}` + (context ? `\nClass or context: ${context}` : "");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const END = "(?:\\s+(?:of|from)\\s+[^:]{1,80}?)?\\s*(?::|\\s[-–]\\s|$)\\s*(.*)$";
  const HEADS = [
    ["shortTerm", new RegExp(`^(?:short[\\s-]*term(?:\\s+(?:effects?|results?|consequences?))?|immediate\\s+(?:effects?|results?|consequences?))${END}`, "i")],
    ["longTerm", new RegExp(`^(?:long[\\s-]*term(?:\\s+(?:effects?|results?|consequences?))?|lasting\\s+(?:effects?|results?|consequences?))${END}`, "i")],
    ["causes", new RegExp(`^(?:causes?|main\\s+causes|reasons?|why\\s+it\\s+happened)${END}`, "i")],
    ["effects", new RegExp(`^(?:effects?|results?|consequences?)${END}`, "i")],
    ["why", new RegExp(`^(?:why\\s+it\\s+matters|why\\s+this\\s+matters|significance|importance)${END}`, "i")],
  ];

  const unwrap = (s) => s.replace(/^["'*_\s]+|["'*_\s]+$/g, "").trim();

  function parse(text) {
    const out = { causes: [], shortTerm: [], longTerm: [], why: "" };
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const wasBullet = BULLET.test(line);
      if (!wasBullet) {
        for (const [name, re] of HEADS) {
          const h = line.match(re);
          if (h) { section = name === "effects" ? "shortTerm" : name; line = h[1].trim(); break; }
        }
        if (!line) continue;
      }
      const item = clean(unwrap(line.replace(BULLET, "")), MAX_ITEM_CHARS);
      if (!item || /^(?:none|n\/a|nothing)\.?$/i.test(item)) continue;
      if (section === "why") out.why = clean(out.why ? `${out.why} ${item}` : item, 300);
      else if (section && out[section].length < MAX_ITEMS && !out[section].includes(item)) out[section].push(item);
    }
    return out;
  }

  const parsedOk = (r) => !!(r && r.causes.length && (r.shortTerm.length + r.longTerm.length));

  function toPlainText(r, topic, context) {
    const lines = [`Cause and effect: ${clean(topic, MAX_TOPIC)}` + (context ? ` (${clean(context, MAX_CONTEXT)})` : "")];
    const list = (title, items) => { if (items.length) lines.push("", `${title}:`, ...items.map((t) => `- ${t}`)); };
    list("Causes", r.causes);
    list("Short-term effects", r.shortTerm);
    list("Long-term effects", r.longTerm);
    if (r.why) lines.push("", `Why it matters: ${r.why}`);
    return lines.join("\n");
  }

  return { MAX_TOPIC, MAX_CONTEXT, MAX_ITEMS, buildPrompt, parse, parsedOk, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAICauseEffect = LocalAICauseEffect;
if (typeof module !== "undefined") module.exports = LocalAICauseEffect;

if (typeof document !== "undefined") (() => {
  const { MAX_TOPIC, MAX_CONTEXT, buildPrompt, parse, parsedOk, toPlainText } = LocalAICauseEffect;
  const SAVE_KEY = "local-ai-cause-effect";
  const EXAMPLES = [["The Great Depression", "US History"], ["Deforestation", "Environmental science"], ["The French Revolution", "World History"]];

  const style = document.createElement("style");
  style.textContent = `
    #cause-effect-dialog { width: min(900px, calc(100vw - 32px)); }
    .ce-field { display: block; font-weight: 600; margin-top: 12px; min-width: 0; }
    .ce-field small { font-weight: 400; color: var(--muted); }
    .ce-field input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .ce-field input:focus { border-color: var(--accent); }
    .ce-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .ce-examples button { font-size: 0.95em; padding: 4px 10px; border-radius: 999px; }
    .ce-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .ce-working { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .ce-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: ce-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes ce-spin { to { transform: rotate(360deg); } }
    .ce-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .ce-context { margin: 4px 0 0; font-size: 0.85em; color: var(--muted); }
    .ce-diagram { display: grid; grid-template-columns: minmax(0, 1fr) 28px minmax(0, 0.8fr) 28px minmax(0, 1fr);
      align-items: center; gap: 6px; margin-top: 14px; }
    .ce-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .ce-label { font-size: 0.72em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin: 4px 0 -2px; }
    .ce-box { padding: 8px 10px; border-radius: 10px; border: 1.5px solid var(--border-strong); background: var(--card);
      line-height: 1.35; font-size: 0.92em; overflow-wrap: anywhere; }
    .ce-cause { border-color: #3a86c8; background: color-mix(in srgb, #3a86c8 9%, var(--card)); }
    .ce-short { border-color: var(--slow); background: color-mix(in srgb, var(--slow) 10%, var(--card)); }
    .ce-long { border-color: var(--fast); background: color-mix(in srgb, var(--fast) 10%, var(--card)); }
    .ce-event { padding: 16px 12px; border-radius: 14px; border: 2px solid var(--accent); background: var(--accent-soft);
      text-align: center; font-weight: 700; font-size: 1.05em; line-height: 1.3; overflow-wrap: anywhere; }
    .ce-event small { display: block; font-size: 0.68em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .ce-arrow { text-align: center; font-size: 1.5em; font-weight: 700; color: var(--accent); line-height: 1; }
    .ce-why { margin: 18px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.5; overflow-wrap: anywhere; }
    .ce-why small { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .ce-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .ce-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .ce-buttons .ce-grow { flex: 1; }
    #cause-effect-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 640px) {
      .ce-diagram { grid-template-columns: minmax(0, 1fr); gap: 6px; }
      .ce-arrow { transform: rotate(90deg); }
      .ce-event { padding: 12px; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "cause-effect-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🔗 Cause and effect");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "cause-effect-dialog", "aria-labelledby": "cause-effect-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  let draft = { topic: "", context: "" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && typeof d.reply === "string" && d.topic ? d : null; } catch { return null; } };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "cause-effect-title" }, "🔗 Cause and effect"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    const input = (key, max, placeholder) => {
      const i = el("input", { type: "text", maxlength: String(max), placeholder, autocomplete: "off" });
      i.value = draft[key];
      i.addEventListener("input", () => { draft[key] = i.value; });
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      return i;
    };
    const inT = input("topic", MAX_TOPIC, "e.g. The Great Depression");
    const inC = input("context", MAX_CONTEXT, "e.g. US History, Biology");
    const go = () => {
      const topic = inT.value.trim();
      if (!topic) return drawInput("Type an event or something that happens first.");
      run(topic, inC.value.trim());
    };
    const examples = el("div", { class: "ce-examples" }, "Try:",
      ...EXAMPLES.map(([topic, context]) => el("button", { type: "button", onclick: () => { draft = { topic, context }; drawInput(); } }, topic)));
    setDialog(head(),
      el("p", { class: "note" }, "Name an event or something that happens. The AI on this computer shows what caused it and what it led to, soon after and for years."),
      el("label", { class: "ce-field" }, "Event or phenomenon", inT),
      el("label", { class: "ce-field" }, "Class or context ", el("small", {}, "(optional)"), inC),
      examples,
      message ? el("p", { class: "ce-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Show causes and effects")));
    (inT.value ? inC : inT).focus();
  }

  function drawWorking(live) {
    setDialog(head(),
      el("div", { class: "ce-working" }, el("span", { class: "ce-spin", "aria-hidden": "true" }), "Tracing causes and effects…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  const boxes = (items, cls) => items.map((t) => el("div", { class: `ce-box ${cls}` }, t));

  function drawDiagram(r, topic) {
    const effects = el("div", { class: "ce-col", "aria-label": "Effects" },
      r.shortTerm.length ? el("div", { class: "ce-label" }, "⏱ Short-term effects") : null,
      ...boxes(r.shortTerm, "ce-short"),
      r.longTerm.length ? el("div", { class: "ce-label" }, "⏳ Long-term effects") : null,
      ...boxes(r.longTerm, "ce-long"));
    return el("div", { class: "ce-diagram", role: "group",
      "aria-label": `${r.causes.length} causes lead to ${topic}, which leads to ${r.shortTerm.length} short-term and ${r.longTerm.length} long-term effects` },
      el("div", { class: "ce-col", "aria-label": "Causes" }, el("div", { class: "ce-label" }, "Causes"), ...boxes(r.causes, "ce-cause")),
      el("div", { class: "ce-arrow", "aria-hidden": "true" }, "→"),
      el("div", { class: "ce-event" }, el("small", {}, "Event"), topic),
      el("div", { class: "ce-arrow", "aria-hidden": "true" }, "→"),
      effects);
  }

  function drawResult(data) {
    const r = parse(data.reply);
    const ok = parsedOk(r);
    const plain = ok ? toPlainText(r, data.topic, data.context) : data.reply.trim();
    setDialog(head(),
      data.context ? el("p", { class: "ce-context" }, data.context) : null,
      ok ? drawDiagram(r, data.topic) : null,
      ok && r.why ? el("div", { class: "ce-why" }, el("small", {}, "Why it matters"), r.why) : null,
      ok ? null : el("p", { class: "ce-raw" }, plain || "(no answer)"),
      el("div", { class: "ce-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy as text"),
        el("span", { class: "ce-grow" }),
        el("button", { onclick: () => { draft = { topic: data.topic, context: data.context || "" }; drawInput(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { draft = { topic: "", context: data.context || "" }; drawInput(); } }, "New topic")));
  }

  async function run(topic, context) {
    const model = currentModel();
    if (findModel(currentModel())?.experimental) return drawInput("TinyGPT is a tiny practice model and can't explain causes and effects. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "ce-live" }, "Waiting for the AI...");
    drawWorking(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(topic, context), think: false, auto_code: false }),
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
      const data = { topic, context, reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press the button to try again.");
      else drawInput(`Couldn't finish: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    const saved = loadSaved();
    if (saved) drawResult(saved);
    else drawInput();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
