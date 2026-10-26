// Ask about a picture: the 📷 button attaches a photo (on a phone it can open the camera)
// for models that can see, like Gemma 3. The picture is shrunk in the browser first, so it
// stays small, and it goes only to the AI on this computer.
// Loaded after app.js, so it can build on app.js's functions (send, streamReply, messageEl).

(() => {
  const MAX_SIDE = 768;    // pixels; plenty for the model, and keeps saved chats small
  const MAX_PHOTOS = 2;    // per message, the same limit the server uses
  let pending = [];        // base64 JPEGs waiting to go with the next message

  const style = document.createElement("style");
  style.textContent = `
    #photo-button { font-size: 1.05em; }
    #photo-tray { display: flex; gap: 8px; padding: 2px 2px 8px; flex-wrap: wrap; }
    #photo-tray .thumb { position: relative; }
    #photo-tray img, .photos img { height: 64px; border-radius: 10px; border: 1px solid var(--border); display: block; }
    #photo-tray button { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; padding: 0;
      border-radius: 50%; font-size: 11px; line-height: 18px; background: var(--card); border: 1px solid var(--border); }
    .photos { display: flex; gap: 6px; justify-content: flex-end; margin-bottom: 6px; flex-wrap: wrap; }
    .photos img { height: 140px; max-width: 100%; object-fit: cover; }
  `;
  document.head.append(style);

  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, hidden: true });
  const button = el("button", { type: "button", id: "photo-button", class: "icon", "aria-label": "Add a picture",
    title: "Add a picture to ask about, like a diagram or a homework problem. Needs a model that can see, like Gemma 3." }, "📷");
  const tray = el("div", { id: "photo-tray", hidden: true });
  const row = document.querySelector("#composer .composer-row");
  row.prepend(button, input);
  $("composer").prepend(tray);

  const canSee = () => (findModel(currentModel())?.capabilities || []).includes("vision");
  const notSeeing = () => toast(`${findModel(currentModel())?.label || "This model"} can't see pictures. ` +
    "Pick one that can, like Gemma 3 Small, in Models.");

  button.addEventListener("click", () => (canSee() ? input.click() : notSeeing()));
  input.addEventListener("change", async () => {
    for (const file of [...input.files].slice(0, MAX_PHOTOS - pending.length)) {
      try { pending.push(await shrink(file)); } catch { toast(`Couldn't open ${file.name} as a picture.`); }
    }
    input.value = "";
    if (pending.length && !inputEl.value.trim()) inputEl.value = "What's in this picture?";
    drawTray();
    inputEl.focus();
  });

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = Object.assign(document.createElement("canvas"),
          { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function drawTray() {
    tray.innerHTML = "";
    tray.hidden = !pending.length;
    button.disabled = pending.length >= MAX_PHOTOS;
    pending.forEach((data, i) => tray.append(el("div", { class: "thumb" },
      el("img", { src: "data:image/jpeg;base64," + data, alt: "Picture to send" }),
      el("button", { type: "button", "aria-label": "Remove picture", onclick: () => { pending.splice(i, 1); drawTray(); } }, "✕"))));
  }

  // Don't send pictures to a model that can't see them; keep them so the user can switch models.
  const originalSend = send;
  send = async function (text) {
    if (pending.length && !canSee()) {
      inputEl.value = text;
      return notSeeing();
    }
    return originalSend(text);
  };

  // The question was just added to the chat: put the pictures on it before the AI is asked.
  const originalStream = streamReply;
  streamReply = function (chat) {
    const last = chat.messages[chat.messages.length - 1];
    if (pending.length && last?.role === "user") {
      last.images = pending;
      pending = [];
      drawTray();
      saveChats();
      renderMain();
    }
    return originalStream(chat);
  };

  // Show a message's pictures above its text.
  const originalMessageEl = messageEl;
  messageEl = function (m, ...rest) {
    const node = originalMessageEl(m, ...rest);
    if (m.images?.length) {
      node.prepend(el("div", { class: "photos" }, ...m.images.map((data) =>
        el("img", { src: "data:image/jpeg;base64," + data, alt: "Picture sent with this message" }))));
    }
    return node;
  };
  renderMain();
})();
