// Browser demo: runs a small Qwen3 model in the page with WebLLM (WebGPU).
// No server is involved; the model files are cached by the browser after the first load.

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.85";
const SYSTEM_PROMPT =
  "You are Local AI Chat, a friendly, helpful assistant running privately on the user's own device. " +
  "Answer clearly and concisely. Use Markdown for lists and code.";

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const input = $("input");
const sendBtn = $("send");
const stopBtn = $("stop");
const thinkBox = $("think");

let engine = null;
let busy = false;
const history = [];

function showProblem(html) {
  $("welcome-text").innerHTML = html;
  $("start").hidden = true;
  $("progress").hidden = true;
}

async function pickModel() {
  if (!("gpu" in navigator)) return null;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return null;
  // Half-precision weights are smaller and faster, but not every GPU supports them.
  return adapter.features.has("shader-f16") ? "Qwen3-0.6B-q4f16_1-MLC" : "Qwen3-0.6B-q4f32_1-MLC";
}

async function start() {
  const model = await pickModel();
  if (!model) {
    showProblem(
      "This browser can’t run the demo because it doesn’t support <strong>WebGPU</strong>. " +
      "Try the latest Chrome or Edge on a computer, or <a href=\"index.html#get-started\">download the full app</a>, which works on any recent Windows or Mac computer."
    );
    return;
  }

  $("start").hidden = true;
  $("progress").hidden = false;
  try {
    const webllm = await import(WEBLLM_URL);
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (report) => {
        $("bar").style.width = Math.round((report.progress || 0) * 100) + "%";
        $("progress-text").textContent = friendlyProgress(report);
      },
    });
  } catch (err) {
    console.error(err);
    showProblem(
      "The demo model couldn’t load on this device (" + escapeHtml(String(err.message || err)).slice(0, 200) + "). " +
      "Your graphics card may not have enough memory. <a href=\"index.html#get-started\">Download the full app</a> instead, it picks a model that fits your computer."
    );
    return;
  }

  $("progress").hidden = true;
  $("welcome-text").textContent = "The model is ready and running on your device. Ask anything, or try one of these:";
  $("suggestions").hidden = false;
  input.disabled = false;
  sendBtn.disabled = false;
  input.placeholder = "Message Local AI Chat";
  input.focus();
}

function friendlyProgress(report) {
  const text = report.text || "";
  const pct = Math.round((report.progress || 0) * 100);
  if (/shader/i.test(text)) return "Preparing your graphics card…";
  if (/cache/i.test(text) && /load/i.test(text)) return `Loading the model… ${pct}%`;
  if (/fetch/i.test(text)) return `Downloading the model… ${pct}%`;
  return "Loading…";
}

function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") bubble.textContent = text;
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

// Splits Qwen3 output into its <think> reasoning and the visible answer.
function splitThinking(raw) {
  const open = raw.indexOf("<think>");
  if (open === -1) return { thinking: "", answer: raw, done: true };
  const close = raw.indexOf("</think>");
  if (close === -1) return { thinking: raw.slice(open + 7), answer: "", done: false };
  return { thinking: raw.slice(open + 7, close).trim(), answer: raw.slice(close + 8).trimStart(), done: true };
}

function renderAssistant(bubble, raw, streaming) {
  const { thinking, answer, done } = splitThinking(raw);
  let html = "";
  if (thinking) {
    const label = done ? "Thought it through" : "Thinking…";
    html += `<details class="thinking"${done ? "" : " open"}><summary>${label}</summary><div>${escapeHtml(thinking)}</div></details>`;
  }
  html += renderMarkdown(answer);
  bubble.innerHTML = html;
  bubble.classList.toggle("cursor", streaming);
  return answer;
}

async function send(text) {
  text = text.trim();
  if (!text || busy || !engine) return;
  $("welcome").hidden = true;
  busy = true;
  sendBtn.disabled = true;
  stopBtn.hidden = false;
  input.value = "";
  autosize();

  addMessage("user", text);
  history.push({ role: "user", content: text });
  const bubble = addMessage("assistant", "");
  bubble.classList.add("cursor");

  let raw = "";
  let answer = "";
  try {
    const stream = await engine.chat.completions.create({
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-12)],
      stream: true,
      temperature: 0.7,
      max_tokens: thinkBox.checked ? 2048 : 1024,
      extra_body: { enable_thinking: thinkBox.checked },
    });
    for await (const chunk of stream) {
      raw += chunk.choices[0]?.delta?.content || "";
      answer = renderAssistant(bubble, raw, true);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (err) {
    console.error(err);
    raw += "\n\n*Something went wrong while answering. Try again.*";
  }
  answer = renderAssistant(bubble, raw, false);
  history.push({ role: "assistant", content: answer });

  busy = false;
  sendBtn.disabled = false;
  stopBtn.hidden = true;
  input.focus();
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

$("start").addEventListener("click", start);
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input.value);
  }
});
input.addEventListener("input", autosize);
stopBtn.addEventListener("click", () => engine && engine.interruptGenerate());
messagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy");
  if (!btn) return;
  navigator.clipboard.writeText(btn.parentElement.querySelector("code").textContent).then(() => {
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });
});
$("suggestions").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") send(e.target.textContent);
});
