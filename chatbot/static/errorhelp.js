// "🐞 Explain an error": a student learning to code pastes an error message (and maybe their code)
// and the AI explains in plain language what went wrong, where, and how to fix it. The line number
// and error type are read from the message right away, before the AI answers.
// The inputs and the last explanation are kept in this browser so reopening shows them again.

// Pure helpers (no page needed), so test_errorhelp.py can run them with Node.
const ErrorHelp = (() => {
  const MAX_ERROR = 4000;
  const MAX_CODE = 8000;
  const LANGS = { python: "Python", javascript: "JavaScript", java: "Java", cpp: "C / C++", unknown: "Not sure" };

  const EXAMPLE = {
    code: 'scores = [90, 85, 77]\ntotal = 0\nfor i in range(len(scores) + 1):\n    total += scores[i]\nprint("Average:", total / len(scores))',
    error: 'Traceback (most recent call last):\n  File "grades.py", line 4, in <module>\n    total += scores[i]\nIndexError: list index out of range',
  };

  // Guess the language from what the error looks like, then from the code.
  function detectLanguage(error, code) {
    const e = String(error || "");
    const c = String(code || "");
    if (/Exception in thread "|\bat [\w$.<>]+\([\w$]+\.java:\d+\)|\.java:\d+: error:|\bjava\.\w+\.\w+(?:Exception|Error)\b/.test(e)) return "java";
    if (/\.(?:c|cc|cpp|cxx|h|hh|hpp)(?::\d+){1,2}:\s*(?:fatal\s+)?(?:error|warning)\b|\.(?:c|cc|cpp|cxx|h|hpp)\(\d+\)\s*:\s*(?:fatal\s+)?error|undefined reference to|Segmentation fault|core dumped/.test(e)) return "cpp";
    if (/Traceback \(most recent call last\)|File "[^"]+", line \d+|\.py\b/.test(e)) return "python";
    if (/\b(?:IndexError|KeyError|NameError|AttributeError|ValueError|ZeroDivisionError|IndentationError|ModuleNotFoundError|ImportError)\b/.test(e)) return "python";
    if (/\bat .*\.(?:m?js|cjs|jsx|tsx?)(?:\?\S*)?:\d+:\d+|\.(?:m?js|cjs|jsx|tsx?):\d+|Uncaught\b|\bReferenceError\b|is not a function|is not defined\b|Cannot read propert/.test(e)) return "javascript";
    if (/^\s*#include\b|\bstd::|\bcout\s*<<|\bint\s+main\s*\(/m.test(c)) return "cpp";
    if (/\bpublic\s+(?:static\s+)?(?:class|void)\b|System\.out\./.test(c)) return "java";
    if (/\bconsole\.\w+\(|\b(?:const|let|var)\s+\w+\s*=|=>|\bfunction\s+\w*\s*\(|document\./.test(c)) return "javascript";
    if (/^\s*(?:def|class|elif|import|from)\b|^\s*for\s+\w+\s+in\b|\bprint\(|:\s*$/m.test(c)) return "python";
    if (/\b\w+Exception\b/.test(e)) return "java";
    if (/\b(?:TypeError|SyntaxError|RangeError)\b/.test(e)) return "javascript";
    return "unknown";
  }

  const baseName = (path) => String(path || "").replace(/[?#].*$/, "").split(/[\\/]/).pop();
  const lines = (text) => String(text || "").split(/\r?\n/);

  function pythonLocation(e) {
    const out = { line: null, file: "", type: "", message: "" };
    const frames = [...e.matchAll(/File "([^"]+)", line (\d+)/g)];
    if (frames.length) { const f = frames.at(-1); out.file = baseName(f[1]); out.line = Number(f[2]); }
    const last = lines(e).map((l) => l.trim()).filter(Boolean).reverse()
      .find((l) => /^[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit)\b(?::|$)/.test(l));
    if (last) {
      const m = last.match(/^([A-Za-z_][\w.]*)(?::\s*(.*))?$/);
      out.type = m[1].split(".").pop();
      out.message = (m[2] || "").trim();
    }
    return out;
  }

  function jsLocation(e) {
    const out = { line: null, file: "", type: "", message: "" };
    const head = e.match(/(?:Uncaught\s+(?:\(in promise\)\s+)?)?\b([A-Z]\w*(?:Error|Exception))\s*:\s*(.*)/);
    if (head) { out.type = head[1]; out.message = head[2].trim(); }
    const frames = [...e.matchAll(/\bat\s+(?:.*?\()?((?:[a-z]+:\/\/)?[^\s()]+?):(\d+):(\d+)\)?/g)]
      .filter((f) => !/^node:|internal\//.test(f[1]));
    const top = e.match(/^\s*((?:[a-z]+:\/\/)?[^\s()]+?\.(?:m?js|cjs|jsx|tsx?)):(\d+)\b/m);
    if (frames.length) { out.file = baseName(frames[0][1]); out.line = Number(frames[0][2]); }
    else if (top) { out.file = baseName(top[1]); out.line = Number(top[2]); }
    return out;
  }

  function javaLocation(e) {
    const out = { line: null, file: "", type: "", message: "" };
    const compile = e.match(/^\s*(.*?\.java):(\d+):\s*error:\s*(.*)$/m);
    if (compile) return { line: Number(compile[2]), file: baseName(compile[1]), type: "Compile error", message: compile[3].trim() };
    const causes = [...e.matchAll(/Caused by:\s*([\w.$]+)(?::\s*(.*))?/g)];
    const head = causes.at(-1) || e.match(/Exception in thread "[^"]*"\s+([\w.$]+)(?::\s*(.*))?/) || e.match(/^\s*([\w.$]+(?:Exception|Error))(?::\s*(.*))?$/m);
    if (head) { out.type = head[1].split(".").pop(); out.message = (head[2] || "").trim(); }
    const frame = e.match(/\bat\s+[\w$.<>]+\(([\w$]+\.java):(\d+)\)/);
    if (frame) { out.file = frame[1]; out.line = Number(frame[2]); }
    return out;
  }

  function cppLocation(e) {
    const gcc = e.match(/^\s*(.*?\.(?:c|cc|cpp|cxx|h|hh|hpp)):(\d+)(?::\d+)?:\s*(?:fatal\s+)?error:\s*(.*)$/m);
    if (gcc) return { line: Number(gcc[2]), file: baseName(gcc[1]), type: "Compiler error", message: gcc[3].trim() };
    const msvc = e.match(/^\s*(.*?\.(?:c|cc|cpp|cxx|h|hh|hpp))\((\d+)\)\s*:\s*(?:fatal\s+)?error\s*\w*\s*:\s*(.*)$/m);
    if (msvc) return { line: Number(msvc[2]), file: baseName(msvc[1]), type: "Compiler error", message: msvc[3].trim() };
    const link = e.match(/undefined reference to [`'"]?([^`'"\n]+)[`'"]?/);
    if (link) return { line: null, file: "", type: "Linker error", message: `undefined reference to ${link[1]}` };
    if (/Segmentation fault/.test(e)) return { line: null, file: "", type: "Segmentation fault", message: "the program used memory it doesn't own" };
    return { line: null, file: "", type: "", message: "" };
  }

  const FINDERS = { python: pythonLocation, javascript: jsLocation, java: javaLocation, cpp: cppLocation };

  // {line, file, type, message} read straight from the error text; empty parts are "" or null.
  function extractLocation(error, language) {
    const e = String(error || "");
    const order = FINDERS[language] ? [language] : ["python", "java", "cpp", "javascript"];
    let best = { line: null, file: "", type: "", message: "" };
    for (const lang of order) {
      const got = FINDERS[lang](e);
      if (got.line || got.type) { best = got; break; }
    }
    if (!best.type) {
      const first = lines(e).map((l) => l.trim()).find(Boolean) || "";
      const m = first.match(/^([A-Z]\w*(?:Error|Exception))\s*:\s*(.*)$/);
      if (m) { best.type = m[1]; best.message = m[2].trim(); }
    }
    if (best.message.length > 300) best.message = `${best.message.slice(0, 300)}…`;
    return best;
  }

  // "IndexError on line 4", "IndexError", "Error on line 4" or "".
  function locationLabel(loc, sep = " on ") {
    if (!loc) return "";
    const type = loc.type || (loc.line ? "Error" : "");
    return loc.line ? `${type}${sep}line ${loc.line}` : type;
  }

  // The error line of the code with a few lines around it: [{n, text, hit}], or [] when it isn't there.
  function codeContext(code, line, around = 2) {
    const all = lines(code);
    if (!code || !Number.isInteger(line) || line < 1 || line > all.length) return [];
    const from = Math.max(1, line - around);
    const to = Math.min(all.length, line + around);
    const out = [];
    for (let n = from; n <= to; n++) out.push({ n, text: all[n - 1], hit: n === line });
    return out;
  }

  function buildPrompt(error, code, lang, loc) {
    const name = LANGS[lang] && lang !== "unknown" ? LANGS[lang] : "";
    const system = "You help a beginner student who is learning to code understand an error message. "
      + "Use simple, friendly words and explain any technical word you use. Explain what caused the error and point to the line where it happened. "
      + "Do not rewrite the whole program: show only the line or lines that need to change. "
      + "Answer in exactly this format and nothing else:\n"
      + "WHAT IT MEANS: one or two sentences saying what the error means in plain language\n"
      + "WHY IT HAPPENED: one to three sentences about the cause in this student's code, naming the line\n"
      + "HOW TO FIX: one sentence saying what to change\n"
      + "```\nonly the changed line(s)\n```\n"
      + "TIP: one short tip to avoid this kind of error next time";
    const where = locationLabel(loc);
    const user = [
      name ? `Language: ${name}` : "",
      where ? `The error looks like: ${where}${loc.file ? ` in ${loc.file}` : ""}` : "",
      `ERROR MESSAGE:\n${String(error || "").slice(0, MAX_ERROR)}`,
      code && String(code).trim() ? `MY CODE (with line numbers):\n${lines(String(code).slice(0, MAX_CODE)).map((l, i) => `${i + 1}: ${l}`).join("\n")}` : "I don't have the code to share, only the error.",
      "Explain this error to me.",
    ].filter(Boolean).join("\n\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const HEADS = [
    ["meaning", /^(?:what\s*(?:it|this|the\s*error)\s*means|meaning)\b\s*[:\-–]?\s*(.*)$/i],
    ["why", /^(?:why\s*(?:it|this)\s*happened|why|cause)\b\s*[:\-–]?\s*(.*)$/i],
    ["fix", /^(?:how\s*to\s*fix(?:\s*it)?|the\s*fix|fix)\b\s*[:\-–]?\s*(.*)$/i],
    ["tip", /^(?:tip|next\s*time|to\s*avoid\s*it)\b\s*[:\-–]?\s*(.*)$/i],
  ];
  const BULLET = /^(?:[-*•]|\d{1,2}[.)])\s+/;

  function parseExplain(text) {
    const out = { meaning: "", why: "", fix: "", fixCode: "", tip: "" };
    const fixCode = [];
    const otherCode = [];
    let section = null;
    let fence = null; // lines of the code block being read
    const add = (key, s) => { out[key] = out[key] ? `${out[key]} ${s}` : s; };
    for (const raw of lines(text)) {
      if (/^\s*(?:```|~~~)/.test(raw)) {
        if (fence) { (section === "fix" ? fixCode : otherCode).push(fence.join("\n")); fence = null; } else fence = [];
        continue;
      }
      if (fence) { fence.push(raw.replace(/\s+$/, "")); continue; }
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const bare = line.replace(BULLET, "");
      const head = HEADS.find(([, re]) => re.test(bare));
      if (head && (/[:\-–]/.test(bare) || bare.length < 24)) {
        section = head[0];
        line = bare.match(head[1])[1].trim();
        if (!line) continue;
      }
      if (!section) continue;
      add(section, line.replace(/^\*\s*|\s*\*$/g, "").trim());
    }
    if (fence && fence.length) (section === "fix" ? fixCode : otherCode).push(fence.join("\n")); // the reply stopped inside a code block
    if (section) out.fixCode = (fixCode[0] || otherCode.at(-1) || "").replace(/^\n+|\n+$/g, "");
    return out;
  }

  const parsedOk = (r) => !!(r && (r.meaning || r.why || r.fix || r.fixCode));

  function asText(r, loc) {
    const out = [];
    const where = locationLabel(loc);
    if (where) out.push(where + (loc.message ? `: ${loc.message}` : ""));
    if (r.meaning) out.push(`What it means: ${r.meaning}`);
    if (r.why) out.push(`Why it happened: ${r.why}`);
    if (r.fix || r.fixCode) out.push(["How to fix:" + (r.fix ? ` ${r.fix}` : ""), r.fixCode ? `\`\`\`\n${r.fixCode}\n\`\`\`` : ""].filter(Boolean).join("\n"));
    if (r.tip) out.push(`Tip: ${r.tip}`);
    return out.join("\n\n").trim();
  }

  return { MAX_ERROR, MAX_CODE, LANGS, EXAMPLE, detectLanguage, extractLocation, locationLabel, codeContext, buildPrompt, parseExplain, parsedOk, asText };
})();
if (typeof module !== "undefined") module.exports = ErrorHelp;

if (typeof document !== "undefined") (() => {
  const { MAX_ERROR, MAX_CODE, LANGS, EXAMPLE, detectLanguage, extractLocation, locationLabel, codeContext, buildPrompt, parseExplain, parsedOk, asText } = ErrorHelp;
  const SAVE_KEY = "local-ai-error-explain";
  const fmt = (n) => n.toLocaleString("en-US");

  const style = document.createElement("style");
  style.textContent = `
    #err-dialog { width: min(720px, calc(100vw - 32px)); }
    #err-dialog label.err-field { display: block; margin: 14px 0 6px; font-weight: 600; }
    #err-dialog textarea { display: block; width: 100%; margin-top: 6px; resize: vertical; font-weight: 400; line-height: 1.45;
      padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em; }
    #err-dialog textarea.err-error { min-height: 130px; max-height: 40vh; }
    #err-dialog textarea.err-code { min-height: 150px; max-height: 40vh; white-space: pre; overflow-wrap: normal; overflow-x: auto; tab-size: 4; }
    #err-dialog textarea:focus, #err-dialog select:focus { border-color: var(--accent); }
    .err-count { display: block; text-align: right; font-size: 0.8em; font-weight: 400; color: var(--muted); margin-top: 4px; }
    .err-count.err-full { color: var(--accent); font-weight: 600; }
    .err-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-top: 12px; font-size: 0.92em; }
    .err-row label { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
    #err-dialog select { font: inherit; font-weight: 400; font-size: 0.92em; padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--border-strong); background: var(--card); color: var(--text); }
    .err-detected { color: var(--muted); font-size: 0.88em; }
    .err-link { background: none; border: none; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
    .err-link:hover { background: none; color: var(--accent-hover); }
    .err-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .err-coder { margin: 10px 0 0; font-size: 0.88em; color: var(--muted); }
    .err-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0 0; }
    .err-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-weight: 650; font-size: 0.9em;
      background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
    .err-chip.err-soft { background: var(--card); color: var(--muted); border-color: var(--border); font-weight: 500; }
    .err-said { margin: 8px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84em; color: var(--muted);
      overflow-wrap: anywhere; }
    .err-ctx { margin: 10px 0 0; background: var(--code-bg); color: var(--code-text); border-radius: 12px; overflow-x: auto; padding: 8px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84em; line-height: 1.6; }
    #err-dialog .err-ctx-in { display: inline-block; min-width: 100%; }
    .err-ctx-row { display: block; white-space: pre; padding: 0 14px 0 0; border-left: 3px solid transparent; }
    .err-ctx-row.err-hit { background: rgba(229, 103, 90, 0.22); border-left-color: #e5675a; }
    .err-ln { display: inline-block; width: 3.2em; padding-right: 12px; text-align: right; color: #9a988f; user-select: none; }
    .err-hit .err-ln { color: #ffb4aa; font-weight: 700; }
    .err-reading { display: flex; align-items: center; gap: 12px; margin: 20px 0 8px; font-weight: 600; }
    .err-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: err-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes err-spin { to { transform: rotate(360deg); } }
    .err-live { max-height: 180px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.86em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .err-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin: 18px 0 4px; }
    .err-text { margin: 0; line-height: 1.55; overflow-wrap: anywhere; }
    .err-text code, .err-tip code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em;
      background: var(--panel); border: 1px solid var(--border); padding: 1px 5px; border-radius: 5px; }
    .err-fix { position: relative; margin: 8px 0 0; background: var(--code-bg); color: var(--code-text); border-radius: 12px; padding: 34px 14px 12px;
      overflow-x: auto; font-size: 0.86em; line-height: 1.55; border: 1px solid rgba(255, 255, 255, 0.04); }
    .err-fix code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }
    .err-fix .err-copy { position: absolute; top: 6px; right: 8px; font-size: 11px; padding: 2px 9px; color: #d0cec6;
      background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; }
    .err-fix .err-copy:hover { background: rgba(255, 255, 255, 0.14); }
    .err-fix .err-tag { position: absolute; top: 8px; left: 14px; font-size: 11px; color: #9a988f; }
    .err-tip { margin: 18px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft); border-left: 4px solid var(--accent); line-height: 1.5; }
    .err-tip small { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .err-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .err-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .err-grow { flex: 1; }
    #err-dialog button:disabled { opacity: 1; color: inherit; }`;
  document.head.append(style);

  const link = el("button", { id: "err-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "🐞 Explain an error");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "err-dialog", "aria-labelledby": "err-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is answering
  const blank = () => ({ error: "", code: "", lang: "", langPicked: false });
  let state = { draft: blank(), result: null };

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d !== "object") return;
      if (d.draft && typeof d.draft.error === "string") state.draft = { ...blank(), ...d.draft };
      if (d.result && typeof d.result.reply === "string" && typeof d.result.error === "string") state.result = d.result;
    } catch { /* nothing saved yet */ }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "err-title" }, "🐞 Explain an error"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  // `code` in the AI's sentences becomes a <code> element (text only, never HTML).
  const inline = (text) => String(text).split(/`([^`\n]+)`/).map((part, i) => (i % 2 ? el("code", {}, part) : part)).filter((p) => p !== "");

  const coderNote = () => {
    const coder = allModels().find((m) => m.coding && m.installed);
    if (!coder || coder.installed_name === currentModel() || findModel(currentModel())?.coding) return null;
    return el("p", { class: "err-coder" }, `Tip: you have ${coder.label}, a coding model. Pick it in Models for sharper code help.`);
  };

  // Chips for "IndexError · line 4" and the file, the error's own words, and the code around that line.
  function whereParts(loc, code) {
    const label = locationLabel(loc, " · ");
    const rows = codeContext(code, loc.line, 2);
    return [
      label || loc.file ? el("div", { class: "err-chips" },
        label ? el("span", { class: "err-chip" }, label) : null,
        loc.file ? el("span", { class: "err-chip err-soft" }, loc.file) : null) : null,
      loc.message ? el("p", { class: "err-said" }, loc.message) : null,
      rows.length ? el("div", { class: "err-ctx", role: "group", "aria-label": `Your code around line ${loc.line}` },
        el("div", { class: "err-ctx-in" }, ...rows.map((r) => el("span", { class: r.hit ? "err-ctx-row err-hit" : "err-ctx-row" },
          el("span", { class: "err-ln" }, String(r.n)), r.text || " ")))) : null,
    ];
  }

  function drawInput(message) {
    const d = state.draft;
    const errArea = el("textarea", { class: "err-error", maxlength: String(MAX_ERROR), spellcheck: "false",
      placeholder: "Paste the whole error here, e.g. the lines starting with Traceback...", "aria-label": "Error message" });
    errArea.value = d.error.slice(0, MAX_ERROR);
    const codeArea = el("textarea", { class: "err-code", maxlength: String(MAX_CODE), spellcheck: "false", wrap: "off",
      placeholder: "Paste the code that caused it (optional)", "aria-label": "Your code (optional)" });
    codeArea.value = d.code.slice(0, MAX_CODE);
    const errCount = el("span", { class: "err-count", "aria-live": "polite" });
    const codeCount = el("span", { class: "err-count" });
    const select = el("select", { "aria-label": "Language" }, ...Object.entries(LANGS).map(([v, t]) => el("option", { value: v }, t)));
    const detected = el("span", { class: "err-detected" });
    const update = () => {
      d.error = errArea.value;
      d.code = codeArea.value;
      if (!d.langPicked) d.lang = detectLanguage(d.error, d.code);
      select.value = d.lang || "unknown";
      detected.textContent = d.langPicked ? "you picked" : d.error.trim() || d.code.trim() ? "detected" : "";
      errCount.textContent = `${fmt(errArea.value.length)} / ${fmt(MAX_ERROR)}`;
      errCount.classList.toggle("err-full", errArea.value.length >= MAX_ERROR);
      codeCount.textContent = `${fmt(codeArea.value.length)} / ${fmt(MAX_CODE)}`;
      codeCount.classList.toggle("err-full", codeArea.value.length >= MAX_CODE);
      save();
    };
    errArea.addEventListener("input", update);
    codeArea.addEventListener("input", update);
    select.addEventListener("change", () => { d.lang = select.value; d.langPicked = true; update(); });
    update();
    const example = el("button", { type: "button", class: "err-link", onclick: () => {
      errArea.value = EXAMPLE.error; codeArea.value = EXAMPLE.code; d.langPicked = false; update(); errArea.focus();
    } }, "Try an example");
    const go = () => (errArea.value.trim() ? explain() : (drawInput("Paste an error message first."), null));
    setDialog(head(),
      el("p", { class: "note" }, "Paste an error from Python, JavaScript, Java or C++. The AI on this computer explains what it means, why it happened and the small change that fixes it."),
      el("label", { class: "err-field" }, "Error message", errArea, errCount),
      el("label", { class: "err-field" }, "Your code (optional)", codeArea, codeCount),
      el("div", { class: "err-row" }, el("label", {}, "Language", select), detected, el("span", { class: "err-grow" }), example),
      coderNote(),
      message ? el("p", { class: "err-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Explain it")));
    errArea.focus();
  }

  function drawReading(loc, code, live) {
    setDialog(head(),
      ...whereParts(loc, code),
      el("div", { class: "err-reading" }, el("span", { class: "err-spin", "aria-hidden": "true" }), "Reading the error…"),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  function drawResult(data) {
    const loc = extractLocation(data.error, data.lang);
    const r = parseExplain(data.reply);
    const ok = parsedOk(r);
    const plain = ok ? asText(r, loc) : data.reply.trim();
    const section = (title, text) => (text ? [el("span", { class: "err-sec" }, title), el("p", { class: "err-text" }, ...inline(text))] : []);
    const fixBlock = ok && r.fixCode ? el("pre", { class: "err-fix" },
      el("span", { class: "err-tag" }, "Change this"),
      el("button", { class: "err-copy", onclick: (e) => copyText(e.currentTarget, r.fixCode) }, "Copy"),
      el("code", {}, r.fixCode)) : null;
    setDialog(head(),
      ...whereParts(loc, data.code),
      ...(ok ? section("What it means", r.meaning) : []),
      ...(ok ? section("Why it happened", r.why) : []),
      ok && (r.fix || r.fixCode) ? el("span", { class: "err-sec" }, "How to fix") : null,
      ok && r.fix ? el("p", { class: "err-text" }, ...inline(r.fix)) : null,
      fixBlock,
      ok && r.tip ? el("div", { class: "err-tip" }, el("small", {}, "Tip for next time"), ...inline(r.tip)) : null,
      ok ? null : el("p", { class: "err-raw" }, plain || "(no answer)"),
      el("div", { class: "err-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy all"),
        el("button", { onclick: () => followUp(data, loc) }, "💬 Ask a follow-up"),
        el("span", { class: "err-grow" }),
        el("button", { onclick: () => { state.draft = { ...blank(), error: data.error, code: data.code || "", lang: data.lang, langPicked: !!data.langPicked }; save(); drawInput(); } }, "Edit"),
        el("button", { class: "primary", onclick: () => { state = { draft: blank(), result: null }; save(); drawInput(); } }, "New error")));
  }

  function followUp(data, loc) {
    const said = loc.type ? `${loc.type}${loc.message ? `: ${loc.message}` : ""}` : (data.error.split("\n").find((l) => l.trim()) || "").trim().slice(0, 200);
    dialog.close();
    $("new-chat").click();
    inputEl.value = `I got this error: ${said.replace(/[.\s]+$/, "")}. `;
    autoResize();
    inputEl.focus();
  }

  async function explain() {
    const { error, code } = state.draft;
    const lang = state.draft.lang || detectLanguage(error, code);
    const model = currentModel();
    if (!model) return drawInput("Pick an AI model in Models first, then try again.");
    if (findModel(model)?.experimental) return drawInput("TinyGPT is a tiny practice model and can't explain code errors. Pick a real chat model in Models first, then try again.");
    const loc = extractLocation(error, lang);
    busy = new AbortController();
    const live = el("pre", { class: "err-live" }, "Waiting for the AI...");
    drawReading(loc, code, live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(error, code, lang, loc), think: false, auto_code: false }),
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
      state.result = { error, code, lang, langPicked: state.draft.langPicked, reply: reply.trim(), at: Date.now() };
      save();
      if (dialog.open) drawResult(state.result);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press Explain it to try again.");
      else drawInput(`Couldn't explain it: ${err.message}`);
    } finally {
      busy = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    load();
    dialog.showModal();
    if (state.result) drawResult(state.result);
    else drawInput();
  }

  dialog.addEventListener("close", () => busy?.abort());
})();
