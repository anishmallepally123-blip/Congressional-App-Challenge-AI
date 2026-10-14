// "⬇ Save" on code blocks: downloads the code as a ready-to-run file with the right name and
// extension (snake-game.py, index.html, HelloWorld.java), so students don't have to copy, paste and rename.
(() => {
  const EXTENSIONS = {
    python: "py", py: "py", python3: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts",
    html: "html", htm: "html", css: "css", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs",
    json: "json", csv: "csv", markdown: "md", md: "md", text: "txt", txt: "txt", plaintext: "txt",
    bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", ps1: "ps1", batch: "bat", bat: "bat", cmd: "bat",
    sql: "sql", go: "go", rust: "rs", rs: "rs", ruby: "rb", rb: "rb", php: "php", swift: "swift",
    kotlin: "kt", kt: "kt", r: "r", lua: "lua", xml: "xml", svg: "svg", yaml: "yml", yml: "yml", toml: "toml",
    jsx: "jsx", tsx: "tsx", scratch: "txt", arduino: "ino", ino: "ino",
  };

  const style = document.createElement("style");
  style.textContent = `
    .content pre .save { position: absolute; top: 6px; right: 66px; font-size: 11px; padding: 2px 9px; color: #d0cec6;
      background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.12); border-radius: 6px; }
    .content pre .save:hover { background: rgba(255, 255, 255, 0.14); }
    .content pre:has(.run) .save { right: 124px; }`;
  document.head.append(style);

  const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  // Pick a file name a beginner can run straight away.
  function fileName(code, lang) {
    lang = lang.toLowerCase();
    let ext = EXTENSIONS[lang];
    if (!ext) {
      const start = code.trimStart().toLowerCase();
      if (start.startsWith("<!doctype html") || start.startsWith("<html")) ext = "html";
      else if (/^(import |from \w+ import |def |print\()/m.test(code)) ext = "py";
      else ext = "txt";
    }
    // Java only compiles when the file is named after its public class.
    if (ext === "java") {
      const cls = code.match(/public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)/);
      if (cls) return `${cls[1]}.java`;
    }
    if (ext === "html") {
      const title = code.match(/<title>([^<]*)<\/title>/i)?.[1];
      if (title && slug(title)) return `${slug(title)}.html`;
    }
    const chat = currentChat();
    const name = chat && chat.title !== "New chat" ? slug(chat.title) : "";
    return `${name || "code"}.${ext}`;
  }

  function save(pre) {
    const code = pre.querySelector("code").textContent;
    const name = fileName(code, (pre.querySelector(".lang")?.textContent || "").trim());
    const url = URL.createObjectURL(new Blob([code.endsWith("\n") ? code : code + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = el("a", { href: url, download: name, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Saved ${name} to your Downloads folder.`);
  }

  function decorate() {
    for (const pre of messagesEl.querySelectorAll(".content pre")) {
      if (pre.querySelector(".save") || !pre.querySelector("code")) continue;
      pre.querySelector(".copy")?.before(el("button", { class: "save", type: "button", title: "Download this code as a file" }, "⬇ Save"));
    }
  }

  messagesEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("save") && e.target.closest("pre")) save(e.target.closest("pre"));
  });
  // Answers are redrawn as they stream in, so add the button whenever the messages change.
  new MutationObserver(decorate).observe(messagesEl, { childList: true, subtree: true });
  decorate();
})();
