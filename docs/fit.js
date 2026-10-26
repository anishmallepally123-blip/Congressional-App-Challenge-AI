// "Will it run on my computer?": the same model list and memory rules as the app (chatbot/models.py),
// so visitors can see which AI models their computer can run before downloading anything.
// chatbot/test_site_models.py checks that CATALOG and rate() still match the app.

// Copied from chatbot/models.py CATALOG. Keep this on one line: the test reads it as JSON.
const CATALOG = [{"name": "qwen3:0.6b", "label": "Qwen 3 Micro", "size_gb": 0.5, "need_gb": 1.5, "tools": true}, {"name": "qwen3:1.7b", "label": "Qwen 3 Tiny", "size_gb": 1.4, "need_gb": 2.5, "tools": true}, {"name": "qwen3:4b", "label": "Qwen 3 Small", "size_gb": 2.5, "need_gb": 4, "tools": true}, {"name": "qwen3:8b", "label": "Qwen 3 Medium", "size_gb": 5.2, "need_gb": 7, "tools": true}, {"name": "qwen3:14b", "label": "Qwen 3 Large", "size_gb": 9.3, "need_gb": 12, "tools": true}, {"name": "qwen3:30b", "label": "Qwen 3 Extra Large", "size_gb": 19, "need_gb": 22, "tools": true}, {"name": "llama3.3:70b", "label": "Llama 3.3 Huge", "size_gb": 43, "need_gb": 48, "tools": true}, {"name": "gemma3:1b", "label": "Gemma 3 Mini", "size_gb": 0.8, "need_gb": 1.5, "tools": false}, {"name": "gemma3:4b", "label": "Gemma 3 Small", "size_gb": 3.3, "need_gb": 5, "tools": false}, {"name": "gemma3:12b", "label": "Gemma 3 Medium", "size_gb": 8.1, "need_gb": 11, "tools": false}, {"name": "gemma3:27b", "label": "Gemma 3 Large", "size_gb": 17, "need_gb": 20, "tools": false}, {"name": "qwen2.5-coder:1.5b", "label": "Qwen Coder Tiny", "size_gb": 1.0, "need_gb": 2, "tools": true, "coding": true}, {"name": "qwen2.5-coder:3b", "label": "Qwen Coder Small", "size_gb": 1.9, "need_gb": 3, "tools": true, "coding": true}, {"name": "qwen2.5-coder:7b", "label": "Qwen Coder Medium", "size_gb": 4.7, "need_gb": 6.5, "tools": true, "coding": true}, {"name": "qwen2.5-coder:14b", "label": "Qwen Coder Large", "size_gb": 9.0, "need_gb": 11.5, "tools": true, "coding": true}, {"name": "qwen2.5-coder:32b", "label": "Qwen Coder Extra Large", "size_gb": 20, "need_gb": 23, "tools": true, "coding": true}];
const OS_RESERVE_GB = 2.5; // memory left for the operating system and browser (less on small computers)

// How well a computer runs a model that needs `need` GB. Same rules as rate() in chatbot/models.py.
function rate(need, hw) {
  const ram = hw.ram_gb;
  if (hw.unified_memory && need <= ram * 0.7) return "fast";
  if (hw.vram_gb >= need) return "fast";
  if (need <= ram - Math.min(OS_RESERVE_GB, ram * 0.35)) return need <= ram * 0.5 ? "good" : "slow";
  return "blocked";
}

// The best model this computer runs comfortably. Same rules as recommend() in chatbot/models.py.
function recommend(hw, coding = false) {
  const pool = CATALOG.filter((m) => m.tools && Boolean(m.coding) === coding);
  const comfy = pool.filter((m) => ["fast", "good"].includes(rate(m.need_gb, hw)));
  if (comfy.length) return comfy.reduce((a, b) => (b.need_gb > a.need_gb ? b : a));
  return pool.find((m) => rate(m.need_gb, hw) !== "blocked") || null;
}

if (typeof document !== "undefined") (() => {
  const box = document.getElementById("fit");
  if (!box) return;
  const LABELS = { fast: "⚡ Fast", good: "✓ Runs well", slow: "🐢 Slow", blocked: "✕ Too big" };
  const RAM = [8, 16, 24, 32, 64];
  const VRAM = [0, 4, 6, 8, 12, 16, 24];
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const state = { ram: 16, kind: isMac ? "mac" : "pc", vram: 0 };
  // Browsers only report memory up to 8 GB, so this is a starting guess the visitor can change.
  if (navigator.deviceMemory && navigator.deviceMemory < 8) state.ram = 8;

  const style = document.createElement("style");
  style.textContent = `
    .fit { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 860px) { .fit { grid-template-columns: 300px minmax(0, 1fr); align-items: start; } }
    .fit .panel { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow-sm); }
    .fit fieldset { border: 0; padding: 0; margin: 0 0 16px; }
    .fit legend { font-weight: 600; font-size: 0.92rem; margin-bottom: 8px; }
    .fit .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .fit .chips button, .fit select { font: inherit; font-size: 0.9rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--card); color: var(--text); cursor: pointer; }
    .fit select { border-radius: 10px; width: 100%; }
    .fit .chips button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
    .fit .hint { color: var(--muted); font-size: 0.85rem; margin: 6px 0 0; }
    .fit .pick { background: var(--accent-soft); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
    .fit .pick b { color: var(--accent); }
    .fit table { width: 100%; border-collapse: collapse; font-size: 0.93rem; }
    .fit th { text-align: left; font-weight: 600; color: var(--muted); font-size: 0.8rem; padding: 0 8px 6px; }
    .fit td { padding: 8px; border-top: 1px solid var(--border); }
    .fit td.size { color: var(--muted); white-space: nowrap; }
    .fit .badge { display: inline-block; white-space: nowrap; font-size: 0.8rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; }
    .fit .badge.fast { background: #dcefe0; color: #1d6b34; }
    .fit .badge.good { background: #e3edf8; color: #24548a; }
    .fit .badge.slow { background: var(--warn-bg); color: var(--warn-text); }
    .fit .badge.blocked { background: var(--panel); color: var(--faint); }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .fit .badge.fast { background: #1f3a27; color: #9fdcae; }
      :root:not([data-theme="light"]) .fit .badge.good { background: #1f2f44; color: #a9c8ef; }
    }
    :root[data-theme="dark"] .fit .badge.fast { background: #1f3a27; color: #9fdcae; }
    :root[data-theme="dark"] .fit .badge.good { background: #1f2f44; color: #a9c8ef; }
    .fit tr.blocked td:first-child { color: var(--faint); }`;
  document.head.append(style);

  const h = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...kids.filter((k) => k != null));
    return node;
  };
  const chips = (options, current, label, pick) => h("div", { class: "chips", role: "group", "aria-label": label },
    ...options.map(([value, text]) => h("button", { type: "button", "aria-pressed": String(value === current),
      onclick: () => { pick(value); draw(); } }, text)));

  function draw() {
    const hw = { ram_gb: state.ram, unified_memory: state.kind === "mac", vram_gb: state.kind === "pc" ? state.vram : 0 };
    const best = recommend(hw);
    const coder = recommend(hw, true);
    const chat = CATALOG.filter((m) => !m.coding).sort((a, b) => a.need_gb - b.need_gb);
    const runs = chat.filter((m) => rate(m.need_gb, hw) !== "blocked").length;

    const controls = h("div", { class: "panel" },
      h("fieldset", {}, h("legend", {}, "Memory (RAM)"),
        chips(RAM.map((g) => [g, `${g} GB`]), state.ram, "Memory", (v) => { state.ram = v; }),
        h("p", { class: "hint" }, isMac ? "Apple menu → About This Mac shows it." : "Settings → System → About shows it as \"Installed RAM\".")),
      h("fieldset", {}, h("legend", {}, "Computer"),
        chips([["pc", "Windows or Linux"], ["mac", "Mac with Apple chip"]], state.kind, "Computer", (v) => { state.kind = v; })),
      state.kind === "pc" ? h("fieldset", {}, h("legend", {}, h("label", { for: "fit-vram" }, "Graphics card memory")),
        (() => {
          const select = h("select", { id: "fit-vram", onchange: (e) => { state.vram = Number(e.target.value); draw(); } },
            ...VRAM.map((g) => h("option", { value: g }, g ? `${g} GB (NVIDIA or AMD)` : "None or not sure")));
          select.value = String(state.vram);
          return select;
        })()) : null);

    const results = h("div", { class: "panel", "aria-live": "polite" },
      h("div", { class: "pick" }, best
        ? h("span", {}, "The app would start you on ", h("b", {}, best.label), ` (a ${best.size_gb} GB download). `,
          `${runs} of ${chat.length} chat models run on this computer`, coder ? `, and ${coder.label} for coding.` : ".")
        : h("span", {}, "This computer is too small for the chat models. Try the browser demo instead.")),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Model"), h("th", {}, "Download"), h("th", {}, "On this computer"))),
        h("tbody", {}, ...chat.map((m) => {
          const speed = rate(m.need_gb, hw);
          return h("tr", { class: speed }, h("td", {}, m.label), h("td", { class: "size" }, `${m.size_gb} GB`),
            h("td", {}, h("span", { class: `badge ${speed}` }, LABELS[speed])));
        }))));
    box.replaceChildren(h("div", { class: "fit" }, controls, results));
  }
  draw();
})();

if (typeof module !== "undefined") module.exports = { CATALOG, rate, recommend };
