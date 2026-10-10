// Settings > Back up your chats: chats live only in this browser, so clearing the browser's
// data (or moving to a new computer) would lose them. This saves them all to one file
// and can add them back later, here or in another browser.

(() => {
  const clearAll = document.getElementById("clear-all");
  if (!clearAll) return;
  const FORMAT = "local-ai-chat-backup";

  const save = el("button", { id: "backup-save" }, "Save a backup");
  const restore = el("button", { id: "backup-restore" }, "Restore");
  const picker = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  clearAll.closest(".setting").before(
    el("div", { class: "setting" }, el("span", {}, "Back up your chats"),
      el("div", { style: "display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end" }, save, restore, picker)));

  save.addEventListener("click", () => {
    if (!chats.length) return toast("There are no chats to back up yet.");
    const backup = {
      format: FORMAT, version: 1, saved: new Date().toISOString(),
      chats, modelSettings: load(MODEL_SETTINGS_KEY, {}),
    };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const link = el("a", { href: URL.createObjectURL(blob), download: `local-ai-chat-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`Saved ${chats.length} chat${chats.length === 1 ? "" : "s"} to your Downloads folder.`);
  });

  restore.addEventListener("click", () => {
    if (controller) return toast("Wait for the answer to finish, or press Stop.");
    picker.value = "";
    picker.click();
  });

  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    let added;
    try {
      added = restoreFrom(JSON.parse(await file.text()));
    } catch (err) {
      return toast(err.message || "That file isn't a Local AI Chat backup.");
    }
    $("settings-dialog").close();
    toast(added.chats
      ? `Added ${added.chats} chat${added.chats === 1 ? "" : "s"}.${added.skipped ? ` ${added.skipped} already here.` : ""}`
      : "Every chat in that backup is already here.");
  });

  // Adds chats from a backup that aren't here yet. Nothing already here is changed.
  function restoreFrom(backup) {
    if (backup?.format !== FORMAT || !Array.isArray(backup.chats)) throw new Error("That file isn't a Local AI Chat backup.");
    const have = new Set(chats.map((c) => c.id));
    let added = 0, skipped = 0;
    for (const c of backup.chats) {
      if (!c || typeof c.id !== "string" || !Array.isArray(c.messages)) continue;
      if (have.has(c.id)) { skipped++; continue; }
      const messages = c.messages.filter((m) => m && ["user", "assistant", "tool"].includes(m.role) && typeof m.content === "string");
      chats.push({ ...c, title: String(c.title || "Restored chat").slice(0, 80), messages, updated: Number(c.updated) || Date.now() });
      have.add(c.id);
      added++;
    }
    // Model settings fill in only for models that don't have their own settings here yet.
    if (backup.modelSettings && typeof backup.modelSettings === "object") {
      const mine = load(MODEL_SETTINGS_KEY, {});
      for (const [name, value] of Object.entries(backup.modelSettings)) {
        if (!(name in mine) && value && typeof value === "object") modelSettings[name] = mine[name] = value;
      }
      store(MODEL_SETTINGS_KEY, mine);
    }
    if (added) {
      saveChats();
      renderSidebar();
      renderMain();
    }
    return { chats: added, skipped };
  }
})();
