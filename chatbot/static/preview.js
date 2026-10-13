// "▶ Run" on HTML code blocks: shows the page the AI wrote (a game, a website, a quiz) right
// inside the app. It runs in a locked-down frame: no internet, no access to the app or your files.
(() => {
  const HTML_LANGS = ["html", "htm", "xhtml"];
  const CSS_LANGS = ["css"];
  const JS_LANGS = ["js", "javascript"];
  // Blocks every network request and plugin. Inline styles, inline scripts and pictures drawn
  // by the page still work. The page can't loosen this; a second policy only adds limits.
  const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    + "img-src data: blob:; media-src data: blob:; font-src data:";

  const style = document.createElement("style");
  style.textContent = `
    .content pre .run { position: absolute; top: 6px; right: 66px; font-size: 11px; padding: 2px 9px; color: #d0cec6;
      background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.12); border-radius: 6px; }
    .content pre .run:hover { background: rgba(255, 255, 255, 0.14); }
    #preview-dialog { width: min(960px, 94vw); max-width: none; }
    #preview-dialog iframe { width: 100%; height: min(640px, 70vh); border: 1px solid var(--border); border-radius: 10px; background: #fff; }
    #preview-dialog .dialog-head .actions { display: flex; gap: 8px; align-items: center; }`;
  document.head.append(style);

  function langOf(pre) {
    return (pre.querySelector(".lang")?.textContent || "").trim().toLowerCase();
  }

  function isPage(pre) {
    if (HTML_LANGS.includes(langOf(pre))) return true;
    const code = pre.querySelector("code")?.textContent.trimStart().toLowerCase() || "";
    return !langOf(pre) && (code.startsWith("<!doctype html") || code.startsWith("<html"));
  }

  // Small models often put the HTML, CSS and JavaScript in separate blocks, so the
  // CSS and JavaScript blocks from the same answer are added to the page too.
  function buildPage(pre) {
    let page = pre.querySelector("code").textContent;
    const blocks = [...pre.closest(".content").querySelectorAll("pre")].filter((p) => p !== pre);
    const pick = (langs) => blocks.filter((p) => langs.includes(langOf(p))).map((p) => p.querySelector("code").textContent);
    const css = pick(CSS_LANGS).map((c) => `<style>\n${c}\n</style>`).join("\n");
    const js = pick(JS_LANGS).map((c) => `<script>\n${c.replace(/<\/script/gi, "<\\/script")}\n<\/script>`).join("\n");
    if (css) page = /<\/head>/i.test(page) ? page.replace(/<\/head>/i, `${css}\n</head>`) : css + "\n" + page;
    if (js) page = /<\/body>/i.test(page) ? page.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${js}\n</body>`) : page + "\n" + js;
    // The rule goes right after <!DOCTYPE html>; anything before the doctype would put the page in an old layout mode.
    const doctype = page.match(/^\s*<!doctype[^>]*>/i)?.[0] || "";
    return `${doctype}<meta http-equiv="Content-Security-Policy" content="${POLICY}">${page.slice(doctype.length)}`;
  }

  let dialog = null;
  function openPreview(pre) {
    if (!dialog) {
      dialog = el("dialog", { id: "preview-dialog", "aria-labelledby": "preview-title" },
        el("div", { class: "dialog-head" },
          el("h2", { id: "preview-title" }, "Preview"),
          el("div", { class: "actions" },
            el("button", { onclick: () => show(dialog.page) }, "↻ Restart"),
            el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"))),
        el("p", { class: "note" }, "This runs the code from the answer in a safe box. It can't use the internet, "
          + "your files or this app, so pages that load things from the web won't fully work."),
        el("iframe", { title: "Preview of the code", sandbox: "allow-scripts allow-modals" }));
      // Closing the preview stops the page, so a game's sound or timers don't keep running.
      dialog.addEventListener("close", () => { dialog.querySelector("iframe").srcdoc = ""; });
      document.body.append(dialog);
    }
    dialog.page = buildPage(pre);
    show(dialog.page);
    dialog.showModal();
  }

  function show(page) {
    const frame = dialog.querySelector("iframe");
    frame.srcdoc = "";
    requestAnimationFrame(() => { frame.srcdoc = page; frame.focus(); });
  }

  function addButtons(root) {
    root.querySelectorAll(".content pre").forEach((pre) => {
      if (pre.querySelector(".run") || !isPage(pre)) return;
      pre.querySelector(".copy")?.before(el("button", { class: "run", type: "button", title: "Run this page here" }, "▶ Run"));
    });
  }

  messagesEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("run")) openPreview(e.target.closest("pre"));
  });
  // Answers are redrawn as they stream in, so keep adding the button to new code blocks.
  new MutationObserver(() => addButtons(messagesEl)).observe(messagesEl, { childList: true, subtree: true });
  addButtons(messagesEl);
})();
