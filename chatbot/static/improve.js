// "✨ Improve" rewrites what you've typed into a clearer, more specific question before you send it,
// so students can see what a good prompt looks like. "Undo" puts back what they wrote.
(function () {
  const ASK = "Rewrite the message below so an AI assistant can give a better answer. " +
    "Keep the same goal, the same language and the writer's point of view. Make it clear and specific: " +
    "say exactly what is wanted, and add the length, level or format only when the message already hints at it. " +
    "Fix spelling and grammar. Don't answer it and don't add facts the writer didn't give. " +
    "Reply with only the rewritten message, with no quotes, title or explanation.\n\nMessage:\n";
  const MIN_WORDS = 3;

  const style = document.createElement("style");
  style.textContent = `
    #improve-prompt.busy { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
    #improve-undo { color: var(--accent); }
    #input.improving { opacity: .75; }
  `;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.id = "improve-prompt";
  button.className = "chip";
  button.title = "Rewrite your message so the AI understands it better";
  button.textContent = "✨ Improve";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.id = "improve-undo";
  undo.className = "chip";
  undo.textContent = "↶ Undo";
  undo.title = "Put back what you wrote";
  undo.hidden = true;

  const row = document.querySelector("#composer .composer-row");
  row.insertBefore(button, row.querySelector(".hint"));
  row.insertBefore(undo, row.querySelector(".hint"));

  let original = null; // what the user wrote before the last rewrite
  let rewritten = null;
  let busy = null; // AbortController while rewriting

  function words(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

  function refresh() {
    const text = inputEl.value;
    if (rewritten !== null && text !== rewritten) { original = rewritten = null; } // they kept typing
    undo.hidden = busy !== null || original === null;
    button.hidden = !busy && words(text) < MIN_WORDS;
  }

  // Clean what the model sends back: no quotes around it, no "Rewritten message:" label.
  function tidy(text) {
    let t = text.trim().replace(/^(here(?:'s| is) )?(the )?(rewritten|improved) (message|prompt|version)\s*:\s*/i, "");
    const pairs = [['"', '"'], ["“", "”"], ["'", "'"]];
    for (const [a, b] of pairs) if (t.length > 1 && t.startsWith(a) && t.endsWith(b)) t = t.slice(1, -1).trim();
    return t;
  }

  function finish() {
    busy = null;
    button.classList.remove("busy");
    button.textContent = "✨ Improve";
    inputEl.readOnly = false;
    inputEl.classList.remove("improving");
    refresh();
    inputEl.focus();
  }

  async function improve() {
    if (busy) { busy.abort(); return; } // a second click stops it
    const draft = inputEl.value;
    const model = currentModel();
    if (!ollamaUp || !modelInfo?.models.includes(model)) return toast("Start Ollama and download a model first.");
    if (findModel(model)?.experimental) return toast("TinyGPT can't rewrite messages. Pick a chat model in Models first.");

    busy = new AbortController();
    button.classList.add("busy");
    button.textContent = "■ Stop";
    inputEl.readOnly = true;
    inputEl.classList.add("improving");
    undo.hidden = true;
    let out = "";
    let failed = null;
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: ASK + draft.trim() }], think: false, auto_code: false }),
        signal: busy.signal,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `error ${resp.status}`);
      }
      await readLines(resp, (ev) => {
        if (ev.type === "text") {
          out += ev.text;
          inputEl.value = tidy(out).replace(/^["“']/, "") || draft;
          autoResize();
        } else if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      const result = tidy(out);
      if (!result) throw new Error("the AI didn't write anything. Try again.");
      inputEl.value = result;
      original = draft;
      rewritten = result;
    } catch (e) {
      inputEl.value = draft;
      if (e.name !== "AbortError") toast("Couldn't improve it: " + e.message);
    }
    autoResize();
    finish();
  }

  button.addEventListener("click", improve);
  undo.addEventListener("click", () => {
    if (original === null) return;
    inputEl.value = original;
    original = rewritten = null;
    autoResize();
    refresh();
    inputEl.focus();
  });
  inputEl.addEventListener("input", refresh);
  // Don't send a half-written rewrite.
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "composer") return;
    if (busy) { e.preventDefault(); e.stopImmediatePropagation(); }
    else setTimeout(refresh, 0);
  }, true);
  refresh();
})();
