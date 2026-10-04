// Organizer page: ask for a plan, let the user approve it, apply it, and undo past runs.

const $ = (id) => document.getElementById(id);
const MODEL_KEY = "local-ai-model"; // shared with the chat page so the same model is picked
let plan = null;

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

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

// ---------- Models ----------

async function loadModels() {
  try {
    const { models } = await api("/api/models");
    for (const name of models) $("model").add(new Option(name, name));
    const saved = localStorage.getItem(MODEL_KEY);
    $("model").value = saved && models.includes(saved) ? saved : models[0] || "";
  } catch (err) {
    $("form-note").textContent = err.message;
  }
}

// ---------- Making a plan ----------

document.querySelectorAll("[data-folder]").forEach((b) =>
  b.addEventListener("click", () => ($("folder").value = b.dataset.folder)));

$("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const note = $("form-note");
  $("make-plan").disabled = true;
  note.className = "muted";
  note.textContent = $("model").value ? "The AI is looking at your files..." : "Sorting by type...";
  try {
    showPlan(await api("/api/organizer/plan", {
      folder: $("folder").value,
      model: $("model").value || null,
      request: $("request").value,
    }));
    note.textContent = "";
  } catch (err) {
    note.className = "error";
    note.textContent = err.message;
  } finally {
    $("make-plan").disabled = false;
  }
});

function showPlan(p) {
  plan = p;
  $("plan").hidden = false;
  $("plan-summary").textContent = `${p.folder}: ${p.summary || ""} (${p.moves.length} changes)`;
  $("plan-note").textContent = p.note || (p.model ? `Planned by ${p.model}.` : "");
  $("apply-note").textContent = "";
  $("apply").disabled = !p.moves.length || p.status !== "pending";
  $("check-all").checked = true;

  const body = $("moves");
  body.innerHTML = "";
  if (!p.moves.length) {
    const tr = document.createElement("tr");
    tr.append(cell(""), cell("This folder already looks tidy. Nothing to move."));
    body.append(tr);
  }
  for (const m of p.moves) {
    const tr = document.createElement("tr");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.value = m.from;
    box.addEventListener("change", () => tr.classList.toggle("off", !box.checked));
    const first = document.createElement("td");
    first.append(box);
    tr.append(first, cell(m.from, "path"), cell(m.to, "path"), cell(m.reason, "why"));
    body.append(tr);
  }

  const skipped = $("skipped");
  skipped.innerHTML = "";
  for (const s of p.skipped || []) {
    const li = document.createElement("li");
    li.textContent = s;
    skipped.append(li);
  }
  $("skipped-wrap").hidden = !(p.skipped || []).length;
  $("plan").scrollIntoView({ behavior: "smooth" });
}

$("check-all").addEventListener("change", () => {
  document.querySelectorAll("#moves input[type=checkbox]").forEach((box) => {
    box.checked = $("check-all").checked;
    box.dispatchEvent(new Event("change"));
  });
});

$("cancel").addEventListener("click", () => {
  plan = null;
  $("plan").hidden = true;
});

// ---------- Applying ----------

$("apply").addEventListener("click", async () => {
  const approved = [...document.querySelectorAll("#moves input:checked")].map((b) => b.value);
  if (!approved.length) return;
  if (!confirm(`Move ${approved.length} file(s) in ${plan.folder}? You can undo this afterwards.`)) return;
  $("apply").disabled = true;
  try {
    const run = await api("/api/organizer/apply", { plan_id: plan.id, approved });
    const problems = run.problems.length ? ` ${run.problems.length} skipped: ${run.problems.join("; ")}` : "";
    $("apply-note").className = "muted";
    $("apply-note").textContent = `Done. Moved ${run.moves.length} file(s).${problems}`;
    loadRuns();
  } catch (err) {
    $("apply-note").className = "error";
    $("apply-note").textContent = err.message;
    $("apply").disabled = false;
  }
});

// ---------- Undo ----------

async function loadRuns() {
  const list = $("runs");
  try {
    const { runs } = await api("/api/organizer/runs");
    list.innerHTML = runs.length ? "" : '<li class="muted">Nothing yet.</li>';
    for (const r of runs) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      const when = new Date(r.applied * 1000).toLocaleString();
      label.textContent = `${when}: moved ${r.count} file(s) in ${r.folder}`;
      li.append(label);
      if (r.status === "undone") {
        const done = document.createElement("em");
        done.className = "muted";
        done.textContent = "undone";
        li.append(done);
      } else {
        const undo = document.createElement("button");
        undo.textContent = "Undo";
        undo.onclick = () => undoRun(r, undo);
        li.append(undo);
      }
      list.append(li);
    }
  } catch (err) {
    list.innerHTML = "";
    const li = document.createElement("li");
    li.className = "error";
    li.textContent = err.message;
    list.append(li);
  }
}

async function undoRun(run, button) {
  if (!confirm(`Put the ${run.count} file(s) back where they were in ${run.folder}?`)) return;
  button.disabled = true;
  try {
    const report = await api("/api/organizer/undo", { run_id: run.id });
    if (report.problems.length) alert(`Restored ${report.restored}. Not restored:\n${report.problems.join("\n")}`);
  } catch (err) {
    alert(err.message);
  }
  loadRuns();
}

// ---------- Start ----------

const params = new URLSearchParams(location.search);
if (params.get("folder")) $("folder").value = params.get("folder");
// The chatbot can link straight to a plan it made: /organizer?plan=<id>
if (params.get("plan")) api(`/api/organizer/plan/${params.get("plan")}`).then(showPlan).catch(() => {});
loadModels();
loadRuns();
