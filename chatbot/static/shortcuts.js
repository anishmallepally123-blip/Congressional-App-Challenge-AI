// Prompt shortcuts: type "/" in the message box to pick a ready-made prompt,
// like /summarize or /quiz, or one you saved yourself. They're kept in this browser.

(() => {
  const KEY = "local-ai-shortcuts";
  const BUILT_IN = [
    { name: "summarize", text: "Summarize this in a few short bullet points:\n\n" },
    { name: "explain", text: "Explain this simply, like I'm 12 years old:\n\n" },
    { name: "quiz", text: "Make a 5-question multiple-choice quiz about this, with the answers at the end:\n\n" },
    { name: "grammar", text: "Fix the spelling and grammar in this, then list what you changed:\n\n" },
    { name: "translate", text: "Translate this into Spanish:\n\n" },
    { name: "email", text: "Write a short, polite email about this:\n\n" },
    { name: "flashcards", text: "Turn this into flashcards, one per line as: question | answer\n\n" },
  ];

  const input = document.getElementById("input");
  const composer = document.getElementById("composer");
  const menu = document.createElement("div");
  menu.id = "shortcut-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  composer.prepend(menu);

  let matches = [];
  let active = 0;

  const saved = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(list) ? list.filter((s) => s && s.name && s.text) : [];
    } catch { return []; }
  };
  const store = (list) => {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window: not kept */ }
  };
  const cleanName = (name) => (name || "").trim().toLowerCase().replace(/^\/+/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  const all = () => {
    const mine = saved();
    return [...mine.map((s) => ({ ...s, mine: true })), ...BUILT_IN.filter((b) => !mine.some((s) => s.name === b.name))];
  };

  // The word being typed when the box holds only "/something", or null.
  const typed = () => {
    const m = /^\/([a-z0-9-]*)$/i.exec(input.value);
    return m ? m[1].toLowerCase() : null;
  };

  function close() {
    menu.hidden = true;
    matches = [];
  }

  function render() {
    const word = typed();
    if (word === null) return close();
    matches = all().filter((s) => s.name.startsWith(word));
    active = Math.min(active, Math.max(0, matches.length - 1));
    menu.replaceChildren();
    matches.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "shortcut" + (i === active ? " active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === active);
      const name = document.createElement("b");
      name.textContent = "/" + s.name;
      const preview = document.createElement("span");
      preview.textContent = s.text.replace(/\s+/g, " ").trim();
      row.append(name, preview);
      if (s.mine) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "delete";
        del.title = `Delete /${s.name}`;
        del.setAttribute("aria-label", `Delete /${s.name}`);
        del.textContent = "✕";
        del.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          store(saved().filter((x) => x.name !== s.name));
          render();
        });
        row.append(del);
      }
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(s); });
      menu.append(row);
    });
    const add = document.createElement("div");
    add.className = "shortcut add";
    add.textContent = "＋ Save your own shortcut...";
    add.addEventListener("mousedown", (e) => { e.preventDefault(); saveNew(word); });
    menu.append(add);
    menu.hidden = false;
  }

  function pick(s) {
    input.value = s.text;
    input.dispatchEvent(new Event("input")); // resizes the box
    close();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function saveNew(word) {
    const name = cleanName(prompt("Name for the shortcut (you'll type /name):", word || ""));
    if (!name) return;
    const text = prompt(`What should /${name} put in the message box?`, "");
    if (!text || !text.trim()) return;
    const list = saved().filter((s) => s.name !== name);
    list.unshift({ name, text: text.trim() + "\n\n" });
    store(list.slice(0, 30));
    input.value = "/" + name;
    render();
    input.focus();
  }

  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("blur", close);
  // Runs before the page's own Enter-to-send, so Enter picks a shortcut while the menu is open.
  composer.addEventListener("keydown", (e) => {
    if (menu.hidden || e.target !== input) return;
    const options = matches.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options) return;
      active = (active + (e.key === "ArrowDown" ? 1 : options - 1)) % options;
      render();
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.isComposing) {
      if (options) pick(matches[active]);
      else if (e.key === "Tab") return;
      else return close(); // no match: send "/word" as a normal message
    } else if (e.key === "Escape") {
      close();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
