// "🗣️ Practice a language": the AI becomes a conversation partner in the language a student is
// learning, at their level, and points out their mistakes after each reply. Talking practice usually
// needs a tutor or a cloud app; here it runs on the student's own computer. The instructions live in
// personal.py (language_practice); this file adds the picker and tells the server about the chat.
(() => {
  const LANGUAGES = [
    ["🇪🇸", "Spanish", "¡Hola! Me llamo... ¿Cómo estás?"],
    ["🇫🇷", "French", "Bonjour ! Je m'appelle... Comment ça va ?"],
    ["🇩🇪", "German", "Hallo! Ich heiße... Wie geht es dir?"],
    ["🇮🇹", "Italian", "Ciao! Mi chiamo... Come stai?"],
    ["🇧🇷", "Portuguese", "Olá! Meu nome é... Tudo bem?"],
    ["🇨🇳", "Chinese (Mandarin)", "你好！我叫…… 你好吗？"],
    ["🇯🇵", "Japanese", "こんにちは！私の名前は…です。お元気ですか？"],
    ["🇰🇷", "Korean", "안녕하세요! 제 이름은 ...입니다. 잘 지내세요?"],
    ["🇮🇳", "Hindi", "नमस्ते! मेरा नाम ... है। आप कैसे हैं?"],
    ["🇸🇦", "Arabic", "مرحبا! اسمي ... كيف حالك؟"],
    ["🇺🇸", "English", "Hi! My name is... How are you?"],
  ];
  const LEVELS = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]];

  const style = document.createElement("style");
  style.textContent = `
    #practice-dialog .levels { margin: 14px 0 4px; flex-wrap: wrap; gap: 8px; }
    #practice-dialog .languages { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 12px 0 0; }
    #practice-dialog .segmented button { padding: 4px 9px; font-size: 0.86em; }
    #practice-dialog .language { display: flex; align-items: center; gap: 8px; min-width: 0; text-align: left; padding: 10px; border-radius: 12px; font-weight: 600; font-size: 0.95em; }
    #practice-dialog .language .flag { font-size: 1.4em; }
    #practice-bar { display: flex; align-items: center; gap: 8px; margin: 0 auto 8px; padding: 6px 8px 6px 14px; max-width: 760px;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); background: var(--accent-soft); border-radius: 12px; font-size: 0.86em; }
    #practice-bar[hidden] { display: none; }
    #practice-bar .grow { flex: 1; }
    #practice-bar small { color: var(--muted); }
    #practice-bar button { font-size: 0.95em; padding: 2px 10px; }`;
  document.head.append(style);

  let pending = null; // picked on the welcome screen, before the chat exists
  let level = "beginner";

  const flag = (language) => LANGUAGES.find((l) => l[1] === language)?.[0] || "🗣️";
  const levelName = (value) => LEVELS.find((l) => l[0] === value)?.[1] || "Beginner";
  const current = () => currentChat()?.practice || (currentChat() ? null : pending);

  // ---------- The picker ----------

  const levelButtons = LEVELS.map(([value, label]) => {
    const b = el("button", { type: "button", "data-value": value }, label);
    b.addEventListener("click", () => { level = value; paintLevels(); });
    return b;
  });
  function paintLevels() {
    levelButtons.forEach((b) => b.classList.toggle("on", b.dataset.value === level));
  }
  const dialog = el("dialog", { id: "practice-dialog", "aria-labelledby": "practice-title" },
    el("div", { class: "dialog-head" },
      el("h2", { id: "practice-title" }, "🗣️ Practice a language"),
      el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
    el("p", { class: "note" }, "Chat with the AI in the language you're learning. After each reply it shows ✏️ corrections for any mistakes you made."),
    el("div", { class: "setting levels" }, el("span", {}, "Your level"), el("div", { class: "segmented" }, ...levelButtons)),
    el("div", { class: "languages" }, ...LANGUAGES.map(([icon, language, starter]) =>
      el("button", { class: "language", onclick: () => pick(language, starter) },
        el("span", { class: "flag", "aria-hidden": "true" }, icon), language))));
  document.body.append(dialog);

  function open() {
    level = current()?.level || level;
    paintLevels();
    dialog.showModal();
  }

  function pick(language, starter) {
    if (controller) return toast("Wait for the answer to finish, or press Stop.");
    dialog.close();
    const chat = currentChat();
    if (chat?.practice && chat.practice.language === language) { // same chat, new level
      chat.practice.level = level;
      saveChats();
      draw();
      return toast(`Level set to ${levelName(level)}.`);
    }
    if (chat?.messages.length) $("new-chat").click(); // a fresh chat for the new language
    pending = { language, level };
    draw();
    inputEl.value = starter;
    autoResize();
    inputEl.focus();
  }

  function stop() {
    const chat = currentChat();
    if (chat?.practice) { delete chat.practice; saveChats(); }
    pending = null;
    draw();
    toast("Language practice is off.");
  }

  // ---------- The chip and the bar above the message box ----------

  const chip = el("button", { type: "button", id: "practice-toggle", class: "chip",
    title: "Practice speaking a language with the AI, with corrections" }, "🗣️ Practice a language");
  chip.addEventListener("click", open);
  $("think-toggle").after(chip);

  const bar = el("div", { id: "practice-bar", hidden: true });
  $("composer").before(bar);
  const normalPlaceholder = inputEl.placeholder;

  function draw() {
    const p = current();
    chip.setAttribute("aria-pressed", String(!!p));
    bar.hidden = !p;
    if (!p) {
      if (inputEl.placeholder.startsWith("Write in ")) inputEl.placeholder = normalPlaceholder;
      return;
    }
    inputEl.placeholder = `Write in ${p.language}...`;
    bar.replaceChildren(
      el("span", { "aria-hidden": "true" }, flag(p.language)),
      el("span", { class: "grow" }, "Practicing ", el("b", {}, p.language), " ", el("small", {}, `· ${levelName(p.level)}`)),
      el("button", { type: "button", onclick: open }, "Change"),
      el("button", { type: "button", onclick: stop }, "End"));
  }

  // Redraw when another chat opens; a pick only waits for the chat that's about to start.
  new MutationObserver(() => {
    if (currentChat()) pending = null;
    draw();
  }).observe(messagesEl, { childList: true });

  // Tell the server about the practice on chat replies (the requests that carry the model settings),
  // not on helpers like titles, flashcards or translations.
  const send = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const chat = currentChat();
    if (pending && chat && !chat.practice && chat.messages.filter((m) => m.role === "user").length === 1) {
      chat.practice = pending; // the first message of the chat picked on the welcome screen
      saveChats();
    }
    const practice = chat?.practice;
    if (practice && url === "/api/chat" && init?.method === "POST" && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if ("settings_by_model" in body) init = { ...init, body: JSON.stringify({ ...body, practice }) };
      } catch {}
    }
    return send(url, init);
  };

  draw();
})();
