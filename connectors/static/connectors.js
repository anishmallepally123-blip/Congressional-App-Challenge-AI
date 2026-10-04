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
  return el("div", { className: "tool-row" },
    el("div", {},
      el("div", { textContent: t.title + (t.read_only ? "  (read only)" : "") }),
      el("div", { className: "muted small", textContent: t.description.split("\n")[0].slice(0, 200) })),
    select);
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
  for (const p of presets) {
    const btn = el("button", { type: "button", className: "preset" },
      el("strong", { textContent: p.name }),
      el("span", { className: "small", textContent: p.about }),
      el("span", { className: "muted small", textContent: `Needs: ${p.needs}` }));
    btn.disabled = have.has(p.name);
    if (btn.disabled) btn.title = "Already added";
    btn.onclick = () => fillForm(p.name, p.config);
    box.append(btn);
  }
}

function setKind(kind) {
  document.querySelector(`input[name=kind][value=${kind}]`).checked = true;
  document.querySelector(".local-only").hidden = kind !== "local";
  document.querySelector(".remote-only").hidden = kind !== "remote";
}
document.querySelectorAll("input[name=kind]").forEach((r) => (r.onchange = () => setKind(r.value)));

function fillForm(name, cfg) {
  $("name").value = name;
  $("command").value = cfg.command || "";
  $("args").value = (cfg.args || []).join("\n");
  $("env").value = Object.entries(cfg.env || {}).map(([k, v]) => `${k}=${v}`).join("\n");
  $("url").value = cfg.url || "";
  $("token").value = (cfg.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  setKind(cfg.url ? "remote" : "local");
  $("add-form").dataset.replace = "";
  $("add-note").textContent = "Check the details, then press Add and connect.";
  $("add-form").scrollIntoView({ behavior: "smooth" });
  $("name").focus();
}

function readForm() {
  const kind = document.querySelector("input[name=kind]:checked").value;
  if (kind === "remote") {
    const config = { url: $("url").value.trim() };
    const token = $("token").value.trim();
    if (token) config.headers = { Authorization: `Bearer ${token}` };
    return config;
  }
  const env = {};
  for (const line of $("env").value.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    command: $("command").value.trim(),
    args: $("args").value.split("\n").map((a) => a.trim()).filter(Boolean),
    env,
  };
}

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const note = $("add-note");
  const btn = $("add-btn");
  btn.disabled = true;
  note.className = "muted";
  note.textContent = "Connecting... (the first time can take a minute while it downloads)";
  try {
    const name = $("name").value.trim();
    const res = await api("/api/connectors/add", { name, config: readForm(), replace: true });
    if (res.error) {
      note.className = "error";
      note.textContent = `Saved, but it didn't connect: ${res.error.split("\n")[0]}`;
    } else {
      note.textContent = `${name} is connected.`;
      $("add-form").reset();
      setKind("local");
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
