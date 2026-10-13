// "Test speed" in the Models window: asks each installed model the same short question and
// shows how fast it writes on this computer, compared with how fast people read.
(() => {
  const RESULTS_KEY = "local-ai-speedtest";
  const PROMPT = "In about 60 words, describe a sunny day at the beach.";
  const READING_SPEED = 4; // words per second; most people read about 240 words a minute

  const style = document.createElement("style");
  style.textContent = `
    .speedtest { margin: 0 0 16px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; }
    .speedtest .head { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .speedtest .head p { margin: 0; }
    .speedtest table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9em; }
    .speedtest td { padding: 6px 4px; border-top: 1px solid var(--border); vertical-align: middle; }
    .speedtest td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .speedtest .rating { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.85em; white-space: nowrap; }
    .speedtest .rating.fast { background: #dcefe0; color: #24613a; }
    .speedtest .rating.good { background: var(--accent-soft); color: var(--accent-hover); }
    .speedtest .rating.slow { background: #f6e0dc; color: #8a2f22; }
    @media (prefers-color-scheme: dark) { .speedtest .rating.fast { background: #1f3a28; color: #9fd8ae; } .speedtest .rating.slow { background: #43231e; color: #f0a99c; } }`;
  document.head.append(style);

  let stopper = null;
  const box = el("div", { class: "speedtest" });
  $("system-card").after(box);

  function saved() {
    try { return JSON.parse(localStorage.getItem(RESULTS_KEY)) || null; } catch { return null; }
  }

  function rating(wps) {
    if (wps >= READING_SPEED * 2) return ["fast", "Fast", "about twice as fast as you can read"];
    if (wps >= READING_SPEED) return ["good", "Good", "about as fast as you can read"];
    return ["slow", "Slow", "slower than you read; a smaller model will feel quicker"];
  }

  function render(results, running) {
    const button = running
      ? el("button", { onclick: () => stopper?.abort() }, "■ Stop")
      : el("button", { class: "primary", onclick: runTest, disabled: !testable().length }, "⏱ Test speed");
    const intro = results?.rows.length
      ? `Tested ${new Date(results.when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. People read about ${READING_SPEED} words a second.`
      : "How fast does each model write on this computer? The test asks each installed model the same short question.";
    box.replaceChildren(el("div", { class: "head" }, el("p", { class: "note" }, intro), button));
    if (!results?.rows.length) return;
    const table = el("table");
    for (const r of results.rows) {
      const [cls, word, why] = r.error ? [] : rating(r.wps);
      table.append(el("tr", {},
        el("td", {}, r.label),
        r.error ? el("td", { colspan: 3, class: "note" }, r.error) : el("td", { class: "num" }, `${r.wps.toFixed(1)} words/s`),
        r.error ? null : el("td", { class: "num note", title: "Includes loading the model into memory" }, `first words in ${r.firstWords.toFixed(1)} s`),
        r.error ? null : el("td", {}, el("span", { class: `rating ${cls}`, title: why }, word))));
    }
    box.append(table);
  }

  // Installed models that can chat here, smallest first so the first results come in quickly.
  function testable() {
    if (!modelInfo) return [];
    return allModels()
      .filter((m) => m.installed && modelInfo.models.includes(m.installed_name))
      .sort((a, b) => (a.size_gb || 0) - (b.size_gb || 0));
  }

  async function timeModel(m, signal) {
    const started = performance.now();
    let first = null;
    let text = "";
    let failed = null;
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.installed_name, messages: [{ role: "user", content: PROMPT }], think: false, auto_code: false }),
      signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    await readLines(resp, (ev) => {
      if (ev.type === "error") failed = ev.message;
      if (ev.type === "text") {
        first ??= performance.now();
        text += ev.text;
      }
    });
    if (failed) throw new Error(failed);
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const secs = (performance.now() - (first ?? started)) / 1000;
    if (!words) throw new Error("it didn't answer");
    // One word arrives with the first chunk, so time the rest of them.
    return { wps: words > 1 && secs > 0.05 ? (words - 1) / secs : words, firstWords: ((first ?? started) - started) / 1000 };
  }

  async function runTest() {
    if (controller) return toast("Wait for the answer to finish first.");
    stopper = new AbortController();
    const results = { when: Date.now(), rows: [] };
    render(results, true);
    for (const m of testable()) {
      try {
        results.rows.push({ label: m.label, ...(await timeModel(m, stopper.signal)) });
      } catch (err) {
        if (err.name === "AbortError") break;
        results.rows.push({ label: m.label, error: `Couldn't test: ${err.message}` });
      }
      render(results, true);
    }
    stopper = null;
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(results)); } catch { /* private window: just don't keep them */ }
    render(results, false);
  }

  // Draw it each time the Models window opens, once the installed models are known.
  new MutationObserver(() => { if ($("models-dialog").open && !stopper) render(saved(), false); })
    .observe($("models-dialog"), { attributes: true, attributeFilter: ["open"] });
  render(saved(), false);
})();
