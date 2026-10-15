// Highlight a word or phrase in an answer to get "💡 Explain" and "💬 Ask about this" buttons,
// so a student who hits a hard word can ask about it without retyping it.
(() => {
  const MAX_CHARS = 300;
  const style = document.createElement("style");
  style.textContent = `
    #explain-bar { position: fixed; z-index: 30; display: flex; gap: 2px; padding: 4px; border-radius: 10px;
      background: var(--code-bg, #24231f); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); transform: translate(-50%, -100%); }
    #explain-bar[hidden] { display: none; }
    #explain-bar button { font-size: 0.82em; padding: 4px 10px; border: 0; border-radius: 7px; background: transparent; color: #f5f4ef; white-space: nowrap; }
    #explain-bar button:hover { background: rgba(255, 255, 255, 0.14); }`;
  document.head.append(style);

  let picked = "";
  const bar = el("div", { id: "explain-bar", role: "toolbar", "aria-label": "Selected text", hidden: true },
    el("button", { type: "button", title: "Ask the AI to explain the words you highlighted",
      onclick: () => ask(`What does "${picked}" mean here? Explain it in simple words.`) }, "💡 Explain"),
    el("button", { type: "button", title: "Quote the highlighted words in your next message",
      onclick: quote }, "💬 Ask about this"));
  document.body.append(bar);

  // The highlighted text, if it's a short piece of one of the AI's answers.
  function selection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.parentElement?.closest(".msg.assistant .content");
    if (!start || !start.contains(range.endContainer)) return null;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    return text && text.length <= MAX_CHARS ? { text, rect: range.getBoundingClientRect() } : null;
  }

  function update() {
    const found = controller ? null : selection();
    bar.hidden = !found;
    if (!found) return;
    picked = found.text;
    const x = Math.min(Math.max(found.rect.left + found.rect.width / 2, 130), window.innerWidth - 130);
    bar.style.left = `${x}px`;
    bar.style.top = `${Math.max(found.rect.top - 8, 48)}px`;
  }

  function done() {
    bar.hidden = true;
    window.getSelection()?.removeAllRanges();
  }

  function ask(text) {
    done();
    if (controller) return toast("Wait for the answer to finish first.");
    send(text);
  }

  function quote() {
    const input = $("input");
    const quoted = `"${picked}"`;
    done();
    input.value = input.value.trim() ? `${input.value.trim()}\n${quoted} ` : `About ${quoted}: `;
    input.dispatchEvent(new Event("input")); // grow the box to fit
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // Check after the selection settles: mouse, touch (phones) and Shift+arrow keys.
  const later = () => setTimeout(update, 10);
  messagesEl.addEventListener("mouseup", later);
  messagesEl.addEventListener("touchend", later);
  messagesEl.addEventListener("keyup", later);
  document.addEventListener("selectionchange", () => { if (!bar.hidden && !selection()) bar.hidden = true; });
  messagesEl.addEventListener("scroll", () => { bar.hidden = true; });
  bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep the highlight while clicking a button
})();
