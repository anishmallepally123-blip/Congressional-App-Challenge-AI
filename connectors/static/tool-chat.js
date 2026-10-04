// Tool use for the chat page. When the model asks to use a connector's tool, this
// shows a card asking the user, runs the tool, and saves the turn so the model can
// continue with the result. app.js calls ToolChat.runCalls() after a reply that
// ended with a "tool_calls" event, and ToolChat.savedTurn() to draw saved turns.

const ToolChat = (() => {
  const MAX_ROUNDS = 8; // stop a model that keeps calling tools forever
  const STATES = {
    pending: "Waiting for you",
    running: "Running...",
    done: "Done",
    failed: "Didn't work",
    declined: "Declined",
  };

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  }

  async function post(path, body, signal) {
    const resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
    return data;
  }

  // ---------- Cards ----------

  function argsList(args) {
    const entries = Object.entries(args || {});
    if (!entries.length) return null;
    const list = el("dl", { className: "tool-args" });
    for (const [key, value] of entries) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      list.append(el("dt", { textContent: key }), el("dd", { textContent: text }));
    }
    return list;
  }

  function card(ui, args) {
    const state = el("span", { className: "tool-state" });
    const node = el("div", { className: "tool-card" },
      el("div", { className: "tool-head" },
        el("span", { className: "tool-icon", textContent: "🔌" }),
        el("span", { className: "tool-name" },
          el("strong", { textContent: ui.connector || "Tool" }), ` · ${ui.title}`),
        state),
      argsList(args));
    node.setState = (s) => {
      node.dataset.state = s;
      state.textContent = STATES[s];
    };
    node.showResult = (text, link) => {
      node.querySelector(".tool-buttons")?.remove();
      if (text) {
        node.append(el("details", {}, el("summary", { textContent: "Result" }),
          el("pre", { textContent: text })));
      }
      if (link) node.append(el("a", { href: link, className: "tool-link", textContent: "Open it ›" }));
    };
    return node;
  }

  // Shows Allow / Always allow / Deny and waits for a click. Resolves "once", "always" or "deny".
  function ask(node, signal) {
    return new Promise((resolve, reject) => {
      const buttons = el("div", { className: "tool-buttons" });
      const onAbort = () => { buttons.remove(); reject(new DOMException("Stopped", "AbortError")); };
      const choose = (choice) => () => { signal.removeEventListener("abort", onAbort); resolve(choice); };
      const allow = el("button", { className: "primary", textContent: "Allow once", onclick: choose("once") });
      buttons.append(
        allow,
        el("button", { textContent: "Always allow", onclick: choose("always") }),
        el("button", { textContent: "Deny", onclick: choose("deny") }));
      node.append(buttons);
      allow.focus({ preventScroll: true });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function notice(text) {
    return el("p", { className: "tool-notice", textContent: text });
  }

  // A tool turn that's already saved in the chat history.
  function savedTurn(message, render) {
    const wrap = el("div", { className: "msg assistant tool-turn" });
    if (message.content) wrap.append(el("div", { className: "content", innerHTML: render(message.content) }));
    for (const call of message.tool_calls) {
      const ui = call.ui || { title: call.function.name };
      const node = card(ui, call.function.arguments);
      node.setState(ui.state || "done");
      node.showResult(ui.result, ui.link);
      wrap.append(node);
    }
    return wrap;
  }

  // ---------- Running the tools ----------

  async function runCall(call, node, model, signal) {
    if (call.approval === "missing") {
      return { text: `There is no tool called ${call.name}.`, is_error: true, state: "failed" };
    }
    let choice = "once";
    if (call.approval !== "always") {
      node.setState("pending");
      choice = await ask(node, signal);
    }
    if (choice === "deny") {
      return { text: "The user declined to run this tool.", is_error: true, state: "declined" };
    }
    if (choice === "always") {
      // Still run it this time even if saving the choice fails.
      await post("/api/connectors/approval", { name: call.connector, tool: call.tool, approval: "always" }, signal).catch(() => {});
    }
    node.setState("running");
    try {
      const result = await post("/api/tools/call", { name: call.name, arguments: call.arguments, model }, signal);
      return { ...result, state: result.is_error ? "failed" : "done" };
    } catch (err) {
      if (err.name === "AbortError") throw err;
      return { text: err.message, is_error: true, state: "failed" };
    }
  }

  // How many tool turns the model has taken since the user last spoke.
  function roundsSinceUser(chat) {
    let n = 0;
    for (let i = chat.messages.length - 1; i >= 0 && chat.messages[i].role !== "user"; i--) {
      if (chat.messages[i].tool_calls) n++;
    }
    return n;
  }

  // Ask about and run each tool the model asked for, adding cards to `wrap` below
  // `body`. When every tool has an answer, the turn is added to chat.messages and
  // saved, and this returns true: the caller should then ask the model to continue.
  // Returns false if the model has used too many tools in a row. Throws AbortError on Stop.
  async function runCalls({ calls, chat, model, text, wrap, body, signal, save }) {
    if (roundsSinceUser(chat) >= MAX_ROUNDS) {
      wrap.insertBefore(notice("The AI kept asking for tools, so it was stopped. Try rephrasing your request."), body);
      return false;
    }
    const turn = { role: "assistant", content: text, model, tool_calls: [] };
    const results = [];
    for (const call of calls) {
      const ui = { connector: call.connector, title: call.title };
      const node = card(ui, call.arguments);
      wrap.append(node); // below what the model said
      node.scrollIntoView({ block: "nearest" });
      const result = await runCall(call, node, model, signal);
      node.setState(result.state);
      node.showResult(result.text, result.link);
      Object.assign(ui, { state: result.state, result: result.text.slice(0, 2000), link: result.link || undefined });
      turn.tool_calls.push({ function: { name: call.name, arguments: call.arguments }, ui });
      results.push({ role: "tool", tool_name: call.name, content: result.text });
    }
    // Saved only once every tool has an answer, so Stop never leaves half a turn.
    chat.messages.push(turn, ...results);
    chat.updated = Date.now();
    save();
    return true;
  }

  return { runCalls, savedTurn, notice };
})();
