// "🧠 Mind map": the AI sums up the current chat as a map of the main idea, its branches and their
// details, drawn right here and saved as a picture for notes or a poster. Seeing how ideas connect
// helps students remember them. The map is saved with the chat, so it opens instantly next time.
(() => {
  const MAX_BRANCHES = 6;
  const MAX_LEAVES = 3;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const PROMPT = "Make a mind map that sums up the conversation below for a student. "
    + `Use the main topic as the center, ${MAX_BRANCHES - 2} to ${MAX_BRANCHES} branches for its main ideas, `
    + `and up to ${MAX_LEAVES} short details under each branch. Every label is 1 to 5 words. `
    + "Write it as an indented list in exactly this form and write nothing else:\n"
    + "- Main topic\n  - Branch\n    - Detail\n    - Detail\n  - Branch\n    - Detail\n\nThe conversation:\n\n";
  const HUES = [14, 205, 140, 275, 42, 330];
  const W = 960;
  const H = 620;

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #mindmap-button { flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #mindmap-dialog { width: min(1000px, 96vw); max-height: 96vh; outline: none; }
    #mindmap-dialog .map { margin: 8px 0 12px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
    #mindmap-dialog .map svg { display: block; width: 100%; height: auto; }
    #mindmap-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; }
    #mindmap-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const button = el("button", { id: "mindmap-button", type: "button", title: "See this chat as a mind map", hidden: true,
    onclick: () => open() }, "🧠 Mind map");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "mindmap-dialog", "aria-labelledby": "mindmap-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let map = null;
  let making = null;

  // Read the indented list into { label, children: [{ label, children: [{ label }] }] }.
  // Tolerates numbering, bold text, tabs and a missing top line (then the chat title is the center).
  function parseMap(text, fallbackTitle) {
    const rows = [];
    for (const raw of text.replace(/\t/g, "  ").split("\n")) {
      const m = raw.match(/^(\s*)(?:[-*•+]|\d+[.)])\s+(.+)$/);
      if (!m) continue;
      const label = m[2].replace(/\*\*|__|`/g, "").replace(/[:.]$/, "").trim().slice(0, 60);
      if (label) rows.push({ depth: m[1].length, label });
    }
    if (!rows.length) return null;
    const levels = [...new Set(rows.map((r) => r.depth))].sort((a, b) => a - b);
    rows.forEach((r) => (r.level = levels.indexOf(r.depth)));
    // One line at the top level is the center; if the AI left it out, the chat title is.
    const single = rows[0].level === 0 && rows.filter((r) => r.level === 0).length === 1;
    const root = { label: single ? rows[0].label : (fallbackTitle || "This chat").slice(0, 60), children: [] };
    const branchLevel = single ? 1 : 0;
    for (const r of single ? rows.slice(1) : rows) {
      if (r.level <= branchLevel) root.children.push({ label: r.label, children: [] });
      else if (root.children.length) root.children[root.children.length - 1].children.push({ label: r.label });
    }
    root.children = root.children.slice(0, MAX_BRANCHES).map((b) => ({ ...b, children: b.children.slice(0, MAX_LEAVES) }));
    return root.children.length >= 2 ? root : null;
  }

  // Break a label into lines of about `width` letters, at most two lines.
  function wrap(label, width) {
    const lines = [""];
    for (const word of label.split(/\s+/)) {
      const line = lines[lines.length - 1];
      if (line && (line + " " + word).length > width) lines.push(word);
      else lines[lines.length - 1] = line ? line + " " + word : word;
    }
    return lines.length > 2 ? [lines[0], lines.slice(1).join(" ").slice(0, width - 1) + "…"] : lines;
  }

  // Colors as plain values (not CSS variables), so a downloaded picture looks the same.
  function palette() {
    const css = getComputedStyle(document.documentElement);
    const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light"
      || document.documentElement.dataset.theme === "dark";
    return { dark, bg: get("--panel", "#f3f1ea"), text: get("--text", "#1c1b19"), accent: get("--accent", "#c2603e") };
  }

  function drawSvg(root) {
    const p = palette();
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("xmlns", ns);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Mind map of ${root.label}`);
    const add = (parent, tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text != null) node.textContent = text;
      parent.append(node);
      return node;
    };
    add(svg, "rect", { width: W, height: H, fill: p.bg });
    const lines = add(svg, "g", { fill: "none", "stroke-width": 2.2, "stroke-linecap": "round" });
    const nodes = add(svg, "g", { "font-family": "system-ui, -apple-system, Segoe UI, sans-serif", "text-anchor": "middle" });

    const box = (x, y, label, opts) => {
      const text = wrap(label, opts.wrap);
      const w = Math.max(...text.map((t) => t.length)) * opts.size * ((opts.weight || 500) >= 600 ? 0.62 : 0.56) + opts.pad * 2;
      const h = text.length * opts.size * 1.25 + opts.pad * 1.3;
      add(nodes, "rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: Math.min(14, h / 2),
        fill: opts.fill, stroke: opts.stroke, "stroke-width": opts.strokeWidth || 1.5 });
      const t = add(nodes, "text", { x, y: y - ((text.length - 1) * opts.size * 1.25) / 2 + opts.size * 0.36,
        "font-size": opts.size, "font-weight": opts.weight || 500, fill: opts.color });
      text.forEach((line, i) => add(t, "tspan", { x, dy: i ? opts.size * 1.25 : 0 }, line));
    };

    const cx = W / 2;
    const cy = H / 2;
    const n = root.children.length;
    root.children.forEach((branch, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n % 2 ? 0 : Math.PI / n);
      const hue = HUES[i % HUES.length];
      const stroke = `hsl(${hue} ${p.dark ? "55% 62%" : "60% 42%"})`;
      const fill = `hsl(${hue} ${p.dark ? "35% 22%" : "70% 93%"})`;
      const bx = cx + Math.cos(angle) * 250;
      const by = cy + Math.sin(angle) * 175;
      add(lines, "path", { d: `M${cx},${cy} Q${(cx + bx) / 2},${cy} ${bx},${by}`, stroke });
      const m = branch.children.length;
      branch.children.forEach((leaf, j) => {
        const spread = Math.min(0.42, Math.PI / n / 1.6);
        const a = angle + (m === 1 ? 0 : (j / (m - 1) - 0.5) * 2 * spread);
        const lx = cx + Math.cos(a) * 410;
        const ly = cy + Math.sin(a) * 262;
        add(lines, "path", { d: `M${bx},${by} L${lx},${ly}`, stroke, "stroke-width": 1.4, "stroke-opacity": 0.7 });
        box(lx, ly, leaf.label, { wrap: 16, size: 12.5, pad: 9, fill: p.bg, stroke, color: p.text, strokeWidth: 1.2, weight: 450 });
      });
      box(bx, by, branch.label, { wrap: 16, size: 14.5, pad: 11, fill, stroke, color: p.text, weight: 600 });
    });
    box(cx, cy, root.label, { wrap: 18, size: 19, pad: 16, fill: p.accent, stroke: p.accent, color: "#ffffff", weight: 700 });
    return svg;
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeMap(chat) {
    const model = currentModel();
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT + transcript(chat) }], think: false, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let text = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") text += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    const result = parseMap(text, chat.title);
    if (!result) throw new Error("the AI didn't write a mind map. Try again, or try a bigger model.");
    return result;
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "mindmap-title" }, "🧠 Mind map"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function draw() {
    const holder = el("div", { class: "map" });
    holder.append(drawSvg(map));
    setDialog(head(), holder,
      el("div", { class: "footer" },
        el("button", { class: "primary", onclick: download }, "⬇ Save picture"),
        el("span", { class: "grow" }),
        el("button", { onclick: () => remake() }, "↻ Make a new map")));
  }

  function drawMessage(text, retry) {
    setDialog(head(), el("p", {}, text),
      retry ? el("button", { class: "primary", onclick: () => remake() }, "Try again") : null);
  }

  // Save the map as a PNG, drawn at twice the size so it stays sharp in notes and slides.
  function download() {
    const svg = new XMLSerializer().serializeToString(drawSvg(map));
    const img = new Image();
    img.onload = () => {
      const canvas = el("canvas", { width: W * 2, height: H * 2 });
      canvas.getContext("2d").drawImage(img, 0, 0, W * 2, H * 2);
      canvas.toBlob((blob) => {
        const a = el("a", { href: URL.createObjectURL(blob),
          download: `${map.label.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "mind map"} mind map.png` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.onerror = () => toast("Couldn't save the picture in this browser.");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  async function remake() {
    const chat = currentChat();
    if (!chat) return;
    drawMessage("Making a mind map of this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      map = await makeMap(chat);
      chat.mindmap = map;
      saveChats();
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make a mind map: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.mindmap) {
      map = chat.mindmap;
      draw();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());

  // Show the button only on chats with an answer to map.
  const update = () => { button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && m.content); };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
