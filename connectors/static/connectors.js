// Connectors page: list, add, turn on/off, and choose which tools need permission.

const $ = (id) => document.getElementById(id);
let presets = [];

async function api(path, body) {
  const resp = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// ---------- Your connectors ----------

const KIND = { builtin: "Built into this app", local: "Program on this computer", remote: "Web address" };
const APPROVAL = { ask: "Ask every time", always: "Always allow", off: "Don't use" };

async function load() {
  const data = await api("/api/connectors").catch((err) => ({ error: err.message }));
  const list = $("list");
  list.innerHTML = "";
  if (data.error) {
    list.append(el("p", { className: "error", textContent: data.error }));
    return;
  }
  presets = data.presets;
  renderPresets(data.connectors);
  if (!data.connectors.length) {
    list.append(el("p", { className: "muted", textContent: "No connectors yet. Add one below." }));
  }
  for (const c of data.connectors) list.append(connectorCard(c));
}

function connectorCard(c) {
  const state = !c.enabled ? "off" : c.error ? "error" : "on";
  const stateText = { off: "Off", error: "Not working", on: `${c.tools.length} tool${c.tools.length === 1 ? "" : "s"}` }[state];

  const toggle = el("input", { type: "checkbox", checked: c.enabled, title: "Turn on or off" });
  toggle.onchange = () => act(() => api("/api/connectors/enable", { name: c.name, enabled: toggle.checked }));

  const head = el("div", { className: "conn-head" },
    el("label", { className: "switch" }, toggle, el("span")),
    el("div", { className: "conn-title" },
      el("strong", { textContent: c.name }),
      el("span", { className: "muted small", textContent: ` · ${KIND[c.kind]}` })),
    el("span", { className: `badge ${state}`, textContent: stateText }));

  const card = el("div", { className: "card connector" }, head);
  if (c.description) card.append(el("p", { className: "muted small", textContent: c.description }));
  if (c.kind !== "builtin") card.append(el("p", { className: "muted small mono", textContent: describe(c.settings) }));
  if (c.error) card.append(el("pre", { className: "error-box", textContent: c.error }));

  if (c.enabled && c.tools.length) {
    const tools = el("details", {}, el("summary", { textContent: "Tools and permissions" }));
    for (const t of c.tools) tools.append(toolRow(c, t));
    card.append(tools);
  }

  if (c.kind !== "builtin") {
    const actions = el("div", { className: "row" });
    const retry = el("button", { textContent: "Reconnect" });
    retry.onclick = () => act(() => api("/api/connectors/reconnect", { name: c.name }));
    const edit = el("button", { textContent: "Edit" });
    edit.onclick = () => fillForm(c.name, c.settings);
    const remove = el("button", { textContent: "Remove" });
    remove.onclick = () => confirm(`Remove ${c.name}?`) && act(() => api("/api/connectors/remove", { name: c.name }));
    actions.append(retry, edit, remove);
    card.append(actions);
  }
  return card;
}

function toolRow(c, t) {
  const select = el("select", { title: "When the AI wants to use this tool" });
  for (const [value, label] of Object.entries(APPROVAL)) select.add(new Option(label, value));
  select.value = t.approval;
  select.onchange = () => act(() => api("/api/connectors/approval", { name: c.name, tool: t.name, approval: select.value }), false);
  const tryBtn = el("button", { type: "button", className: "try-btn", textContent: "Try it" });
  tryBtn.disabled = t.approval === "off";
  tryBtn.title = tryBtn.disabled ? "Turned off. Choose another setting to try it." : "Run this tool yourself, without the AI";
  const row = el("div", { className: "tool-row" },
    el("div", {},
      el("div", { textContent: t.title + (t.read_only ? "  (read only)" : "") }),
      el("div", { className: "muted small", textContent: t.description.split("\n")[0].slice(0, 200) })),
    tryBtn, select);
  const wrap = el("div", {}, row);
  tryBtn.onclick = () => {
    const open = wrap.querySelector(".try-form");
    if (open) open.remove();
    else wrap.append(tryForm(c, t));
  };
  return wrap;
}

// ---------- Trying a tool by hand ----------

// A small form built from the tool's input schema, so people can check a connector
// works (and see what the AI would get back) before asking the AI to use it.
function tryForm(c, t) {
  const props = t.schema.properties || {};
  const required = new Set(t.schema.required || []);
  const form = el("form", { className: "try-form" });
  const inputs = {};
  for (const [name, spec] of Object.entries(props)) {
    const id = `try-${t.key}-${name}`;
    let input;
    if (Array.isArray(spec.enum)) {
      input = el("select", { id });
      if (!required.has(name)) input.add(new Option("(not set)", ""));
      for (const v of spec.enum) input.add(new Option(String(v), JSON.stringify(v)));
    } else if (spec.type === "boolean") {
      input = el("input", { id, type: "checkbox", checked: spec.default === true });
    } else if (spec.type === "number" || spec.type === "integer") {
      input = el("input", { id, type: "number", step: spec.type === "integer" ? "1" : "any" });
      if (spec.default !== undefined) input.value = spec.default;
    } else if (spec.type === "array" || spec.type === "object") {
      input = el("textarea", { id, rows: 2, placeholder: spec.type === "array" ? '["one", "two"]' : '{"key": "value"}' });
    } else {
      input = el("input", { id });
      if (spec.default !== undefined) input.value = spec.default;
    }
    input.required = required.has(name) && spec.type !== "boolean";
    inputs[name] = { input, spec };
    const hint = (spec.description || "").split("\n")[0].slice(0, 160);
    form.append(
      el("label", { htmlFor: id, textContent: name + (required.has(name) ? " *" : "") },
        hint ? el("span", { className: "muted small", textContent: ` ${hint}` }) : null),
      input);
  }
  if (!Object.keys(props).length) form.append(el("p", { className: "muted small", textContent: "This tool needs no input." }));

  const run = el("button", { type: "submit", className: "primary", textContent: "Run" });
  const note = el("span", { className: "muted small" });
  const out = el("pre", { className: "try-result", hidden: true });
  form.append(el("div", { className: "row" }, run, note), out);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const args = {};
    try {
      for (const [name, { input, spec }] of Object.entries(inputs)) {
        if (spec.type === "boolean") args[name] = input.checked;
        else if (input.value === "") continue;
        else if (input.tagName === "SELECT") args[name] = JSON.parse(input.value);
        else if (spec.type === "number" || spec.type === "integer") args[name] = Number(input.value);
        else if (spec.type === "array" || spec.type === "object") args[name] = JSON.parse(input.value);
        else args[name] = input.value;
      }
    } catch {
      note.textContent = "Lists and objects need to be written as JSON, like [\"a\", \"b\"].";
      return;
    }
    if (!t.read_only && !confirm(`Run ${t.title} for real? It may change things in ${c.name}.`)) return;
    run.disabled = true;
    note.textContent = "Running...";
    const started = performance.now();
    try {
      const result = await api("/api/tools/call", { name: t.key, arguments: args, model: localStorage.getItem("local-ai-model") });
      note.textContent = `${result.is_error ? "The tool reported a problem" : "Done"} in ${((performance.now() - started) / 1000).toFixed(1)} s. This is what the AI would see:`;
      out.textContent = result.text || "(no output)";
      out.classList.toggle("bad", result.is_error);
      out.hidden = false;
      if (result.link) note.append(" ", el("a", { href: result.link, textContent: "Open" }));
    } catch (err) {
      note.textContent = err.message;
    } finally {
      run.disabled = false;
    }
  };
  return form;
}

function describe(s) {
  if (s.url) return s.url;
  return [s.command, ...(s.args || [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

async function act(fn, reload = true) {
  try {
    await fn();
  } catch (err) {
    alert(err.message);
  }
  if (reload) load();
}

// ---------- Adding ----------

function renderPresets(existing) {
  const box = $("presets");
  box.innerHTML = "";
  const have = new Set(existing.map((c) => c.name));
  let group = null;
  let grid = null;
  for (const p of presets) {
    if (p.group !== group) {
      group = p.group;
      grid = el("div", { className: "presets" });
      box.append(el("h3", { className: "preset-group", textContent: group }), grid);
    }
    const btn = el("button", { type: "button", className: "preset" + (p.found === false ? " missing" : "") },
      el("strong", { textContent: p.name }),
      el("span", { className: "small", textContent: p.about }),
      el("span", { className: "muted small", textContent: `Needs: ${p.needs}` }));
    btn.disabled = have.has(p.name);
    if (btn.disabled) btn.title = "Already added";
    btn.onclick = () => fillForm(p.name, p.config, p);
    grid.append(btn);
  }
}

function setKind(kind) {
  document.querySelector(`input[name=kind][value=${kind}]`).checked = true;
  document.querySelector(".local-only").hidden = kind !== "local";
  document.querySelector(".remote-only").hidden = kind !== "remote";
}
document.querySelectorAll("input[name=kind]").forEach((r) => (r.onchange = () => setKind(r.value)));

let activePreset = null;

function fillForm(name, cfg, preset = null) {
  activePreset = preset && preset.fields?.length ? preset : null;
  $("name").value = name;
  $("command").value = cfg.command || "";
  $("args").value = (cfg.args || []).join("\n");
  $("env").value = Object.entries(cfg.env || {}).map(([k, v]) => `${k}=${v}`).join("\n");
  $("url").value = cfg.url || "";
  $("token").value = (cfg.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  setKind(cfg.url ? "remote" : "local");
  renderPresetFields(preset, cfg);
  $("add-form").dataset.replace = "";
  $("add-note").className = "muted";
  $("add-note").textContent = activePreset ? "Fill in the boxes above, then press Add and connect." : "Check the details, then press Add and connect.";
  $("add-form").scrollIntoView({ behavior: "smooth" });
  (activePreset ? $("preset-fields").querySelector("input") : $("name")).focus();
}

// A preset's own boxes (a folder, an access key) so nobody has to edit the command.
function renderPresetFields(preset, cfg) {
  const box = $("preset-fields");
  box.innerHTML = "";
  $("preset-setup").textContent = "";
  $("preset-box").hidden = !preset || !(preset.fields?.length || preset.setup);
  $("advanced").open = !activePreset;
  if (!preset) return;
  if (preset.setup) {
    $("preset-setup").append(preset.setup + " ");
    if (preset.help) $("preset-setup").append(el("a", { href: preset.help, target: "_blank", rel: "noopener", textContent: "Open the setup page" }));
  }
  (preset.fields || []).forEach((f, i) => {
    const id = `preset-field-${i}`;
    let value = "";
    if (f.target === "arg") value = (cfg.args || []).at(-1) || "";
    if (f.target === "env") value = (cfg.env || {})[f.key] || "";
    const input = el("input", { id, type: f.secret ? "password" : "text", placeholder: f.placeholder || "", value, autocomplete: "off", spellcheck: false });
    input.dataset.index = i;
    box.append(el("label", { htmlFor: id, textContent: f.label }), input);
  });
}

function applyPresetFields(config) {
  if (!activePreset) return config;
  activePreset.fields.forEach((f, i) => {
    const value = $(`preset-field-${i}`).value.trim();
    if (f.target === "arg") {
      if (!value) throw new Error(`Fill in: ${f.label}`);
      config.args = [...config.args.slice(0, -1), value];
    } else if (f.target === "env") {
      if (!value) throw new Error(`Fill in: ${f.label}`);
      config.env = { ...config.env, [f.key]: value };
    } else if (f.target === "token") {
      if (!value) throw new Error(`Fill in: ${f.label}`);
      config.headers = { Authorization: `Bearer ${value}` };
    }
  });
  return config;
}

function readForm() {
  const kind = document.querySelector("input[name=kind]:checked").value;
  if (kind === "remote") {
    const config = { url: $("url").value.trim() };
    const token = $("token").value.trim();
    if (token) config.headers = { Authorization: `Bearer ${token}` };
    return applyPresetFields(config);
  }
  const env = {};
  for (const line of $("env").value.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return applyPresetFields({
    command: $("command").value.trim(),
    args: $("args").value.split("\n").map((a) => a.trim()).filter(Boolean),
    env,
  });
}

function resetForm() {
  $("add-form").reset();
  activePreset = null;
  renderPresetFields(null, {});
  setKind("local");
}

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const note = $("add-note");
  const btn = $("add-btn");
  btn.disabled = true;
  note.className = "muted";
  note.textContent = activePreset?.connecting || "Connecting... (the first time can take a minute)";
  try {
    const name = $("name").value.trim();
    const res = await api("/api/connectors/add", { name, config: readForm(), replace: true });
    if (res.error) {
      note.className = "error";
      note.textContent = `Saved, but it didn't connect: ${res.error.split("\n")[0]} (Fix it with Edit on its card above.)`;
    } else {
      note.textContent = `${name} is connected.`;
      resetForm();
    }
  } catch (err) {
    note.className = "error";
    note.textContent = err.message;
  }
  btn.disabled = false;
  load();
});

$("import-btn").addEventListener("click", async () => {
  const note = $("import-note");
  note.className = "muted";
  note.textContent = "Connecting...";
  try {
    const res = await api("/api/connectors/import", { text: $("import-text").value });
    const failed = res.added.filter((a) => a.error);
    note.textContent = `Added ${res.added.map((a) => a.name).join(", ")}.` +
      (failed.length ? ` ${failed.length} didn't connect; see the list above.` : "");
    $("import-text").value = "";
  } catch (err) {
    note.className = "error";
    note.textContent = err.message;
  }
  load();
});

load();
