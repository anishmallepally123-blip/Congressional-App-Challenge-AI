// Personalize page: profile, memory, examples and custom assistants (saved by personal.py).

const $ = (id) => document.getElementById(id);
let data = null;

// Use the theme chosen in the chat's settings.
try {
  const theme = JSON.parse(localStorage.getItem("local-ai-settings") || "{}").theme;
  if (theme && theme !== "auto") document.documentElement.dataset.theme = theme;
} catch {}

async function api(path, body) {
  const resp = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(result.error || `Server error ${resp.status}`);
  return result;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function note(id, text, isError) {
  $(id).className = isError ? "error" : "muted";
  $(id).textContent = text;
}

// Run a change on the server, then redraw with the data it sends back.
async function change(path, body, noteId) {
  try {
    const result = await api(path, body);
    Object.assign(data, result.data);
    render();
    return true;
  } catch (err) {
    if (noteId) note(noteId, err.message, true);
    else alert(err.message);
    return false;
  }
}

function deleteButton(onclick) {
  return el("button", { onclick, title: "Delete" }, "Delete");
}

function render() {
  $("enabled").checked = data.enabled;
  $("remember-commands").checked = data.remember_commands;
  $("ollama-note").hidden = data.ollama !== false;

  const mem = $("memories");
  mem.innerHTML = "";
  if (!data.memories.length) mem.append(el("li", { class: "empty" }, "Nothing saved yet."));
  for (const m of data.memories) {
    mem.append(el("li", {}, el("div", {}, m.text),
      deleteButton(() => change("/api/personal/memory/delete", { id: m.id }))));
  }

  const ex = $("examples");
  ex.innerHTML = "";
  if (!data.examples.length) ex.append(el("li", { class: "empty" }, "No examples yet."));
  for (const e of data.examples) {
    const answer = e.answer.length > 300 ? e.answer.slice(0, 300) + "..." : e.answer;
    ex.append(el("li", {}, el("div", {}, el("div", { class: "q" }, e.prompt), el("div", { class: "a" }, answer)),
      deleteButton(() => change("/api/personal/example/delete", { id: e.id }))));
  }

  const list = $("assistants");
  list.innerHTML = "";
  if (!data.assistants.length) list.append(el("li", { class: "empty" }, "No assistants yet."));
  for (const a of data.assistants) {
    const status = a.installed === false ? " (removed from Ollama; make it again to use it)" : "";
    list.append(el("li", {},
      el("div", {}, el("div", { class: "q" }, `${a.name}${status}`),
        el("div", { class: "a" }, `Built on ${a.base}. ${a.instructions}`)),
      deleteButton(() => {
        if (confirm(`Delete the assistant ${a.name}? The model it was built on stays.`)) {
          change("/api/personal/assistant/delete", { name: a.name });
        }
      })));
  }

  const base = $("a-base");
  const picked = base.value;
  base.innerHTML = "";
  for (const b of data.bases || []) base.append(el("option", { value: b.name }, `${b.label} (${b.name})`));
  if (picked) base.value = picked;
  const canMake = data.ollama !== false && (data.bases || []).length > 0;
  $("a-create").disabled = !canMake;
  if (data.ollama !== false && !(data.bases || []).length) {
    note("assistant-note", "Download a model in the chat first, then build an assistant on it.");
  }
}

// ---------- Forms ----------

$("enabled").addEventListener("change", (e) => change("/api/personal/options", { enabled: e.target.checked }));
$("remember-commands").addEventListener("change", (e) =>
  change("/api/personal/options", { remember_commands: e.target.checked }));

$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const profile = { name: $("p-name").value, about: $("p-about").value, style: $("p-style").value };
  if (await change("/api/personal/profile", { profile }, "profile-note")) note("profile-note", "Saved.");
});

$("memory-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await change("/api/personal/memory/add", { text: $("memory-text").value })) $("memory-text").value = "";
});

$("example-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await change("/api/personal/example/add",
    { prompt: $("ex-prompt").value, answer: $("ex-answer").value }, "example-note");
  if (ok) {
    $("ex-prompt").value = $("ex-answer").value = "";
    note("example-note", "Saved.");
  }
});

const TEMPLATES = {
  "Study tutor": ["study-tutor", "You are a patient tutor for a high school student. Explain ideas step by step with simple examples. After explaining, ask one short question to check they understood."],
  "Quiz me": ["quiz-master", "You quiz the user on whatever topic they name. Ask one question at a time, wait for their answer, say whether it was right and why, then ask the next one. Keep score."],
  "Essay coach": ["essay-coach", "You are an essay coach. Give feedback on structure, clarity and evidence. Never rewrite the whole essay for the user; point out what to improve and show a short example."],
  "Coding buddy": ["coding-buddy", "You help a student learn to code. Explain what each part of the code does, suggest small next steps, and help them find bugs themselves before giving the fix."],
};
for (const [label, [name, text]] of Object.entries(TEMPLATES)) {
  $("templates").append(el("button", { type: "button", onclick: () => {
    $("a-name").value = name;
    $("a-instructions").value = text;
  } }, label));
}

$("assistant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("a-create").disabled = true;
  note("assistant-note", "Making it. This takes a few seconds...");
  const ok = await change("/api/personal/assistant/create", {
    name: $("a-name").value, base: $("a-base").value,
    instructions: $("a-instructions").value, temperature: Number($("a-temp").value),
  }, "assistant-note");
  if (ok) {
    data = await api("/api/personal").catch(() => data);
    render();
    note("assistant-note", `Made ${$("a-name").value.trim().toLowerCase()}. Pick it in the chat's model list.`);
    $("a-name").value = $("a-instructions").value = "";
  }
  $("a-create").disabled = false;
});

$("preview-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("preview");
  try {
    const { system, examples } = await api("/api/personal/preview", { question: $("preview-q").value });
    let text = system || "(Nothing. Add a profile, memory or examples above, or switch \"Use what I taught it\" on.)";
    for (const m of examples) text += `\n\n[example ${m.role === "user" ? "question" : "answer"}]\n${m.content}`;
    out.textContent = text;
  } catch (err) {
    out.textContent = err.message;
  }
  out.hidden = false;
});

$("export").addEventListener("click", (e) => {
  if (!data.examples.length) {
    e.preventDefault();
    note("export-note", "Save some examples first.", true);
  }
});

async function start() {
  try {
    data = await api("/api/personal");
  } catch (err) {
    document.querySelector("main").append(el("p", { class: "error" }, err.message));
    return;
  }
  $("p-name").value = data.profile.name || "";
  $("p-about").value = data.profile.about || "";
  $("p-style").value = data.profile.style || "";
  render();
}

start();
