// A one-time tip on phones: put the app on the home screen so it opens like a real app.
// It sits under the top bar so it never covers the message box.
// The page knows it's on a phone once app.js adds the "on-phone" class to <body>.
(function () {
  const KEY = "local-ai-homescreen-tip";
  let installEvent = null;

  function seen() {
    try { return localStorage.getItem(KEY) === "done"; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(KEY, "done"); } catch (e) {}
  }
  function alreadyAnApp() {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }

  // Chrome on Android offers its own install prompt when it can.
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; });

  const style = document.createElement("style");
  style.textContent = `
    #homescreen-tip { position: fixed; left: 12px; right: 12px; top: 64px; z-index: 50;
      display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 14px;
      background: var(--panel, #fff); color: var(--text); border: 1px solid var(--border);
      box-shadow: 0 8px 28px rgba(0,0,0,.18); font-size: 14px; line-height: 1.35; }
    #homescreen-tip img { width: 40px; height: 40px; border-radius: 10px; flex: none; }
    #homescreen-tip p { margin: 0; flex: 1; }
    #homescreen-tip b { font-weight: 600; }
    #homescreen-tip button { flex: none; }
    #homescreen-tip .close { background: none; border: none; font-size: 20px; color: var(--muted, inherit); padding: 4px 6px; cursor: pointer; }
  `;
  document.head.append(style);

  function show() {
    if (seen() || alreadyAnApp() || document.getElementById("homescreen-tip")) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const how = ios
      ? "Tap the Share button <b>⬆︎</b>, then <b>Add to Home Screen</b>."
      : "Open your browser menu <b>⋮</b>, then tap <b>Add to Home screen</b>.";

    const tip = document.createElement("div");
    tip.id = "homescreen-tip";
    tip.setAttribute("role", "dialog");
    tip.setAttribute("aria-label", "Add to home screen");
    tip.innerHTML = `<img src="/icons/icon-192.png" alt="">
      <p><b>Open this like an app.</b> ${how}</p>`;
    const close = () => { remember(); tip.remove(); };
    if (installEvent) {
      const add = document.createElement("button");
      add.className = "primary";
      add.textContent = "Add";
      add.onclick = async () => { installEvent.prompt(); await installEvent.userChoice; close(); };
      tip.append(add);
    }
    const x = document.createElement("button");
    x.className = "close";
    x.title = "Don't show this again";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.onclick = close;
    tip.append(x);
    document.body.append(tip);
  }

  function check() {
    if (document.body.classList.contains("on-phone")) { show(); return true; }
    return false;
  }
  if (!check()) {
    const watch = new MutationObserver(() => { if (check()) watch.disconnect(); });
    watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
})();
