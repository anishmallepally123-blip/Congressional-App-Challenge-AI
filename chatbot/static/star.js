// "☆ Star" under each answer, and a "⭐ Starred answers" list in the sidebar. Students can keep the
// answers worth coming back to (a formula, a definition, an essay outline) like notes, and find them
// again without scrolling through old chats. The star is saved on the message, so it stays with the chat.
(() => {
  const style = document.createElement("style");
  style.textContent = `
    .msg .actions .star-answer.on { color: #c98a12; }
    #starred-dialog .star-search { box-sizing: border-box; width: 100%; margin: 12px 0 4px; padding: 8px 12px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: 0.92em; outline: none; }
    #starred-dialog .star-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow); }
    #starred-dialog .star-list { list-style: none; margin: 8px 0 0; padding: 0; overflow-y: auto; max-height: calc(100vh - 220px); }
    #starred-dialog .star-item { border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; margin-bottom: 8px; }
    #starred-dialog .star-item .q { font-weight: 600; margin-bottom: 4px; }
    #starred-dialog .star-item .a { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    #starred-dialog .star-item .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.82em; color: var(--muted); }
    #starred-dialog .star-item .meta .grow { flex: 1; min-width: 120px; }
    #starred-dialog .star-item .meta button { font-size: 1em; padding: 2px 10px; }
    #starred-dialog .empty { color: var(--muted); }`;
  document.head.append(style);

  // Bubbles follow chat.messages in order, minus tool results.
  function shownMessages(chat) {
    return chat ? chat.messages.filter((m) => m.role !== "tool") : [];
  }
  function messageFor(bubble) {
    return shownMessages(currentChat())[[...messagesEl.children].indexOf(bubble)] || null;
  }
  function questionFor(chat, m) {
    const shown = shownMessages(chat);
    for (let i = shown.indexOf(m) - 1; i >= 0; i--) if (shown[i].role === "user") return shown[i].content;
    return "";
  }

  // Every starred answer in every chat, newest star first.
  function starred(list, query = "") {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const chat of list) {
      for (const m of chat.messages) {
        if (m.role !== "assistant" || !m.star) continue;
        const question = questionFor(chat, m);
        if (q && !`${question}\n${m.content}\n${chat.title}`.toLowerCase().includes(q)) continue;
        out.push({ chat, m, question });
      }
    }
    return out.sort((a, b) => b.m.star - a.m.star);
  }

  // Plain text for the preview: no code fences, markdown marks or long whitespace.
  function preview(text) {
    return text.replace(/```[\s\S]*?```/g, " [code] ").replace(/[#*_`>|]/g, "").replace(/\s+/g, " ").trim();
  }

  function paint(button, on) {
    button.classList.toggle("on", on);
    button.textContent = on ? "★ Starred" : "☆ Star";
    button.title = on ? "Remove from Starred answers" : "Keep this answer in Starred answers";
  }

  function toggle(bubble, button) {
    const m = messageFor(bubble);
    if (!m) return;
    if (m.star) delete m.star;
    else m.star = Date.now();
    saveChats();
    paint(button, !!m.star);
    if (m.star) toast("Starred. Find it again under ⭐ Starred answers.");
  }

  // Add the button to answer bubbles each time the chat is drawn.
  function decorate() {
    if (controller) return; // the answer is still being written
    for (const bubble of messagesEl.querySelectorAll(":scope > .msg.assistant")) {
      const actions = bubble.querySelector(":scope > .actions");
      if (!actions || actions.querySelector(".star-answer")) continue;
      const m = messageFor(bubble);
      if (!m || m.role !== "assistant" || !m.content) continue;
      const button = el("button", { class: "star-answer" });
      button.addEventListener("click", () => toggle(bubble, button));
      paint(button, !!m.star);
      const tag = actions.querySelector(".model-tag");
      if (tag) tag.before(button);
      else actions.append(button);
    }
  }

  // Open the chat and bring the starred answer into view.
  function jump(chat, m) {
    dialog.close();
    openChat(chat.id);
    if (currentId !== chat.id) return;
    const bubble = messagesEl.children[shownMessages(chat).indexOf(m)];
    if (!bubble) return;
    bubble.scrollIntoView({ block: "start" });
    bubble.animate([{ background: "var(--hover)" }, { background: "transparent" }], { duration: 1600 });
  }

  const search = el("input", { type: "search", class: "star-search", placeholder: "Search starred answers", "aria-label": "Search starred answers" });
  const list = el("ul", { class: "star-list" });
  const dialog = el("dialog", { id: "starred-dialog", "aria-labelledby": "starred-title" },
    el("div", { class: "dialog-head" },
      el("h2", { id: "starred-title" }, "⭐ Starred answers"),
      el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
    search, list);
  document.body.append(dialog);

  function fill() {
    list.replaceChildren();
    const items = starred(chats, search.value);
    if (!items.length) {
      list.append(el("li", { class: "empty" }, search.value.trim()
        ? "No starred answers match that."
        : "Nothing starred yet. Press ☆ Star under any answer to keep it here."));
      return;
    }
    for (const { chat, m, question } of items) {
      list.append(el("li", { class: "star-item" },
        el("div", { class: "q" }, preview(question).slice(0, 140) || chat.title),
        el("div", { class: "a" }, preview(m.content).slice(0, 400)),
        el("div", { class: "meta" },
          el("span", { class: "grow" }, `${chat.title} · ${new Date(m.star).toLocaleDateString()}`),
          el("button", { onclick: (e) => copyText(e.currentTarget, m.content) }, "Copy"),
          el("button", { onclick: () => { delete m.star; saveChats(); fill(); decorateAgain(); } }, "Unstar"),
          el("button", { class: "primary", onclick: () => jump(chat, m) }, "Open"))));
    }
  }
  search.addEventListener("input", fill);

  // An answer unstarred from the list should lose its ★ in the open chat too.
  function decorateAgain() {
    messagesEl.querySelectorAll(".star-answer").forEach((b) => b.remove());
    decorate();
  }

  const link = el("button", { class: "sidebar-link plain", id: "starred-link", onclick: () => {
    search.value = "";
    fill();
    dialog.showModal();
    if (!document.body.classList.contains("on-phone")) search.focus();
  } }, "⭐ Starred answers");
  $("personal-link").after(link);

  new MutationObserver(decorate).observe(messagesEl, { childList: true });
  decorate();
})();
