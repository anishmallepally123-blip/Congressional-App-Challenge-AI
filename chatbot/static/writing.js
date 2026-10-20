// "✍️ Check my writing": paste an essay or paragraph, and the AI fixes its spelling, grammar and
// punctuation. The changes are shown word by word (removed in red, added in green), so a student
// can see and learn from each fix instead of just copying a rewritten essay.
(() => {
  const MAX_CHARS = 4000; // small models have small memories, so long essays are checked a part at a time
  const PROMPT = "Fix the spelling, grammar and punctuation mistakes in the text below. "
    + "Keep the writer's own words, voice and meaning, and change as little as possible. "
    + "Reply with only the corrected text: no title, no notes, no explanation.\n\nThe text:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #writing-dialog { width: min(720px, 94vw); }
    #writing-dialog textarea { width: 100%; box-sizing: border-box; min-height: 180px; max-height: 45vh; resize: vertical;
      font: inherit; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
      background: var(--card); color: var(--text); margin-top: 12px; }
    #writing-dialog .count { color: var(--faint); font-size: 0.85em; }
    #writing-dialog .diff { white-space: pre-wrap; line-height: 1.7; padding: 12px 14px; margin-top: 12px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--card); max-height: 50vh; overflow-y: auto; }
    #writing-dialog del { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); border-radius: 3px; }
    #writing-dialog ins { color: var(--fast); background: color-mix(in srgb, var(--fast) 14%, transparent); border-radius: 3px;
      text-decoration: none; font-weight: 600; }
    #writing-dialog .summary { margin: 12px 0 0; font-weight: 600; }
    #writing-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    #writing-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const link = el("button", { id: "writing-link", class: "sidebar-link plain", type: "button",
    title: "Fix the spelling and grammar in something you wrote", onclick: () => open() }, "✍️ Check my writing");
  ($("organizer-link") || $("personal-link")).after(link);

  const dialog = el("dialog", { id: "writing-dialog", "aria-labelledby": "writing-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let draft = "";
  let making = null;

  // Split into words and the spaces between them, so a diff keeps the writer's line breaks.
  const tokens = (text) => text.split(/(\s+)/).filter(Boolean);

  // Word-by-word difference between two texts, as [kind, text] parts: kind is "same", "del" or "ins".
  function diffWords(before, after) {
    const a = tokens(before);
    const b = tokens(after);
    const n = a.length;
    const m = b.length;
    // lengths[i][j] = longest common run of a[i..] and b[j..]
    const lengths = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    const parts = [];
    const push = (kind, text) => {
      const last = parts[parts.length - 1];
      if (last && last[0] === kind) last[1] += text;
      else parts.push([kind, text]);
    };
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { push("same", a[i]); i++; j++; }
      else if (i < n && (j === m || lengths[i + 1][j] >= lengths[i][j + 1])) push("del", a[i++]);
      else push("ins", b[j++]);
    }
    return parts;
  }

  // How many separate fixes the diff holds: a removed word next to its replacement counts once.
  function countFixes(parts) {
    return parts.filter(([kind], i) => kind !== "same" && parts[i - 1]?.[0] !== (kind === "ins" ? "del" : "ins")).length;
  }

  // Small models sometimes wrap the answer in a lead-in line, quotes or a code block; take those off.
  function cleanReply(text) {
    let out = text.trim().replace(/^```\w*\n([\s\S]*?)\n```$/, "$1").trim();
    out = out.replace(/^(?:here(?:'s| is)[^\n]*|corrected(?: text)?|sure[^\n]*):\s*\n+/i, "").trim();
    if (/^"[\s\S]*"$/.test(out) && !out.slice(1, -1).includes('"')) out = out.slice(1, -1);
    return out;
  }

  async function correct(text) {
    const model = currentModel();
    if (!model) throw new Error("Pick an AI model in Models first.");
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT + text }], think: false, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let out = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") out += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    return cleanReply(out);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "writing-title" }, "✍️ Check my writing"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(error) {
    const box = el("textarea", { placeholder: "Paste or type your essay, email or paragraph here.", maxlength: MAX_CHARS,
      "aria-label": "Your writing" });
    box.value = draft;
    const count = el("span", { class: "count" });
    const check = el("button", { class: "primary", onclick: () => run(box.value) }, "Check it");
    const update = () => {
      draft = box.value;
      count.textContent = `${box.value.length} / ${MAX_CHARS} characters`;
      check.disabled = !box.value.trim();
    };
    box.addEventListener("input", update);
    update();
    setDialog(head(),
      el("p", { class: "note" }, "The AI fixes spelling, grammar and punctuation, and shows you every change. It runs on this computer, so your writing stays private."),
      box,
      error ? el("p", { class: "note", style: "color:var(--danger)" }, error) : null,
      el("div", { class: "footer" }, count, el("span", { class: "grow" }), check));
    box.focus();
  }

  function drawResult(before, after) {
    const parts = diffWords(before, after);
    const fixes = countFixes(parts);
    const copy = el("button", { class: "primary" }, "Copy fixed text");
    copy.addEventListener("click", () => copyText(copy, after));
    setDialog(head(),
      el("p", { class: "summary" }, fixes ? `✅ ${fixes} ${fixes === 1 ? "fix" : "fixes"}. Red was taken out and green was put in.` : "✅ No mistakes found. Nice writing!"),
      el("div", { class: "diff" }, ...parts.map(([kind, text]) => kind === "same" ? text : el(kind, {}, text))),
      el("p", { class: "note" }, "AI can miss mistakes or change things it shouldn't, so read each change before you use it."),
      el("div", { class: "footer" },
        el("button", { onclick: () => drawInput() }, "← Edit my text"),
        el("span", { class: "grow" }),
        copy));
  }

  async function run(text) {
    text = text.trim();
    if (!text) return;
    setDialog(head(), el("p", {}, "Checking your writing... This takes a few seconds with a small model, longer with a big one."));
    try {
      const fixed = await correct(text);
      if (!fixed) throw new Error("the AI sent back an empty answer");
      if (dialog.open) drawResult(text, fixed);
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
