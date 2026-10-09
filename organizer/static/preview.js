// "After" preview on the organizer page: shows the folder the way it will look once the
// ticked moves are applied, and updates as boxes are ticked or unticked.

(() => {
  const moves = document.getElementById("moves");
  const box = document.createElement("div");
  box.id = "preview";
  document.querySelector("#plan .table-wrap").before(box);

  function ticked() {
    return [...moves.querySelectorAll("tr")]
      .filter((tr) => tr.querySelector("input:checked"))
      .map((tr) => ({ from: tr.cells[1].textContent, to: tr.cells[2].textContent }));
  }

  function line(icon, name, count, total) {
    const row = document.createElement("summary");
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = `${icon} ${name}`;
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.width = `${Math.max(4, Math.round((count / total) * 100))}%`;
    const n = document.createElement("span");
    n.className = "count";
    n.textContent = `${count} file${count === 1 ? "" : "s"}`;
    const track = document.createElement("span");
    track.className = "track";
    track.append(bar);
    row.append(label, track, n);
    return row;
  }

  function render() {
    box.innerHTML = "";
    if (typeof plan === "undefined" || !plan || !plan.moves.length) return;
    const chosen = ticked();
    const groups = new Map();
    for (const m of chosen) {
      const cut = m.to.lastIndexOf("/");
      const dir = cut < 0 ? "" : m.to.slice(0, cut);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(m.to.slice(cut + 1));
    }
    const total = plan.total_files || plan.moves.length;
    const staying = total - chosen.length;
    const top = plan.folder.split(/[\\/]/).filter(Boolean).pop() || plan.folder;

    const title = document.createElement("h3");
    title.textContent = `After: ${top} will look like this`;
    box.append(title);
    if (!chosen.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nothing is ticked, so nothing will move.";
      box.append(p);
      return;
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [dir, names] of sorted) {
      const item = document.createElement("details");
      item.append(line("📁", dir || "(top level, renamed)", names.length, total));
      const list = document.createElement("ul");
      for (const name of names.sort((a, b) => a.localeCompare(b))) {
        const li = document.createElement("li");
        li.textContent = name;
        list.append(li);
      }
      item.append(list);
      box.append(item);
    }
    if (staying > 0) {
      const item = document.createElement("details");
      item.className = "staying";
      item.append(line("📄", "Left where they are", staying, total));
      box.append(item);
    }
  }

  // The page rebuilds the table for each new plan, and check boxes fire "change" events
  // (the Select all box sends ones that don't bubble, so listen in the capture phase).
  new MutationObserver(render).observe(moves, { childList: true });
  document.addEventListener("change", (e) => { if (moves.contains(e.target)) render(); }, true);
})();
