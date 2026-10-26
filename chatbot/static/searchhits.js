// Searching chats shows where each match is: a short snippet under the chat's name,
// and opening the chat scrolls to the first match and highlights it.
(function () {
  const search = document.getElementById("search");
  const list = document.getElementById("chat-list");
  const style = document.createElement("style");
  style.textContent = `
    #chat-list li.chat.has-hit { flex-wrap: wrap; }
    #chat-list li.chat .hit { order: 99; flex-basis: 100%; font-size: 0.78em; color: var(--muted); font-weight: 400;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    #chat-list li.chat .hit mark, mark.search-hit { background: color-mix(in srgb, var(--accent) 28%, transparent);
      color: inherit; border-radius: 3px; padding: 0 1px; }
    mark.search-hit { animation: search-hit-pulse 1.2s ease-out 2; }
    @keyframes search-hit-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); }
      100% { box-shadow: 0 0 0 8px transparent; } }
  `;
  document.head.append(style);

  const query = () => search.value.trim().toLowerCase();

  // Markdown symbols make snippets hard to read, so drop them.
  const plain = (text) => text.replace(/```[^\n]*\n?/g, " ").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim();

  // "...the leaves use sunlight to make sugar..." with the match marked.
  function snippet(text, q) {
    const flat = plain(text);
    const at = flat.toLowerCase().indexOf(q);
    if (at < 0) return null;
    const start = Math.max(0, at - 12); // the sidebar is narrow, so keep the match near the front
    const end = Math.min(flat.length, at + q.length + 60);
    const div = document.createElement("div");
    div.className = "hit";
    const mark = document.createElement("mark");
    mark.textContent = flat.slice(at, at + q.length);
    div.append((start > 0 ? "…" : "") + flat.slice(start, at), mark, flat.slice(at + q.length, end) + (end < flat.length ? "…" : ""));
    return div;
  }

  // Match each row to its chat by title (two chats can share a title, so each chat is used once).
  function decorate() {
    const q = query();
    const used = new Set();
    for (const li of list.querySelectorAll("li.chat")) {
      if (li.querySelector(".hit")) continue;
      const title = li.querySelector("span")?.title;
      const chat = chats.find((c) => !used.has(c.id) && c.title === title &&
        (!q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q))));
      if (!chat) continue;
      used.add(chat.id);
      li.dataset.chatId = chat.id;
      if (!q || chat.title.toLowerCase().includes(q)) continue; // the name already shows why it matched
      const msg = chat.messages.find((m) => m.content.toLowerCase().includes(q));
      const hit = msg && snippet(msg.content, q);
      if (hit) { li.append(hit); li.classList.add("has-hit"); }
    }
  }

  // Wrap the first rendered match in the open chat and bring it into view.
  function highlight(q) {
    const walker = document.createTreeWalker(document.getElementById("messages"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("button, .actions, mark")) continue;
      const at = node.nodeValue.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const hit = node.splitText(at);
      hit.splitText(q.length);
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      hit.replaceWith(mark);
      mark.append(hit);
      mark.scrollIntoView({ block: "center" });
      return true;
    }
    return false;
  }

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li.chat");
    const q = query();
    if (!li || !q || e.target.closest("button")) return;
    const id = li.dataset.chatId;
    setTimeout(() => { if (currentId === id) highlight(q); }, 0);
  }, true);

  new MutationObserver(decorate).observe(list, { childList: true });
  decorate();
})();
