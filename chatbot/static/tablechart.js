// "📊 Show as chart" under tables of numbers: turns a table the AI wrote (planet sizes,
// test scores, prices) into a bar chart, so the numbers are easy to compare at a glance.
(() => {
  const style = document.createElement("style");
  style.textContent = `
    .table-chart-bar { display: flex; gap: 8px; align-items: center; margin: -4px 0 10px; font-size: 0.85em; }
    .table-chart-bar button, .table-chart-bar select { font-size: 0.95em; padding: 3px 10px; }
    .table-chart { display: grid; grid-template-columns: minmax(60px, max-content) 1fr; gap: 6px 10px; align-items: center;
      margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 12px; font-size: 0.88em; }
    .table-chart .title { grid-column: 1 / -1; font-weight: 600; margin-bottom: 4px; }
    .table-chart .label { color: var(--muted); text-align: right; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .table-chart .track { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .table-chart .fill { height: 18px; border-radius: 4px; background: var(--accent); min-width: 2px; transition: width 0.4s ease-out; }
    .table-chart .fill.negative { background: var(--muted); }
    .table-chart .value { white-space: nowrap; font-variant-numeric: tabular-nums; }`;
  document.head.append(style);

  // "1,234", "$5.20", "45%", "12.7 km", "~3", "−4" all count as numbers. A range like "10-20" doesn't.
  function toNumber(text) {
    const t = text.trim().replace(/^[~≈<>$€£¥]+\s*/, "").replace(/^[−–]/, "-");
    const m = t.match(/^([-+]?\d[\d,]*(?:\.\d+)?|[-+]?\.\d+)(?:\s*[a-zA-Z%°µ²³/.]*)?\s*(?:\(.*\))?$/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : null;
  }

  // Columns where every filled-in cell is a number. Returns [{ index, name }].
  function numberColumns(headers, rows) {
    return headers.map((name, index) => ({ name, index })).filter(({ index }) => {
      const cells = rows.map((r) => r[index] ?? "").filter((c) => c.trim());
      return cells.length >= 2 && cells.every((c) => toNumber(c) !== null);
    });
  }

  function readTable(table) {
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    return { headers, rows };
  }

  function drawChart(table, column) {
    const { headers, rows } = readTable(table);
    const numeric = new Set(numberColumns(headers, rows).map((c) => c.index));
    const labelCol = headers.findIndex((_, i) => !numeric.has(i));
    const points = rows
      .map((r, i) => ({ label: labelCol >= 0 ? r[labelCol] : `Row ${i + 1}`, text: r[column] ?? "", value: toNumber(r[column] ?? "") }))
      .filter((p) => p.value !== null);
    const biggest = Math.max(...points.map((p) => Math.abs(p.value)), 0) || 1;
    const chart = el("div", { class: "table-chart", role: "img", "aria-label": `Bar chart of ${headers[column]}` },
      el("div", { class: "title" }, headers[column] || "Values"));
    for (const p of points) {
      chart.append(el("div", { class: "label", title: p.label }, p.label),
        el("div", { class: "track" },
          el("div", { class: `fill${p.value < 0 ? " negative" : ""}`, style: `width:${(Math.abs(p.value) / biggest) * 85}%` }),
          el("span", { class: "value" }, p.text)));
    }
    return chart;
  }

  function addButton(table) {
    if (table.dataset.chartReady) return;
    table.dataset.chartReady = "1";
    const { headers, rows } = readTable(table);
    const columns = numberColumns(headers, rows);
    if (rows.length < 2 || !columns.length) return;

    let chart = null;
    let column = columns[0].index;
    const picker = columns.length > 1
      ? el("select", { "aria-label": "Column to chart", onchange: (e) => { column = Number(e.target.value); if (chart) redraw(); } },
        ...columns.map((c) => el("option", { value: c.index }, c.name || `Column ${c.index + 1}`)))
      : null;
    const button = el("button", { type: "button", onclick: () => (chart ? hide() : redraw()) }, "📊 Show as chart");
    const bar = el("div", { class: "table-chart-bar" }, button, picker);
    table.after(bar);

    function redraw() {
      const fresh = drawChart(table, column);
      chart ? chart.replaceWith(fresh) : bar.after(fresh);
      chart = fresh;
      button.textContent = "Hide chart";
    }
    function hide() {
      chart.remove();
      chart = null;
      button.textContent = "📊 Show as chart";
    }
  }

  // Answers are redrawn as they stream in, so look for new tables whenever the messages change.
  // While an answer is being written its table isn't finished, so wait until the app is done.
  const scan = () => { if (!controller) messagesEl.querySelectorAll(".content table").forEach(addButton); };
  new MutationObserver(scan).observe(messagesEl, { childList: true, subtree: true });
  scan();
})();
