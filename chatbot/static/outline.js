// "🗂️ Outline an essay": a student gives an essay topic, and the AI suggests a thesis and a plan of
// body paragraphs with points to cover. The student still writes every sentence; the outline is a
// starting map they can edit, copy into their document, and come back to later.
(() => {
  const STORE = "local-ai-outline";
  const MAX_POINTS = 5;
  const TYPES = { argument: "Argument", informative: "Informative", narrative: "Story" };
  const ASK = {
    argument: "an argument essay that takes a clear side",
    informative: "an informative essay that explains the topic",
    narrative: "a personal narrative essay that tells a story",
  };

  const style = document.createElement("style");
  style.textContent = `
    #outline-dialog { width: min(660px, 94vw); }
    #outline-dialog form { display: grid; gap: 10px; margin-top: 12px; }
    #outline-dialog label { display: grid; gap: 4px; font-weight: 600; font-size: 0.95em; }
    #outline-dialog input { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--border-strong);
      border-radius: 8px; background: var(--card); color: var(--text); }
    #outline-dialog .plan { margin: 12px 0; display: grid; gap: 8px; max-height: calc(100vh - 290px); overflow-y: auto; }
    #outline-dialog .part { border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; background: var(--card); }
    #outline-dialog .part.thesis { border-color: var(--accent); background: var(--accent-soft); }
    #outline-dialog .part h3 { margin: 0 0 4px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    #outline-dialog .part.thesis h3 { color: var(--accent); }
    #outline-dialog .part p { margin: 0; font-weight: 600; }
    #outline-dialog .part ul { margin: 6px 0 0; padding-left: 20px; }
    #outline-dialog .part li { margin: 2px 0; }
    #outline-dialog [contenteditable]:focus { outline: 2px solid var(--glow); border-radius: 4px; }
    #outline-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    #outline-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const link = el("button", { id: "outline-link", class: "sidebar-link plain", type: "button",
    title: "Let the AI suggest a thesis and paragraph plan for an essay", onclick: () => open() }, "🗂️ Outline an essay");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "outline-dialog", "aria-labelledby": "outline-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let kind = "argument";
  let making = null;

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } };
  const save = (outline) => localStorage.setItem(STORE, JSON.stringify(outline));

  // Read "THESIS: / 1. point / - detail / CONCLUSION:" into { thesis, points: [{ title, details }], conclusion }.
  function parseOutline(text) {
    const out = { thesis: "", points: [], conclusion: "" };
    let current = null;
    for (const raw of text.replace(/\*\*/g, "").split("\n")) {
      const line = raw.trim();
      let m;
      if ((m = line.match(/^#*\s*thesis\s*:\s*(.+)$/i))) {
        out.thesis = m[1].trim();
        current = null;
      } else if ((m = line.match(/^#*\s*conclusion\s*:\s*(.+)$/i))) {
        out.conclusion = m[1].trim();
        current = null;
      } else if ((m = line.match(/^#*\s*(?:body\s*(?:paragraph)?\s*)?(\d+)\s*[.):]\s*(.+)$/i))) {
        if (out.points.length >= MAX_POINTS) { current = null; continue; }
        current = { title: m[2].trim(), details: [] };
        out.points.push(current);
      } else if ((m = line.match(/^[-*•]\s+(.+)$/)) && current && current.details.length < 4) {
        current.details.push(m[1].trim());
      }
    }
    return out.thesis && out.points.length ? out : null;
  }

  function asText(o) {
    return [`Topic: ${o.topic}`, "", `Thesis: ${o.thesis}`, "",
      ...o.points.flatMap((p, i) => [`${i + 1}. ${p.title}`, ...p.details.map((d) => `   - ${d}`)]),
      "", `Conclusion: ${o.conclusion}`].join("\n");
  }

  async function makeOutline(topic, type) {
    const model = currentModel();
    if (!model) throw new Error("Pick an AI model in Models first.");
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    const prompt = `A student is writing ${ASK[type]} on this topic: ${topic}\n`
      + "Make an outline to help them plan it. Do not write the essay. Reply in exactly this form and nothing else:\n"
      + "THESIS: one sentence stating the main idea\n1. the first body paragraph's main point\n- a detail or example to include\n"
      + "- another detail\n2. ...\n(3 or 4 body paragraphs, 2 or 3 details each)\nCONCLUSION: one sentence on how to wrap up";
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], think: false, auto_code: false }),
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
    return parseOutline(text);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "outline-title" }, "🗂️ Outline an essay"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawForm(error, topicText = "") {
    const topic = el("input", { required: true, maxlength: 200, placeholder: "e.g. Should school start later in the morning?" });
    topic.value = topicText;
    const types = el("div", { class: "segmented" }, ...Object.entries(TYPES).map(([value, label]) =>
      el("button", { type: "button", class: kind === value ? "on" : "", onclick: (e) => {
        kind = value;
        types.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      } }, label)));
    const saved = load();
    setDialog(head(),
      el("p", { class: "note" }, "The AI suggests a thesis and a plan for each paragraph. You write the essay; this is just your map."),
      el("form", { onsubmit: (e) => { e.preventDefault(); create(topic.value.trim()); } },
        el("label", {}, "Essay topic or prompt", topic),
        el("label", {}, "Kind of essay", types),
        error ? el("p", { class: "note", style: "color:var(--danger);margin:0" }, error) : null,
        el("div", { class: "footer" },
          saved ? el("button", { type: "button", onclick: () => drawOutline(saved) }, "Open my last outline") : null,
          el("span", { class: "grow" }), el("button", { class: "primary", type: "submit" }, "Make an outline"))));
    topic.focus();
  }

  // Every line of the outline can be edited in place; edits are saved as the student types.
  function editable(tag, attrs, text, onEdit) {
    const node = el(tag, { ...attrs, contenteditable: "plaintext-only", spellcheck: "true" }, text);
    node.addEventListener("input", () => onEdit(node.textContent.trim()));
    return node;
  }

  function drawOutline(o) {
    const keep = () => save(o);
    const copy = el("button", { class: "primary" }, "Copy outline");
    copy.addEventListener("click", () => copyText(copy, asText(o)));
    setDialog(head(),
      el("p", { style: "margin:10px 0 0;font-weight:600" }, o.topic, el("span", { class: "note" }, ` · ${TYPES[o.kind] || ""} essay`)),
      el("div", { class: "plan" },
        el("div", { class: "part thesis" }, el("h3", {}, "Thesis"), editable("p", {}, o.thesis, (t) => { o.thesis = t; keep(); })),
        ...o.points.map((p, i) => el("div", { class: "part" }, el("h3", {}, `Body paragraph ${i + 1}`),
          editable("p", {}, p.title, (t) => { p.title = t; keep(); }),
          p.details.length ? el("ul", {}, ...p.details.map((d, j) => editable("li", {}, d, (t) => { p.details[j] = t; keep(); }))) : null)),
        o.conclusion ? el("div", { class: "part" }, el("h3", {}, "Conclusion"),
          editable("p", {}, o.conclusion, (t) => { o.conclusion = t; keep(); })) : null),
      el("p", { class: "note" }, "Click any line to change it. Check facts and use your own words when you write."),
      el("div", { class: "footer" },
        el("button", { onclick: () => drawForm(null, o.topic) }, "New outline"),
        el("span", { class: "grow" }), copy));
  }

  async function create(topic) {
    if (!topic) return;
    const type = kind;
    setDialog(head(), el("p", {}, "Planning your essay... This takes a few seconds with a small model, longer with a big one."));
    try {
      const outline = await makeOutline(topic, type);
      if (!outline) return drawForm("The AI didn't write the outline in a form the app can read. Try again, or pick a bigger model.", topic);
      Object.assign(outline, { topic, kind: type });
      save(outline);
      if (dialog.open) drawOutline(outline);
    } catch (err) {
      if (err.name !== "AbortError") drawForm(`Couldn't make an outline: ${err.message}`, topic);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    dialog.showModal();
    drawForm();
  }

  dialog.addEventListener("close", () => making?.abort());
})();
