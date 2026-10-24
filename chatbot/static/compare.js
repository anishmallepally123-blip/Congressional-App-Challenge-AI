// "⚖️ Compare two things": the student names two topics (mitosis and meiosis, democracy and
// monarchy...) and the AI on this computer lists what only one has, what both share and a
// side-by-side table. The page draws it as a two-circle Venn diagram plus a table.
// The last comparison is kept in this browser so reopening shows it again.

// Pure helpers (no page needed), so test_compare.py can run them with Node.
const LocalAICompare = (() => {
  const MAX_TOPIC = 80;
  const MAX_CONTEXT = 120;
  const MAX_ITEMS = 6; // items per Venn region, counting the "+N more" line

  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const norm = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

  function buildPrompt(a, b, context) {
    a = clean(a, MAX_TOPIC); b = clean(b, MAX_TOPIC); context = clean(context, MAX_CONTEXT);
    const system = "You compare two things for a student. Use simple words and true, well-known facts. Keep every item short (under 8 words). "
      + "Answer in exactly this format and nothing else:\n"
      + "ONLY A:\n- something true of A but not B (3 to 5 items)\n"
      + "ONLY B:\n- something true of B but not A (3 to 5 items)\n"
      + "BOTH:\n- something A and B share (2 to 4 items)\n"
      + "CRITERIA:\n- criterion | what A is like | what B is like (4 to 6 lines)\n"
      + "BOTTOM LINE: one sentence on the most important difference";
    const user = `Compare A and B.\nA = ${a}\nB = ${b}` + (context ? `\nClass or context: ${context}` : "");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  const BULLET = /^(?:[-*•‣–]|\d{1,2}[.)])\s+/;
  const HEADS = [
    ["both", /^(?:both(?:\s+a\s+and\s+b)?|in\s+common|shared|similarities)\s*(?::|[-–]\s|$)\s*(.*)$/i],
    ["criteria", /^(?:criteria|side\s*by\s*side|comparison(?:\s+table)?|table)\s*(?::|[-–]\s|$)\s*(.*)$/i],
    ["bottom", /^(?:bottom\s*line|summary|key\s+difference|in\s+short)\s*(?::|[-–]\s|$)\s*(.*)$/i],
  ];
  const ONLY = /^only\s+(?:in\s+|for\s+)?(.{1,80}?)\s*(?::|\s[-–]\s|$)\s*(.*)$/i;

  // Which section a line starts (and any text after its colon), or null for an ordinary line.
  function heading(line, wasBullet, a, b, seen) {
    const m = line.match(ONLY);
    if (m) {
      const key = norm(m[1]);
      if (key === "a" || (a && key === norm(a))) return ["onlyA", m[2]];
      if (key === "b" || (b && key === norm(b))) return ["onlyB", m[2]];
      if (!wasBullet && /:\s*$/.test(line)) return [seen.has("onlyA") ? "onlyB" : "onlyA", ""];
    }
    if (wasBullet) return null;
    for (const [name, re] of HEADS) { const h = line.match(re); if (h) return [name, h[1]]; }
    return null;
  }

  const unwrap = (s) => s.replace(/^["'*_\s]+|["'*_\s]+$/g, "").trim();

  function parseRow(item, a, b) {
    let cells = item.replace(/^\|/, "").replace(/\|$/, "").split("|").map(unwrap);
    if (cells.length === 2 && cells[0].includes(":")) {
      const i = cells[0].indexOf(":");
      cells = [cells[0].slice(0, i), cells[0].slice(i + 1), cells[1]].map(unwrap);
    }
    if (cells.length < 3 || cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) return null;
    const [criterion, va, vb] = cells;
    if (/^(?:criteria|criterion|feature|category)$/i.test(criterion) && (norm(va) === "a" || norm(va) === norm(a) || norm(vb) === norm(b))) return null;
    if (!criterion) return null;
    return { criterion, a: va, b: vb };
  }

  function parseComparison(text, a, b) {
    const out = { onlyA: [], both: [], onlyB: [], criteria: [], bottomLine: "" };
    const seen = new Set();
    let section = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s*/, "").trim();
      if (!line) continue;
      const wasBullet = BULLET.test(line);
      const bare = line.replace(BULLET, "");
      const head = /\|/.test(bare) ? null : heading(bare, wasBullet, a, b, seen);
      if (head) {
        section = head[0];
        seen.add(section);
        line = head[1].trim();
        if (!line) continue;
      }
      const item = unwrap(line.replace(BULLET, ""));
      if (!item || /^(?:none|n\/a|nothing)\.?$/i.test(item)) continue;
      if (section === "onlyA" || section === "onlyB" || section === "both") out[section].push(item);
      else if (section === "criteria") { const row = parseRow(item, a, b); if (row) out.criteria.push(row); }
      else if (section === "bottom") out.bottomLine = out.bottomLine ? `${out.bottomLine} ${item}` : item;
    }
    return out;
  }

  const parsedOk = (c) => !!(c && (c.onlyA.length + c.onlyB.length + c.both.length + c.criteria.length));

  // Cut text to n characters, ending with "…" when something was cut.
  function truncate(text, n) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    return s.slice(0, Math.max(1, n - 1)).replace(/[\s,.;:]+$/, "") + "…";
  }

  // Up to MAX_ITEMS items per region; when there are more, the last line says "+N more".
  function fitItems(items, max = MAX_ITEMS) {
    if (items.length <= max) return { shown: items.slice(), more: 0 };
    return { shown: items.slice(0, max - 1), more: items.length - (max - 1) };
  }

  // Break text into at most maxLines lines of up to n characters; the last one ends in "…" if cut.
  function wrapLines(text, n, maxLines = 2) {
    const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const lines = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= n) cur += ` ${w}`;
      else { lines.push(cur); cur = w; }
      if (lines.length === maxLines) return [...lines.slice(0, -1), truncate(`${lines.at(-1)} ${words.slice(i).join(" ")}`, n)];
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), truncate(lines.slice(maxLines - 1).join(" "), n)];
    return lines.map((l) => truncate(l, n));
  }

  // Where everything goes in the drawing (400 wide, or narrower for phones, so the text stays
  // big enough to read). Items wrap to two lines while a region has room. The page draws it as SVG.
  const MAX_LINES = 8; // text lines per region, counting "+N more"
  function vennLayout(c, a, b, width = 400) {
    const k = Math.min(1, Math.max(0.8, width / 400));
    const W = Math.round(400 * k), H = Math.round(300 * k), R = 125 * k, CY = 165 * k, LINE = 14, GAP = 4;
    const circles = [{ id: "a", cx: 135 * k, cy: CY, r: R }, { id: "b", cx: 265 * k, cy: CY, r: R }];
    const titleChars = Math.round(22 * k);
    const titles = [
      { id: "a", x: 135 * k, y: 26, text: truncate(a, titleChars), full: clean(a, MAX_TOPIC) },
      { id: "b", x: 265 * k, y: 26, text: truncate(b, titleChars), full: clean(b, MAX_TOPIC) },
    ];
    const items = [];
    for (const [region, x, base] of [["onlyA", 75, 17], ["both", 200, 15], ["onlyB", 325, 17]]) {
      const chars = Math.round(base * k);
      const { shown, more } = fitItems(c[region]);
      const groups = shown.map((t) => wrapLines(t, chars, 2));
      const budget = MAX_LINES - (more ? 1 : 0);
      for (let i = groups.length - 1; i >= 0 && groups.flat().length > budget; i--) {
        if (groups[i].length > 1) groups[i] = [truncate(shown[i], chars)];
      }
      const blocks = groups.map((g, i) => ({ lines: g, full: shown[i], more: false }));
      if (more) blocks.push({ lines: [`+${more} more`], full: c[region].slice(shown.length).join("; "), more: true });
      const total = blocks.reduce((sum, bl) => sum + bl.lines.length * LINE, 0) + GAP * (blocks.length - 1);
      let y = CY - total / 2 + LINE / 2;
      blocks.forEach((bl, item) => {
        for (const text of bl.lines) { items.push({ region, item, x: Math.round(x * k), y: Math.round(y + 4), text, full: bl.full, more: bl.more }); y += LINE; }
        y += GAP;
      });
    }
    return { width: W, height: H, circles, titles, items };
  }

  function toPlainText(c, a, b, context) {
    a = clean(a, MAX_TOPIC); b = clean(b, MAX_TOPIC);
    const lines = [`${a} vs. ${b}` + (context ? ` (${clean(context, MAX_CONTEXT)})` : "")];
    const list = (title, items) => { if (items.length) lines.push("", `${title}:`, ...items.map((t) => `- ${t}`)); };
    list(`Only ${a}`, c.onlyA);
    list("Both", c.both);
    list(`Only ${b}`, c.onlyB);
    if (c.criteria.length) lines.push("", "Side by side:", ...c.criteria.map((r) => `- ${r.criterion}: ${a}: ${r.a || "?"}; ${b}: ${r.b || "?"}`));
    if (c.bottomLine) lines.push("", `Bottom line: ${c.bottomLine}`);
    return lines.join("\n");
  }

  return { MAX_TOPIC, MAX_CONTEXT, MAX_ITEMS, buildPrompt, parseComparison, parsedOk, truncate, fitItems, wrapLines, vennLayout, toPlainText };
})();
if (typeof window !== "undefined") window.LocalAICompare = LocalAICompare;
if (typeof module !== "undefined") module.exports = LocalAICompare;

if (typeof document !== "undefined") (() => {
  const { MAX_TOPIC, MAX_CONTEXT, buildPrompt, parseComparison, parsedOk, vennLayout, toPlainText } = LocalAICompare;
  const SAVE_KEY = "local-ai-compare";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const EXAMPLES = [["Mitosis", "Meiosis", "Biology"], ["Democracy", "Monarchy", "Civics"], ["Weather", "Climate", "Earth science"]];

  const style = document.createElement("style");
  style.textContent = `
    #compare-dialog { width: min(720px, calc(100vw - 32px)); }
    .cmp-pair { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: end; margin-top: 14px; }
    .cmp-vs { font-weight: 700; color: var(--muted); padding-bottom: 10px; }
    .cmp-field { display: block; font-weight: 600; min-width: 0; }
    .cmp-field.cmp-wide { margin-top: 12px; }
    .cmp-field small { font-weight: 400; color: var(--muted); }
    .cmp-field input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400;
      padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; }
    .cmp-field input:focus { border-color: var(--accent); }
    .cmp-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font-size: 0.85em; color: var(--muted); }
    .cmp-examples button { font-size: 0.95em; padding: 4px 10px; border-radius: 999px; }
    .cmp-msg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; }
    .cmp-working { display: flex; align-items: center; gap: 12px; margin: 22px 0 8px; font-weight: 600; }
    .cmp-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: cmp-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes cmp-spin { to { transform: rotate(360deg); } }
    .cmp-live { max-height: 200px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88em;
      color: var(--muted); padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; margin: 0; }
    .cmp-heading { margin: 6px 0 2px; font-size: 1.15em; overflow-wrap: anywhere; }
    .cmp-context { margin: 0; font-size: 0.85em; color: var(--muted); }
    .cmp-venn { display: block; width: 100%; max-width: 560px; height: auto; margin: 10px auto 0; }
    .cmp-venn circle { stroke-width: 2; }
    .cmp-venn .cmp-a { fill: var(--accent); fill-opacity: 0.13; stroke: var(--accent); }
    .cmp-venn .cmp-b { fill: #3a86c8; fill-opacity: 0.13; stroke: #3a86c8; }
    .cmp-venn text { fill: var(--text); font-size: 11px; text-anchor: middle; font-family: inherit; }
    .cmp-venn.cmp-compact text { font-size: 12px; }
    .cmp-venn text.cmp-title, .cmp-venn.cmp-compact text.cmp-title { font-size: 14px; font-weight: 700; }
    .cmp-venn text.cmp-title-a { fill: var(--accent); }
    .cmp-venn text.cmp-title-b { fill: #3a86c8; }
    .cmp-venn text.cmp-more { fill: var(--muted); font-style: italic; }
    .cmp-venn text.cmp-empty { fill: var(--muted); }
    .cmp-sec { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--accent); margin: 18px 0 6px; }
    .cmp-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
    .cmp-table { width: 100%; border-collapse: collapse; font-size: 0.92em; line-height: 1.4; }
    .cmp-table th, .cmp-table td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--border); overflow-wrap: break-word; }
    .cmp-table tr:last-child td { border-bottom: none; }
    .cmp-table thead th { background: var(--accent-soft); font-size: 0.85em; }
    .cmp-table tbody th { font-weight: 600; width: 28%; }
    .cmp-bottom { margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--accent-soft);
      border-left: 4px solid var(--accent); line-height: 1.5; overflow-wrap: anywhere; }
    .cmp-bottom small { display: block; font-size: 0.75em; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
    .cmp-raw { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 14px 0 0; }
    .cmp-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
    .cmp-buttons .cmp-grow { flex: 1; }
    #compare-dialog button:disabled { opacity: 1; color: inherit; }
    @media (max-width: 520px) {
      .cmp-pair { grid-template-columns: 1fr; gap: 6px; }
      .cmp-vs { padding: 0; text-align: center; }
      .cmp-table { font-size: 0.85em; }
      .cmp-table th, .cmp-table td { padding: 7px 8px; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "compare-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "⚖️ Compare two things");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "compare-dialog", "aria-labelledby": "compare-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is comparing
  let draft = { a: "", b: "", context: "" };

  const save = (data) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && typeof d.reply === "string" && d.a && d.b ? d : null; } catch { return null; } };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "compare-title" }, "⚖️ Compare two things"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawInput(message) {
    const input = (key, max, placeholder) => {
      const i = el("input", { type: "text", maxlength: String(max), placeholder, autocomplete: "off" });
      i.value = draft[key];
      i.addEventListener("input", () => { draft[key] = i.value; });
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      return i;
    };
    const inA = input("a", MAX_TOPIC, "e.g. Mitosis");
    const inB = input("b", MAX_TOPIC, "e.g. Meiosis");
    const inC = input("context", MAX_CONTEXT, "e.g. Biology, World History");
    const go = () => {
      const a = inA.value.trim(), b = inB.value.trim();
      if (!a || !b) return drawInput("Type two things to compare first.");
      if (a.toLowerCase() === b.toLowerCase()) return drawInput("Those are the same thing. Pick two different ones.");
      compare(a, b, inC.value.trim());
    };
    const examples = el("div", { class: "cmp-examples" }, "Try:",
      ...EXAMPLES.map(([a, b, c]) => el("button", { type: "button", onclick: () => { draft = { a, b, context: c }; drawInput(); } }, `${a} vs. ${b}`)));
    setDialog(head(),
      el("p", { class: "note" }, "Name two things from class. The AI on this computer shows what's only true of each, what they share, and a side-by-side table."),
      el("div", { class: "cmp-pair" },
        el("label", { class: "cmp-field" }, "First thing", inA),
        el("span", { class: "cmp-vs", "aria-hidden": "true" }, "vs."),
        el("label", { class: "cmp-field" }, "Second thing", inB)),
      el("label", { class: "cmp-field cmp-wide" }, "Class or context ", el("small", {}, "(optional)"), inC),
      examples,
      message ? el("p", { class: "cmp-msg", role: "alert" }, message) : null,
      el("div", { class: "dialog-buttons" }, el("button", { class: "primary", onclick: go }, "Compare")));
    (inA.value ? (inB.value ? inC : inB) : inA).focus();
  }

  function drawWorking(live) {
    setDialog(head(),
      el("div", { class: "cmp-working" }, el("span", { class: "cmp-spin", "aria-hidden": "true" }), "Comparing…"),
      el("p", { class: "note" }, "A small model takes a few seconds; a big one can take a minute."),
      live,
      el("div", { class: "dialog-buttons" }, el("button", { onclick: () => busy?.abort() }, "■ Stop")));
  }

  const svg = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  function drawVenn(c, a, b) {
    const L = vennLayout(c, a, b, dialog.clientWidth && dialog.clientWidth < 520 ? 320 : 400);
    const root = svg("svg", { class: L.width < 400 ? "cmp-venn cmp-compact" : "cmp-venn", viewBox: `0 0 ${L.width} ${L.height}`, role: "img",
      "aria-label": `Venn diagram: ${c.onlyA.length} things only ${a}, ${c.both.length} shared, ${c.onlyB.length} only ${b}` });
    for (const ci of L.circles) root.append(svg("circle", { cx: ci.cx, cy: ci.cy, r: ci.r, class: `cmp-${ci.id}` }));
    for (const t of L.titles) {
      const n = svg("text", { x: t.x, y: t.y, class: `cmp-title cmp-title-${t.id}` }, t.text);
      if (t.text !== t.full) n.append(svg("title", {}, t.full));
      root.append(n);
    }
    for (const it of L.items) {
      const n = svg("text", { x: it.x, y: it.y, class: it.more ? "cmp-more" : "" }, it.text);
      if (it.text !== it.full) n.append(svg("title", {}, it.full));
      root.append(n);
    }
    const k = L.width / 400;
    for (const [region, x] of [["onlyA", 75], ["both", 200], ["onlyB", 325]]) {
      if (!c[region].length) root.append(svg("text", { x: Math.round(x * k), y: Math.round(165 * k + 4), class: "cmp-empty" }, "—"));
    }
    return root;
  }

  function drawTable(c, a, b) {
    return el("div", { class: "cmp-table-wrap" },
      el("table", { class: "cmp-table" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Criterion"), el("th", { scope: "col" }, a), el("th", { scope: "col" }, b))),
        el("tbody", {}, ...c.criteria.map((r) => el("tr", {}, el("th", { scope: "row" }, r.criterion), el("td", {}, r.a || "—"), el("td", {}, r.b || "—"))))));
  }

  function drawResult(data) {
    const c = parseComparison(data.reply, data.a, data.b);
    const ok = parsedOk(c);
    const plain = ok ? toPlainText(c, data.a, data.b, data.context) : data.reply.trim();
    const venn = ok && (c.onlyA.length || c.onlyB.length || c.both.length);
    setDialog(head(),
      el("h3", { class: "cmp-heading" }, `${data.a} vs. ${data.b}`),
      data.context ? el("p", { class: "cmp-context" }, data.context) : null,
      venn ? drawVenn(c, data.a, data.b) : null,
      ok && c.criteria.length ? el("span", { class: "cmp-sec" }, "Side by side") : null,
      ok && c.criteria.length ? drawTable(c, data.a, data.b) : null,
      ok && c.bottomLine ? el("div", { class: "cmp-bottom" }, el("small", {}, "Bottom line"), c.bottomLine) : null,
      ok ? null : el("p", { class: "cmp-raw" }, plain || "(no answer)"),
      el("div", { class: "cmp-buttons" },
        el("button", { onclick: (e) => copyText(e.currentTarget, plain) }, "📋 Copy as text"),
        el("span", { class: "cmp-grow" }),
        el("button", { onclick: () => { draft = { a: data.a, b: data.b, context: data.context || "" }; drawInput(); } }, "Back"),
        el("button", { class: "primary", onclick: () => { draft = { a: "", b: "", context: data.context || "" }; drawInput(); } }, "New comparison")));
  }

  async function compare(a, b, context) {
    const model = currentModel();
    if (findModel(model)?.experimental) return drawInput("TinyGPT is a tiny practice model and can't compare things. Pick a real chat model in Models first, then try again.");
    busy = new AbortController();
    const live = el("pre", { class: "cmp-live" }, "Waiting for the AI...");
    drawWorking(live);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: buildPrompt(a, b, context), think: false, auto_code: false }),
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
      const data = { a, b, context, reply: reply.trim(), at: Date.now() };
      save(data);
      if (dialog.open) drawResult(data);
    } catch (err) {
      if (!dialog.open) return;
      if (err.name === "AbortError") drawInput("Stopped. Press Compare to try again.");
      else drawInput(`Couldn't compare: ${err.message}`);
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
