// Shared Files page: opt folders in or out, re-check them, and preview what the AI would find.

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const resp = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
  return data;
}

function showNote(el, text, isError) {
  el.className = isError ? "error" : "muted";
  el.textContent = text;
}

// ---------- Shared folders ----------

function renderFolders(folders) {
  const list = $("folders");
  list.innerHTML = "";
  if (!folders.length) {
    list.innerHTML = '<li class="muted">Nothing is shared. The AI can\'t see any of your files.</li>';
  }
  for (const f of folders) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const when = f.scanned ? new Date(f.scanned * 1000).toLocaleTimeString() : "never";
    let text = `${f.folder}: ${f.files} files, ${f.read} readable (checked ${when})`;
    if (f.private) text += `, ${f.private} private file(s) skipped`;
    if (f.truncated) text += ". Only the first files were read; share a smaller folder for best results";
    if (f.missing) text += ". This folder can't be found right now";
    label.textContent = text;
    const stop = document.createElement("button");
    stop.textContent = "Stop sharing";
    stop.onclick = async () => {
      if (!confirm(`Stop sharing ${f.folder}? The AI will forget what it read there. Your files are not touched.`)) return;
      renderFolders((await api("/api/files/unshare", { folder: f.folder })).folders);
    };
    li.append(label, stop);
    list.append(li);
  }
}

async function loadFolders() {
  try {
    renderFolders((await api("/api/files/status")).folders);
  } catch (err) {
    $("folders").textContent = err.message;
  }
}

document.querySelectorAll("[data-folder]").forEach((b) =>
  b.addEventListener("click", () => ($("folder").value = b.dataset.folder)));

$("share-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("share").disabled = true;
  showNote($("share-note"), "Reading files. A big folder can take a minute...");
  try {
    const s = await api("/api/files/share", { folder: $("folder").value });
    showNote($("share-note"), `Shared. Read ${s.read} of ${s.files} files.`);
    $("folder").value = "";
    loadFolders();
  } catch (err) {
    showNote($("share-note"), err.message, true);
  } finally {
    $("share").disabled = false;
  }
});

$("rescan").addEventListener("click", async () => {
  showNote($("rescan-note"), "Checking...");
  try {
    renderFolders((await api("/api/files/rescan", {})).folders);
    showNote($("rescan-note"), "Up to date.");
  } catch (err) {
    showNote($("rescan-note"), err.message, true);
  }
});

// ---------- Search preview ----------

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const list = $("results");
  list.innerHTML = "";
  try {
    const { results } = await api("/api/files/search", { query: $("query").value });
    if (!results.length) list.innerHTML = '<li class="muted">No matching files.</li>';
    for (const r of results) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = r.file;
      const text = document.createElement("div");
      text.className = "muted";
      text.textContent = r.text ? r.text.slice(0, 240) + (r.text.length > 240 ? "..." : "") : "(matched by name)";
      li.append(name, text);
      list.append(li);
    }
  } catch (err) {
    list.textContent = err.message;
  }
});

loadFolders();
