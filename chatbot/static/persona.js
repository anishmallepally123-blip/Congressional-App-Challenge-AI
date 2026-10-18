// "🎭 Talk to...": interview a famous person. The student picks someone like Abraham Lincoln or
// Marie Curie, and the AI answers in their voice for the rest of that chat, which makes history
// and science homework feel like a conversation. The instructions live in personal.py (role_play);
// this file adds the picker and tells the server who the chat is with. The choice is saved on the chat.
(() => {
  const PEOPLE = [
    ["🎩", "Abraham Lincoln", "16th U.S. president", "What was the hardest decision you made as president?"],
    ["⚗️", "Marie Curie", "Discovered radium", "How did you discover radioactivity?"],
    ["💡", "Albert Einstein", "Physicist, relativity", "Can you explain relativity like I'm in high school?"],
    ["🧭", "Harriet Tubman", "Underground Railroad", "How did you find your way north in the dark?"],
    ["🎨", "Leonardo da Vinci", "Artist and inventor", "Which of your inventions are you proudest of?"],
    ["💻", "Ada Lovelace", "First computer program", "What did you think computers could do one day?"],
    ["✊", "Martin Luther King Jr.", "Civil rights leader", "What gave you hope during the hardest days?"],
    ["🍎", "Isaac Newton", "Laws of motion, gravity", "What are your three laws of motion?"],
    ["🇺🇸", "George Washington", "1st U.S. president", "Why did you step down after two terms?"],
    ["📜", "William Shakespeare", "Playwright and poet", "Where did you get the idea for Romeo and Juliet?"],
    ["✈️", "Amelia Earhart", "Aviation pioneer", "What was it like to fly across the Atlantic alone?"],
    ["🏛️", "Cleopatra", "Last pharaoh of Egypt", "How did you keep Egypt independent from Rome?"],
  ];

  const style = document.createElement("style");
  style.textContent = `
    #persona-dialog .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin: 14px 0; }
    #persona-dialog .person { display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; border-radius: 12px; }
    #persona-dialog .person .face { font-size: 1.5em; }
    #persona-dialog .person b { display: block; font-weight: 600; }
    #persona-dialog .person small { color: var(--muted); }
    #persona-dialog .custom { display: flex; gap: 8px; }
    #persona-dialog .custom input { flex: 1; min-width: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--bg); color: var(--text); font: inherit; font-size: 0.92em; outline: none; }
    #persona-dialog .custom input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow); }
    #role-bar { display: flex; align-items: center; gap: 8px; margin: 0 auto 8px; padding: 6px 8px 6px 14px; max-width: 760px;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); background: var(--accent-soft); border-radius: 12px; font-size: 0.86em; }
    #role-bar[hidden] { display: none; }
    #role-bar .grow { flex: 1; }
    #role-bar small { color: var(--muted); }
    #role-bar button { font-size: 0.95em; padding: 2px 10px; }`;
  document.head.append(style);

  let pending = null; // picked on the welcome screen, before the chat exists

  const face = (name) => PEOPLE.find((p) => p[1] === name)?.[0] || "🎭";
  const who = () => currentChat()?.persona || (currentChat() ? null : pending);

  // ---------- The picker ----------

  const customInput = el("input", { type: "text", maxlength: "60", placeholder: "Or type anyone from history or a book",
    "aria-label": "Someone else to talk to" });
  const dialog = el("dialog", { id: "persona-dialog", "aria-labelledby": "persona-title" },
    el("div", { class: "dialog-head" },
      el("h2", { id: "persona-title" }, "🎭 Talk to someone from history"),
      el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
    el("p", { class: "note" }, "The AI answers as them, so you can interview them for a project. It's role-play: check important facts."),
    el("div", { class: "people" }, ...PEOPLE.map(([icon, name, about, starter]) =>
      el("button", { class: "person", onclick: () => pick(name, starter) },
        el("span", { class: "face", "aria-hidden": "true" }, icon),
        el("span", {}, el("b", {}, name), el("small", {}, about))))),
    el("form", { class: "custom", onsubmit: (e) => { e.preventDefault(); pick(customInput.value, ""); } },
      customInput, el("button", { class: "primary", type: "submit" }, "Talk")));
  document.body.append(dialog);

  function pick(name, starter) {
    name = name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (name.length < 2) return customInput.focus();
    if (controller) return toast("Wait for the answer to finish, or press Stop.");
    dialog.close();
    if (currentChat()?.messages.length) $("new-chat").click(); // a fresh chat, so earlier answers don't mix in
    pending = name;
    draw();
    inputEl.value = starter || `Hello! Tell me about yourself and your life's work.`;
    autoResize();
    inputEl.focus();
  }

  function stop() {
    const chat = currentChat();
    if (chat?.persona) { delete chat.persona; saveChats(); }
    pending = null;
    draw();
    toast("Role-play is off. The AI answers as itself again.");
  }

  // ---------- The chip and the bar above the message box ----------

  const chip = el("button", { type: "button", id: "persona-toggle", class: "chip",
    title: "Interview a famous person: the AI answers as them" }, "🎭 Talk to...");
  chip.addEventListener("click", () => { customInput.value = ""; dialog.showModal(); });
  $("think-toggle").after(chip);

  const bar = el("div", { id: "role-bar", hidden: true });
  $("composer").before(bar);
  const normalPlaceholder = inputEl.placeholder;

  function draw() {
    const name = who();
    chip.setAttribute("aria-pressed", String(!!name));
    bar.hidden = !name;
    inputEl.placeholder = name ? `Ask ${name} anything...` : normalPlaceholder;
    if (!name) return;
    bar.replaceChildren(
      el("span", { "aria-hidden": "true" }, face(name)),
      el("span", { class: "grow" }, "Talking to ", el("b", {}, name), " ", el("small", {}, "· role-play, check facts")),
      el("button", { type: "button", onclick: () => { customInput.value = ""; dialog.showModal(); } }, "Change"),
      el("button", { type: "button", onclick: stop }, "End"));
  }

  // Redraw when another chat opens; a pick only waits for the chat that's about to start.
  new MutationObserver(() => {
    if (currentChat()) pending = null;
    draw();
  }).observe(messagesEl, { childList: true });

  // Tell the server who the chat is with on chat replies (the requests that carry the model settings),
  // not on helpers like titles, flashcards or translations.
  const send = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const chat = currentChat();
    if (pending && chat && !chat.persona && chat.messages.filter((m) => m.role === "user").length === 1) {
      chat.persona = pending; // the first message of the chat picked on the welcome screen
      saveChats();
    }
    const name = chat?.persona;
    if (name && url === "/api/chat" && init?.method === "POST" && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if ("settings_by_model" in body) init = { ...init, body: JSON.stringify({ ...body, persona: name }) };
      } catch {}
    }
    return send(url, init);
  };

  draw();
})();
