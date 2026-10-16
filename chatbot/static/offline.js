// When the computer loses its internet connection, say so, and show that the chat keeps working:
// the AI runs on this computer, so nothing here needs the internet except downloading new models.
// Phones are left out, since they reach the AI over the Wi-Fi and can't chat without it.
(function () {
  const style = document.createElement("style");
  style.textContent = `
    #offline-pill { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 11px; border-radius: 999px; font-size: 0.78em; font-weight: 600; white-space: nowrap;
      background: var(--accent-soft); color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); cursor: help; }
    #offline-pill.back { background: transparent; color: var(--muted); border-color: var(--border); }
    #offline-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    body.on-phone #offline-pill { display: none; }
  `;
  document.head.append(style);

  const pill = document.createElement("span");
  pill.id = "offline-pill";
  pill.setAttribute("role", "status");
  pill.hidden = true;
  document.querySelector("main > header").append(pill);

  let hideTimer;
  function update(announce) {
    clearTimeout(hideTimer);
    pill.classList.remove("back");
    if (!navigator.onLine) {
      pill.innerHTML = '<span class="dot"></span>Offline · AI still works';
      pill.title = "There's no internet, but the AI runs on this computer, so you can keep chatting. " +
        "Only downloading new models needs the internet.";
      pill.hidden = false;
      if (announce) toast("You're offline. Your AI still works, because it runs on this computer.");
    } else if (announce && !pill.hidden) {
      pill.textContent = "Back online";
      pill.title = "";
      pill.classList.add("back");
      hideTimer = setTimeout(() => (pill.hidden = true), 4000);
    } else {
      pill.hidden = true;
    }
  }

  window.addEventListener("offline", () => update(true));
  window.addEventListener("online", () => update(true));
  update(false);
})();
