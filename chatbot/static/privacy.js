// Settings > Your data: shows everything the app keeps, where it is on this computer and how
// big it is, and what the app talks to over the network. Nothing here is sent anywhere.

(() => {
  if (!document.getElementById("settings-dialog")) return;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "privacy.css";
  document.head.append(css);

  function make(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  }

  function size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let n = bytes / 1024, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  // Chats live in this browser, not in a file, so measure them here.
  function browserData() {
    let bytes = 0, chats = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key.startsWith("local-ai")) continue;
        const value = localStorage.getItem(key) || "";
        bytes += new Blob([key, value]).size;
        if (key === "local-ai-chats") chats = (JSON.parse(value) || []).length;
      }
    } catch {}
    return { bytes, chats };
  }

  // A row in Settings that opens the report.
  const row = make("div", { className: "setting" },
    make("span", { textContent: "Your data" }),
    make("button", { id: "privacy-button", textContent: "See where it's kept" }));
  const settings = document.getElementById("settings-dialog");
  settings.insertBefore(row, settings.querySelector(".note"));

  const dialog = make("dialog", { id: "privacy-dialog" });
  dialog.setAttribute("aria-labelledby", "privacy-title");
  const close = make("button", { className: "icon close", textContent: "✕" });
  close.setAttribute("aria-label", "Close");
  close.onclick = () => dialog.close();
  const body = make("div", { id: "privacy-body" });
  dialog.append(make("div", { className: "dialog-head" }, make("h2", { id: "privacy-title", textContent: "Where your data is" }), close), body);
  document.body.append(dialog);

  row.querySelector("button").onclick = async () => {
    settings.close();
    body.replaceChildren(make("p", { className: "note", textContent: "Checking..." }));
    dialog.showModal();
    let data;
    try {
      const resp = await fetch("/api/privacy");
      data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
    } catch (err) {
      body.replaceChildren(make("p", { className: "note", textContent: err.message }));
      return;
    }
    render(data);
  };

  function render(data) {
    const net = data.network;
    const local = browserData();
    const places = [
      { icon: "💬", name: "Chats", path: "Saved in this browser on this computer",
        about: `${local.chats} chat${local.chats === 1 ? "" : "s"}. Delete them with Delete all chats in Settings.`, bytes: local.bytes },
      ...data.places,
    ];
    const total = places.reduce((sum, p) => sum + p.bytes, 0);

    const headline = net.ollama_local
      ? "Everything stays on this computer."
      : "Your data is kept on this computer, but the AI runs on another one.";
    const list = make("ul", { className: "privacy-list" });
    for (const p of places) {
      list.append(make("li", {},
        make("span", { className: "privacy-icon", textContent: p.icon }),
        make("div", { className: "privacy-what" },
          make("b", { textContent: p.name }),
          make("span", { className: "note", textContent: p.about }),
          make("code", { textContent: p.path })),
        make("span", { className: "privacy-size", textContent: size(p.bytes) })));
    }

    const facts = make("ul", { className: "privacy-net" },
      make("li", { textContent: net.ollama_local
        ? `✅ The AI runs on this computer through Ollama (${net.ollama}). Your messages aren't sent to any company.`
        : `⚠️ The AI runs through Ollama at ${net.ollama}, which is another computer. Your messages go there.` }),
      make("li", { textContent: net.phone
        ? "📱 Phone access is on, so phones on your Wi-Fi that entered the code can chat. Turn it off in Settings."
        : "✅ Phone access is off, so nothing else on your network can use the app." }),
      make("li", { textContent: net.connectors
        ? `🔌 ${net.connectors} connector${net.connectors === 1 ? " is" : "s are"} turned on. The AI asks before using them unless you chose Always allow. Some, like Weather or Wikipedia, look things up online.`
        : "✅ No connectors are turned on." }),
    );

    body.replaceChildren(
      make("p", { className: "privacy-headline", textContent: `🔒 ${headline}` }),
      make("p", { className: "note", textContent: `The app keeps ${size(total)} in total, all in the places below. No accounts, no cloud.` }),
      list,
      make("h3", { className: "setting-title", textContent: "What it talks to" }),
      facts);
  }
})();
