// Chat page logic: setup guide, model picker, conversations, streaming replies,
// and saving history and settings in the browser.

const STORAGE_KEY = "local-ai-chats";
const MODEL_KEY = "local-ai-model"; // shared with the organizer page
const SETTINGS_KEY = "local-ai-settings";
const MODEL_SETTINGS_KEY = "local-ai-model-settings";
const MODEL_DEFAULTS = { temperature: 0.7, num_predict: -1, num_ctx: 4096, instructions: "" };

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const inputEl = $("input");

let chats = load(STORAGE_KEY, []);
let modelSettings = load(MODEL_SETTINGS_KEY, {}); // model name -> its adjustable settings
let settings = Object.assign({ textSize: "normal", theme: "auto", think: false, autoCode: "on" }, load(SETTINGS_KEY, {}));
let currentId = null;
let controller = null; // lets the Stop button cancel a reply in progress
let ollamaUp = null; // null = not checked yet
let hasOrganizer = false;
let isPhone = false; // this page is open on a phone (or other device) using a computer's AI over Wi-Fi
let paired = true;
let modelInfo = null; // last answer from /api/models
const downloads = {}; // model name -> { pct, text }

// ---------- Small helpers ----------

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function store(key, value) {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); }
  catch { /* storage full or blocked; the app still works for this visit */ }
}

const saveChats = () => store(STORAGE_KEY, chats);
const currentChat = () => chats.find((c) => c.id === currentId);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

// Phones reach the app over plain http on the Wi-Fi, where some browser features
// (random IDs, the clipboard API) are switched off, so these have fallbacks.
function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function copyFallback(text) {
  const area = el("textarea", { style: "position:fixed;opacity:0" });
  area.value = text;
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

async function copyText(button, text) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else copyFallback(text);
    const old = button.textContent;
    button.textContent = "Copied ✓";
    setTimeout(() => (button.textContent = old), 1500);
  } catch { toast("Couldn't copy. Select the text and press Ctrl+C instead."); }
}

// Read a response that sends one JSON object per line.
async function readLines(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

const gb = (n) => `${Math.round(n * 10) / 10} GB`;
const TIER_TEXT = { phone: "📱 Phone size", laptop: "💻 Laptop size", desktop: "🖥️ Desktop size", workstation: "🖥️ 32 to 64 GB computers" };
const SPEED_TEXT = { fast: "Fast on this computer", good: "Runs well", slow: "Slow on this computer", blocked: "Too big for this computer" };

// ---------- Settings ----------

function applySettings() {
  document.documentElement.dataset.textSize = settings.textSize;
  if (settings.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  document.querySelectorAll(".segmented").forEach((group) => {
    group.querySelectorAll("button").forEach((b) => b.classList.toggle("on", settings[group.dataset.setting] === b.dataset.value));
  });
  $("think-toggle").setAttribute("aria-pressed", String(settings.think));
}

document.querySelectorAll(".segmented button").forEach((b) => {
  b.addEventListener("click", () => {
    settings[b.parentElement.dataset.setting] = b.dataset.value;
    store(SETTINGS_KEY, settings);
    applySettings();
  });
});

$("think-toggle").addEventListener("click", () => {
  settings.think = !settings.think;
  store(SETTINGS_KEY, settings);
  applySettings();
  toast(settings.think ? "Think deeper is on: smarter but slower answers." : "Think deeper is off: faster answers.");
});

$("clear-all").addEventListener("click", () => {
  if (!confirm("Delete all chats? This can't be undone.")) return;
  chats = [];
  currentId = null;
  saveChats();
  renderSidebar();
  renderMain();
  $("settings-dialog").close();
  toast("All chats deleted.");
});

// ---------- Talking to the server ----------

async function checkStatus() {
  try {
    const data = await (await fetch("/api/status")).json();
    ollamaUp = data.ollama;
    hasOrganizer = data.organizer;
    isPhone = data.remote;
    paired = data.paired;
  } catch {
    ollamaUp = false;
  }
  $("organizer-link").hidden = !hasOrganizer;
  $("files-link").hidden = !hasOrganizer;
  document.body.classList.toggle("on-phone", isPhone);
  if (ollamaUp && paired) await loadModels();
  renderModelButton();
  refreshStartScreen();
}

// Redraw the setup or welcome screen, but never a chat (that could cut off a reply in progress).
function refreshStartScreen() {
  if (!currentChat()?.messages.length) renderMain();
}

async function loadModels() {
  try {
    const resp = await fetch("/api/models");
    if (!resp.ok) throw new Error();
    modelInfo = await resp.json();
  } catch {
    modelInfo = null;
    return;
  }
  // Keep the chosen model if it's still usable, otherwise pick the best installed one.
  const usable = modelInfo.models;
  if (!usable.includes(currentModel())) {
    const recommended = allModels().find((m) => m.name === modelInfo.recommended && m.installed);
    const firstChat = allModels().find((m) => m.installed && !m.coding && usable.includes(m.installed_name));
    setModel(recommended ? recommended.installed_name : firstChat ? firstChat.installed_name : usable[0] || "");
  }
}

// Poll while Ollama is off, so the page notices as soon as it's started.
setInterval(() => { if (ollamaUp === false) checkStatus(); }, 3000);

// ---------- Models ----------

const currentModel = () => localStorage.getItem(MODEL_KEY) || "";
const allModels = () => (modelInfo ? [...modelInfo.catalog, ...modelInfo.others] : []);
const findModel = (name) => allModels().find((m) => m.installed_name === name || m.name === name);

function setModel(name) {
  store(MODEL_KEY, name);
  renderModelButton();
}

function renderModelButton() {
  const m = findModel(currentModel());
  $("model-name").textContent = m ? m.label : ollamaUp === false ? "AI is off" : "Choose a model";
  $("model-dot").className = "dot " + (m ? m.fit.speed : "");
  $("think-toggle").hidden = !(m?.capabilities || []).includes("thinking");
}

function systemSummary(hw) {
  const gpu = hw.gpus.find((g) => g.usable);
  const specs = [
    ["Memory (RAM)", hw.ram_gb ? gb(hw.ram_gb) : "Unknown"],
    ["Graphics", gpu ? (gpu.shared ? `${gpu.name} (shared memory)` : `${gpu.name}, ${gb(gpu.vram_gb)}`) : "None the AI can use"],
    ["Free disk space", hw.disk_free_gb != null ? gb(hw.disk_free_gb) : "Unknown"],
  ];
  return specs.map(([k, v]) => el("div", { class: "spec" }, el("b", {}, v), el("span", { class: "small" }, k)));
}

function modelCard(m) {
  const blocked = m.fit.speed === "blocked";
  const isCurrent = m.installed && m.installed_name === currentModel();
  const dl = downloads[m.name];

  const title = el("div", { class: "title" }, m.label,
    m.name === modelInfo.recommended || m.name === modelInfo.recommended_coder ? el("span", { class: "badge" }, "★ Recommended for you") : null,
    m.installed ? el("span", { class: "badge installed" }, "Installed") : null);

  const meta = el("div", { class: "meta" },
    el("span", { class: "speed" }, el("span", { class: `dot ${m.fit.speed}` }), SPEED_TEXT[m.fit.speed]),
    m.tier ? el("span", {}, TIER_TEXT[m.tier]) : null,
    el("span", {}, `${gb(m.size_gb)} download`),
    m.tools ? el("span", {}, "Can use tools") : null);

  const side = el("div", { class: "side" });
  if (blocked) {
    side.append(el("button", { disabled: true, title: m.fit.reason }, "🔒 Locked"));
  } else if (dl) {
    side.append(
      el("div", { class: "progress", role: "progressbar", "aria-valuenow": dl.pct }, el("div", { style: `width:${dl.pct}%` })),
      el("span", { class: "progress-text" }, dl.text));
  } else if (isPhone && !m.installed) {
    side.append(el("span", { class: "small" }, "Download it on the computer"));
  } else if (m.installed) {
    side.append(isCurrent
      ? el("button", { disabled: true }, "✓ In use")
      : el("button", { class: "primary", onclick: () => { setModel(m.installed_name); renderModels(); toast(`Now chatting with ${m.label}.`); } }, "Use this"));
    side.append(el("button", { onclick: () => openModelSettings(m) }, "⚙ Adjust"));
    if (!isPhone) side.append(el("button", { class: "remove", onclick: () => removeModel(m) }, "Remove"));
  } else {
    side.append(el("button", { class: "primary", onclick: () => download(m) }, `Download`));
  }

  return el("div", { class: `model-card${isCurrent ? " current" : ""}${blocked ? " blocked" : ""}` },
    el("div", { class: "info" }, title, el("div", { class: "about" }, m.about), meta,
      m.fit.speed !== "good" ? el("div", { class: "small" }, m.fit.reason) : null),
    side);
}

function renderModels() {
  renderModelButton();
  if (!$("models-dialog").open) return;
  const cards = $("model-cards");
  const sys = $("system-card");
  cards.innerHTML = "";
  sys.innerHTML = "";
  if (!modelInfo) {
    cards.append(el("p", {}, "The AI engine (Ollama) isn't running. Start it, and this list will appear."));
    return;
  }
  if (isPhone) sys.append(el("p", { class: "note", style: "width:100%;margin:0" }, "These are the computer your phone is connected to. The AI runs there, so models are rated for it."));
  sys.append(...systemSummary(modelInfo.system));
  cards.append(el("h3", {}, "Chat models"));
  modelInfo.catalog.filter((m) => !m.coding).forEach((m) => cards.append(modelCard(m)));
  cards.append(el("h3", { id: "coding-models" }, "Coding models"),
    el("p", { class: "note" }, settings.autoCode === "on"
      ? "When you ask for a bigger coding project, like a game, website or app, the chat switches to your best installed coding model. Simple code questions stay with your chat model. You can turn this off in Settings."
      : "Auto-switching is off in Settings, so coding models are only used when you pick one yourself."));
  modelInfo.catalog.filter((m) => m.coding).forEach((m) => cards.append(modelCard(m)));
  if (modelInfo.others.length) {
    cards.append(el("h3", {}, "Other models you installed"));
    modelInfo.others.forEach((m) => cards.append(modelCard(m)));
  }
}

async function openModels(section) {
  closeSidebar();
  $("models-dialog").showModal();
  renderModels();
  await checkStatus();
  renderModels();
  if (typeof section === "string") $(section)?.scrollIntoView({ block: "start" });
}

function describeProgress(ev) {
  if (ev.total && ev.status.startsWith("pulling")) {
    const pct = Math.floor((ev.completed / ev.total) * 100);
    return { pct, text: `Downloading ${pct}% (${gb(ev.completed / 1e9)} of ${gb(ev.total / 1e9)})` };
  }
  if (ev.status.includes("verifying")) return { pct: 100, text: "Checking the download..." };
  if (ev.status.includes("manifest") || ev.status === "success") return { pct: 100, text: "Finishing up..." };
  return { pct: 0, text: "Starting download..." };
}

async function download(m) {
  downloads[m.name] = { pct: 0, text: "Starting download..." };
  renderModels();
  refreshStartScreen();
  let failed = null;
  try {
    const resp = await fetch("/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.name }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "Download failed.");
    let last = 0;
    await readLines(resp, (ev) => {
      if (ev.type === "error") failed = ev.message;
      if (ev.type === "progress") {
        downloads[m.name] = describeProgress(ev);
        if (Date.now() - last > 300) { last = Date.now(); renderModels(); refreshStartScreen(); }
      }
    });
  } catch (err) {
    failed = err.message;
  }
  delete downloads[m.name];
  if (failed) {
    toast(`${m.label} didn't download: ${failed}`);
  } else {
    toast(`${m.label} is ready to chat!`);
    await loadModels();
    const fresh = findModel(m.name);
    if (fresh?.installed && (!currentModel() || !modelInfo.models.includes(currentModel()))) setModel(fresh.installed_name);
  }
  renderModels();
  refreshStartScreen();
}

async function removeModel(m) {
  if (!confirm(`Remove ${m.label} from this computer? This frees ${gb(m.size_gb)}. You can download it again later.`)) return;
  const resp = await fetch("/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: m.installed_name }),
  });
  toast(resp.ok ? `${m.label} removed.` : "Couldn't remove that model.");
  await loadModels();
  renderModels();
}

// ---------- Adjustable settings for each model ----------

const settingsFor = (name) => Object.assign({}, MODEL_DEFAULTS, modelSettings[name]);

function saveModelSetting(name, key, value) {
  modelSettings[name] = Object.assign(settingsFor(name), { [key]: value });
  store(MODEL_SETTINGS_KEY, modelSettings);
}

function creativityWord(t) {
  return t < 0.4 ? "Precise" : t <= 0.9 ? "Balanced" : "Creative";
}

function settingRow(title, help, control) {
  return el("div", { class: "model-setting" },
    el("div", { class: "setting-title" }, title), control, el("p", { class: "note" }, help));
}

function choiceGroup(name, key, choices) {
  const current = settingsFor(name)[key];
  const group = el("div", { class: "segmented wrap", role: "group" });
  for (const c of choices) {
    group.append(el("button", {
      class: c.value === current ? "on" : "",
      disabled: c.locked,
      title: c.locked ? "Too much for this computer's memory" : null,
      onclick: () => { saveModelSetting(name, key, c.value); renderModelSettings(); },
    }, c.locked ? `🔒 ${c.label}` : c.label));
  }
  return group;
}

let settingsModel = null; // the model whose settings panel is open

function renderModelSettings() {
  const m = settingsModel;
  const name = m.installed_name;
  const s = settingsFor(name);
  $("model-settings-title").textContent = `Settings for ${m.label}`;

  const slider = el("input", { type: "range", min: "0", max: "1.5", step: "0.1", value: String(s.temperature), "aria-label": "Creativity" });
  const sliderValue = el("b", {}, `${creativityWord(s.temperature)} (${s.temperature})`);
  slider.addEventListener("input", () => {
    const t = Number(slider.value);
    sliderValue.textContent = `${creativityWord(t)} (${t})`;
    saveModelSetting(name, "temperature", t);
  });

  const lengths = [
    { value: 512, label: "Short" }, { value: 1024, label: "Medium" },
    { value: 2048, label: "Long" }, { value: -1, label: "No limit" },
  ];
  const memory = (m.context || []).map((o) => ({ value: o.value, label: `${o.value / 1024}K`, locked: !o.ok }));

  const instructions = el("textarea", { rows: "4", maxlength: "2000", placeholder: "For example: Explain things simply, like I'm in middle school. Keep answers under 200 words." });
  instructions.value = s.instructions;
  instructions.addEventListener("input", () => saveModelSetting(name, "instructions", instructions.value));

  $("model-settings-body").replaceChildren(
    el("p", { class: "note" }, "Changes save automatically and apply to your next message."),
    settingRow("Creativity", "Lower gives focused, factual answers. Higher gives more varied, imaginative ones.",
      el("div", { class: "slider-row" }, el("span", { class: "small" }, "Precise"), slider, el("span", { class: "small" }, "Creative"), sliderValue)),
    settingRow("Answer length", "The longest an answer can be. Short is about 400 words; Long is about 1,500.", choiceGroup(name, "num_predict", lengths)),
    settingRow("Conversation memory", "How much of the chat the AI can remember. More memory uses more of your computer's RAM. Locked sizes are too big for this computer.", choiceGroup(name, "num_ctx", memory)),
    settingRow("Custom instructions", "Tell the AI how to answer every time you chat with this model.", instructions),
    el("div", { class: "dialog-buttons" },
      el("button", { onclick: () => { delete modelSettings[name]; store(MODEL_SETTINGS_KEY, modelSettings); renderModelSettings(); toast("Settings reset to defaults."); } }, "Reset to defaults"),
      el("button", { class: "primary", onclick: () => $("model-settings-dialog").close() }, "Done")),
  );
}

function openModelSettings(m) {
  settingsModel = m;
  renderModelSettings();
  $("model-settings-dialog").showModal();
}

$("adjust-current").addEventListener("click", () => {
  const m = findModel(currentModel());
  if (!m || !m.installed) return toast("Download a model first.");
  $("settings-dialog").close();
  openModelSettings(m);
});

$("model-button").addEventListener("click", openModels);
$("settings-button").addEventListener("click", () => {
  closeSidebar();
  $("settings-dialog").showModal();
  if (!isPhone) renderPhoneSetting();
});
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

// ---------- Sidebar ----------

function dayGroup(time) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (time >= startOfToday) return "Today";
  if (time >= startOfToday - 864e5) return "Yesterday";
  if (time >= startOfToday - 7 * 864e5) return "Previous 7 days";
  return "Older";
}

function renderSidebar() {
  const list = $("chat-list");
  const query = $("search").value.trim().toLowerCase();
  list.innerHTML = "";
  const shown = [...chats]
    .sort((a, b) => b.updated - a.updated)
    .filter((c) => !query || c.title.toLowerCase().includes(query) || c.messages.some((m) => m.content.toLowerCase().includes(query)));
  if (!shown.length) {
    list.append(el("li", { class: "empty" }, query ? "No chats match your search." : "Your chats will show up here."));
    return;
  }
  let group = null;
  for (const chat of shown) {
    const g = dayGroup(chat.updated);
    if (g !== group) list.append(el("li", { class: "group" }, (group = g)));
    list.append(el("li", { class: `chat${chat.id === currentId ? " active" : ""}`, onclick: () => openChat(chat.id) },
      el("span", { title: chat.title }, chat.title),
      el("button", { title: "Rename", "aria-label": "Rename chat", onclick: (e) => { e.stopPropagation(); renameChat(chat); } }, "✎"),
      el("button", { title: "Delete", "aria-label": "Delete chat", onclick: (e) => { e.stopPropagation(); deleteChat(chat.id); } }, "🗑")));
  }
}

$("search").addEventListener("input", renderSidebar);

function openSidebar() { $("sidebar").classList.add("open"); $("scrim").hidden = false; }
function closeSidebar() { $("sidebar").classList.remove("open"); $("scrim").hidden = true; }
$("toggle-sidebar").addEventListener("click", openSidebar);
$("scrim").addEventListener("click", closeSidebar);

// ---------- Main area: setup guide, welcome, or a chat ----------

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const SUGGESTIONS = [
  { title: "Explain something", text: "like photosynthesis, simply", prompt: "Explain how photosynthesis works like I'm in 8th grade." },
  { title: "Help me write", text: "a polite email to a teacher", prompt: "Help me write a polite email to my teacher asking for a one-day extension on my essay." },
  { title: "Quiz me", text: "to study for a test", prompt: "Quiz me with 5 questions about the American Revolution, one at a time. Wait for my answer before the next one." },
  { title: "Plan my week", text: "with a study schedule", prompt: "Make me a simple one-week study plan for a math test on Friday. I have about an hour each day." },
];

function setupScreen() {
  const wrap = el("div", { class: "setup" }, el("h2", {}, "Let's get your AI ready"),
    el("p", { class: "note" }, "Two quick steps. You only need to do this once."));

  const step1Done = ollamaUp;
  wrap.append(el("div", { class: `step${step1Done ? " done" : ""}` },
    el("div", { class: "num" }, step1Done ? "✓" : "1"),
    el("div", {},
      el("h3", {}, "Start the AI engine (Ollama)"),
      step1Done
        ? el("p", {}, "Ollama is running.")
        : el("div", {},
          el("p", {}, "Ollama is a free app that runs AI models on your computer. Install it, then open it. On Windows look for the llama icon by the clock; on a Mac it's in the menu bar."),
          el("div", { class: "buttons" },
            el("a", { class: "primary", href: "https://ollama.com/download", target: "_blank", rel: "noopener" }, "Download Ollama"),
            el("button", { onclick: checkStatus }, "I've opened it, check again"),
            el("span", { class: "checking" }, "Checking automatically...")))),
  ));

  const rec = modelInfo && modelInfo.catalog.find((m) => m.name === modelInfo.recommended);
  const step2 = el("div", {});
  if (!ollamaUp) {
    step2.append(el("p", {}, "After Ollama is running, you'll pick a model that fits your computer."));
  } else if (!rec) {
    step2.append(el("p", {}, "This computer doesn't have enough memory for any of the app's models. You need at least 4 GB of RAM."),
      el("button", { onclick: openModels }, "See all models"));
  } else {
    step2.append(
      el("p", {}, `We checked your computer and picked the best fit. You can change it any time.`),
      modelCard(rec),
      el("button", { onclick: openModels }, "Compare all models"));
  }
  wrap.append(el("div", { class: "step" }, el("div", { class: "num" }, "2"),
    el("div", { style: "flex:1;min-width:0" }, el("h3", {}, "Download an AI model"), step2)));
  return wrap;
}

function welcomeScreen() {
  const cards = SUGGESTIONS.map((s) =>
    el("button", { class: "suggestion", onclick: () => send(s.prompt) }, el("strong", {}, s.title), el("span", {}, s.text)));
  if (hasOrganizer) {
    cards[3] = el("a", { class: "suggestion", href: "/organizer", style: "text-decoration:none;color:inherit" },
      el("strong", {}, "Organize my files"), el("span", {}, "tidy up a messy folder"));
  }
  const m = findModel(currentModel());
  return el("div", { class: "welcome" },
    el("h2", {}, `${greeting()}! How can I help?`),
    el("p", {}, `Chatting with ${m ? m.label : currentModel()}. Everything stays on this computer.`),
    el("div", { class: "suggestions" }, ...cards));
}

// ---------- Using the app from a phone ----------

function pairScreen() {
  const code = el("input", { inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code", placeholder: "123456", class: "code-input", "aria-label": "Code" });
  const msg = el("p", { class: "note" });
  const submit = async () => {
    const resp = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.value }) });
    if (resp.ok) { toast("Connected! You can chat now."); await checkStatus(); renderMain(); }
    else msg.textContent = (await resp.json().catch(() => ({}))).error || "That didn't work. Try again.";
  };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return el("div", { class: "setup" }, el("h2", {}, "Connect to your computer"),
    el("div", { class: "step" }, el("div", { class: "num" }, "📱"), el("div", { style: "flex:1" },
      el("p", {}, "Type the 6-digit code shown on your computer, in Settings under \"Use on your phone\". The AI runs on that computer; this phone just shows the chat."),
      el("div", { class: "buttons" }, code, el("button", { class: "primary", onclick: submit }, "Connect")), msg)));
}

async function renderPhoneSetting() {
  const box = $("phone-info");
  let data;
  try { data = await (await fetch("/api/phone")).json(); } catch { return; }
  document.querySelectorAll("[data-phone]").forEach((b) => b.classList.toggle("on", String(data.enabled) === b.dataset.phone));
  box.replaceChildren();
  if (data.error) box.append(el("p", { class: "note error-text" }, data.error));
  if (data.enabled && data.url) {
    box.append(el("ol", { class: "phone-steps" },
      el("li", {}, "Connect your phone to the same Wi-Fi as this computer."),
      el("li", {}, "Open this address in your phone's browser: ", el("b", {}, data.url)),
      el("li", {}, "Type this code: ", el("b", { class: "big-code" }, data.code))),
      el("p", { class: "note" }, `${data.phones} device${data.phones === 1 ? "" : "s"} connected. Only turn this on with Wi-Fi you trust, like at home. Phones can chat but can't change settings or see your folders. Turning this off disconnects every phone.`));
  } else if (!data.error) {
    box.append(el("p", { class: "note" }, "Chat from your phone while the AI runs on this computer. Your phone needs to be on the same Wi-Fi."));
  }
}

document.querySelectorAll("[data-phone]").forEach((b) => b.addEventListener("click", async () => {
  await fetch("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: b.dataset.phone === "true" }) });
  renderPhoneSetting();
}));

function renderMain() {
  const chat = currentChat();
  $("chat-title").textContent = chat ? chat.title : "New chat";
  if (chat && chat.messages.length) return renderMessages();
  messagesEl.innerHTML = "";
  if (ollamaUp === null) return;
  if (!paired) return messagesEl.append(pairScreen());
  const ready = ollamaUp && modelInfo && modelInfo.models.length;
  messagesEl.append(ready ? welcomeScreen() : setupScreen());
}

// ---------- Messages ----------

function thinkingBlock(text, seconds, open) {
  return el("details", { class: "thinking", open },
    el("summary", {}, seconds == null ? "💡 Thinking..." : `💡 Thought for ${seconds} second${seconds === 1 ? "" : "s"}`),
    el("div", { class: "thought" }, text));
}

function switchBanner(model, reason) {
  const label = findModel(model)?.label || model;
  return el("div", { class: "switch-banner" }, el("b", {}, `🧑‍💻 ${label} is answering. `), reason);
}

function messageEl(m, index, chat) {
  const isLast = index === chat.messages.length - 1;
  const content = el("div", { class: "content" });
  const wrap = el("div", { class: `msg ${m.role}` });
  if (m.role === "assistant") {
    if (m.switched) wrap.append(switchBanner(m.model, m.switched));
    if (m.thinking) wrap.append(thinkingBlock(m.thinking, m.thinkSeconds, false));
    content.innerHTML = renderMarkdown(m.content);
    wrap.append(content, el("div", { class: "actions" },
      el("button", { onclick: (e) => copyText(e.target, m.content) }, "Copy"),
      isLast ? el("button", { onclick: regenerate, title: "Ask again for a different answer" }, "↻ Retry") : null,
      m.model ? el("span", { class: "model-tag" }, findModel(m.model)?.label || m.model) : null));
  } else {
    content.textContent = m.content;
    wrap.append(content, el("div", { class: "actions", style: "justify-content:flex-end" },
      el("button", { onclick: (e) => copyText(e.target, m.content) }, "Copy"),
      el("button", { onclick: () => editMessage(index), title: "Change this message and ask again" }, "✎ Edit")));
  }
  return wrap;
}

function renderMessages() {
  const chat = currentChat();
  messagesEl.innerHTML = "";
  chat.messages.forEach((m, i) => {
    if (m.role === "tool") return; // a tool's answer; shown on its card instead (connectors_routes)
    messagesEl.append(m.tool_calls ? ToolChat.savedTurn(m, renderMarkdown) : messageEl(m, i, chat));
  });
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Copy buttons on code blocks
messagesEl.addEventListener("click", (e) => {
  if (e.target.classList.contains("copy")) {
    copyText(e.target, e.target.parentElement.querySelector("code").textContent);
  }
});

function errorEl(message, actions) {
  return el("div", { class: "msg error" }, el("div", { class: "content" }, "⚠️ " + message),
    el("div", { class: "actions" }, ...actions));
}

// ---------- Chats ----------

function newChat() {
  if (controller) return;
  currentId = null;
  renderSidebar();
  renderMain();
  closeSidebar();
  inputEl.focus();
}

function openChat(id) {
  if (controller) return toast("Wait for the answer to finish, or press Stop.");
  currentId = id;
  renderSidebar();
  renderMain();
  closeSidebar();
}

function renameChat(chat) {
  const title = prompt("Rename this chat:", chat.title);
  if (!title || !title.trim()) return;
  chat.title = title.trim().slice(0, 80);
  saveChats();
  renderSidebar();
  renderMain();
}

function deleteChat(id) {
  if (!confirm("Delete this chat?")) return;
  chats = chats.filter((c) => c.id !== id);
  saveChats();
  if (currentId === id) currentId = null;
  renderSidebar();
  renderMain();
}

function editMessage(index) {
  if (controller) return;
  const chat = currentChat();
  inputEl.value = chat.messages[index].content;
  chat.messages = chat.messages.slice(0, index);
  saveChats();
  renderMain();
  autoResize();
  inputEl.focus();
}

// ---------- Sending and streaming ----------

async function send(text) {
  if (!ollamaUp || !modelInfo?.models.includes(currentModel())) {
    currentId = null;
    renderMain();
    inputEl.value = text;
    toast(ollamaUp ? "Download a model first, then send your message." : "Start Ollama first, then send your message.");
    return;
  }
  let chat = currentChat();
  if (!chat) {
    chat = { id: newId(), title: text.replace(/\s+/g, " ").slice(0, 50), messages: [], updated: Date.now() };
    chats.push(chat);
    currentId = chat.id;
  }
  chat.messages.push({ role: "user", content: text });
  chat.updated = Date.now();
  saveChats();
  renderSidebar();
  renderMain();
  await streamReply(chat);
}

async function streamReply(chat) {
  let model = currentModel(); // the server may switch to a coding model; it says which
  let switched = null;
  const wrap = el("div", { class: "msg assistant" });
  const body = el("div", { class: "content" }, el("span", { class: "typing", "aria-label": "Thinking" }, el("i"), el("i"), el("i")));
  wrap.append(body);
  messagesEl.append(wrap);
  scrollToBottom();
  setBusy(true);

  let reply = "";
  let thinking = "";
  let thinkBlock = null;
  let thinkStart = null;
  let thinkSeconds = null;
  let failure = null;
  let notice = null;
  let toolCalls = null; // tools the model asked for (connectors_routes)
  controller = new AbortController();

  const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages: chat.messages, think: settings.think,
        auto_code: settings.autoCode === "on", settings_by_model: modelSettings,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      failure = { status: resp.status, message: data.error || `Something went wrong (error ${resp.status}).` };
    } else {
      await readLines(resp, (ev) => {
        const stick = nearBottom();
        if (ev.type === "model") {
          model = ev.name;
          if (ev.switched) {
            switched = ev.reason;
            wrap.prepend(switchBanner(model, switched));
          }
        } else if (ev.type === "thinking") {
          if (!thinkBlock) {
            thinkStart = Date.now();
            thinkBlock = thinkingBlock("", null, true);
            body.before(thinkBlock);
          }
          thinking += ev.text;
          thinkBlock.querySelector(".thought").textContent = thinking;
        } else if (ev.type === "text") {
          if (thinkBlock && thinkSeconds == null) {
            thinkSeconds = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
            thinkBlock.replaceWith((thinkBlock = thinkingBlock(thinking, thinkSeconds, false)));
          }
          reply += ev.text;
          body.innerHTML = renderMarkdown(reply);
        } else if (ev.type === "notice") {
          notice = ev;
        } else if (ev.type === "tool_calls") {
          toolCalls = ev.calls;
        } else if (ev.type === "error") {
          failure = { message: ev.message };
        }
        if (stick) scrollToBottom();
      });
    }
    // The model wants to use connectors: ask the user, run the tools, then let it continue.
    if (toolCalls && !failure) {
      body.innerHTML = renderMarkdown(reply);
      const signal = controller.signal;
      const ran = await ToolChat.runCalls({ calls: toolCalls, chat, model, text: reply, wrap, body, signal, save: saveChats });
      if (ran) {
        controller = null;
        renderMain();
        return streamReply(chat);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") failure = { message: "Lost connection to the app. Is the server window still open?" };
  }

  controller = null;
  setBusy(false);
  if (reply) {
    if (thinkSeconds == null && thinking) thinkSeconds = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
    chat.messages.push({ role: "assistant", content: reply, model, ...(switched ? { switched } : {}), ...(thinking ? { thinking, thinkSeconds } : {}) });
    chat.updated = Date.now();
    saveChats();
  }
  renderMain();
  if (notice && !failure) {
    const action = notice.action === "coding-models"
      ? el("button", { class: "chip", onclick: () => openModels("coding-models") }, "See coding models")
      : el("button", { class: "chip", onclick: () => openModelSettings(findModel(model)) }, "Open settings");
    messagesEl.append(el("div", { class: "msg notice" }, el("div", { class: "note" }, "ℹ️ " + notice.text + " "), action));
    scrollToBottom();
  }
  if (failure) {
    const actions = [el("button", { onclick: regenerate }, "↻ Try again")];
    if (failure.status === 503) {
      ollamaUp = false;
      actions.push(el("button", { onclick: () => { currentId = null; renderSidebar(); renderMain(); } }, "Show setup steps"));
    }
    if (failure.status === 401) { paired = false; actions.push(el("button", { onclick: () => { currentId = null; renderMain(); } }, "Enter the code")); }
    if (failure.status === 404 || failure.status === 409) actions.push(el("button", { onclick: openModels }, "Choose another model"));
    messagesEl.append(errorEl(failure.message, actions));
    scrollToBottom();
  }
}

function regenerate() {
  const chat = currentChat();
  if (!chat || controller) return;
  if (chat.messages.at(-1)?.role === "assistant") chat.messages.pop();
  saveChats();
  renderMain();
  streamReply(chat);
}

function setBusy(busy) {
  $("send").hidden = busy;
  $("stop").hidden = !busy;
  if (!busy) inputEl.focus();
}

// ---------- Input box ----------

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || controller) return;
  inputEl.value = "";
  autoResize();
  send(text);
});

// Enter sends, Shift+Enter makes a new line
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = inputEl.scrollHeight + "px";
}
inputEl.addEventListener("input", autoResize);

$("stop").addEventListener("click", () => controller?.abort());
$("new-chat").addEventListener("click", newChat);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); }
  if (e.key === "Escape") closeSidebar();
});

// ---------- Start ----------

applySettings();
renderSidebar();
renderMain();
checkStatus();
inputEl.focus();
