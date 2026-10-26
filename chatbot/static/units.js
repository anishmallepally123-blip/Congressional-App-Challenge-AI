// "📏 Unit converter" for science and math class: pick a kind of measurement, type a number and
// two units, and the answer updates as you type. "Show the steps" writes out the dimensional-analysis
// chain (or the formula, for temperature). All of that is plain math on this page, so it works offline
// and with any model. "Explain like a tutor" optionally asks the AI on this computer to talk it through.
// The last inputs are kept in this browser.

// Pure helpers (no page needed), so test_units.py can run them with Node.
const LocalAIUnits = (() => {
  const MAX_INPUT = 40;
  // Each unit says "base = per of this unit", e.g. 1609.344 m = 1 mi, or 1 m = 1000 mm.
  // Writing both sides keeps the steps readable (1000 mm, not 0.001 m) and the math exact.
  const u = (name, base, per = 1) => ({ name, base, per });
  const UNITS = {
    length: { label: "Length", icon: "📏", base: "m", pair: ["mi", "km"], units: {
      mm: u("millimeters", 1, 1000), cm: u("centimeters", 1, 100), m: u("meters", 1), km: u("kilometers", 1000),
      in: u("inches", 0.0254), ft: u("feet", 0.3048), yd: u("yards", 0.9144), mi: u("miles", 1609.344) } },
    mass: { label: "Mass", icon: "⚖️", base: "g", pair: ["lb", "kg"], units: {
      mg: u("milligrams", 1, 1000), g: u("grams", 1), kg: u("kilograms", 1000), oz: u("ounces", 28.349523125), lb: u("pounds", 453.59237) } },
    volume: { label: "Volume", icon: "🧪", base: "mL", pair: ["gal", "L"], units: {
      mL: u("milliliters", 1), L: u("liters", 1000), tsp: u("teaspoons", 4.92892159375), tbsp: u("tablespoons", 14.78676478125),
      cup: u("cups (US)", 236.5882365), "fl oz": u("fluid ounces (US)", 29.5735295625), gal: u("gallons (US)", 3785.411784) } },
    temperature: { label: "Temperature", icon: "🌡️", base: "K", pair: ["°C", "°F"], units: {
      "°C": { name: "degrees Celsius" }, "°F": { name: "degrees Fahrenheit" }, K: { name: "kelvins" } } },
    time: { label: "Time", icon: "⏱️", base: "s", pair: ["h", "min"], units: {
      s: u("seconds", 1), min: u("minutes", 60), h: u("hours", 3600), day: u("days", 86400) } },
    speed: { label: "Speed", icon: "🚗", base: "m/s", pair: ["mph", "km/h"], units: {
      "m/s": u("meters per second", 1), "km/h": u("kilometers per hour", 1, 3.6), mph: u("miles per hour", 0.44704) } },
  };
  const CATEGORIES = Object.keys(UNITS);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const unitOf = (cat, id) => (has(UNITS, cat) && has(UNITS[cat].units, id) ? UNITS[cat].units[id] : null);
  const categoryOf = (from, to) => CATEGORIES.find((c) => unitOf(c, from) && unitOf(c, to)) || null;

  // Temperature is affine (there's an offset), so it goes through kelvins with formulas, not one factor.
  const toKelvin = (v, unit) => (unit === "K" ? v : unit === "°C" ? v + 273.15 : unit === "°F" ? (v - 32) * 5 / 9 + 273.15 : NaN);
  const fromKelvin = (k, unit) => (unit === "K" ? k : unit === "°C" ? k - 273.15 : unit === "°F" ? (k - 273.15) * 9 / 5 + 32 : NaN);
  const belowAbsoluteZero = (v, unit) => toKelvin(Number(v), unit) < -1e-9;

  // The number in `to` units, or NaN for a bad number or unit.
  function convert(value, from, to, category) {
    const v = typeof value === "number" ? value : NaN;
    const cat = category || categoryOf(from, to);
    const a = unitOf(cat, from);
    const b = unitOf(cat, to);
    if (!Number.isFinite(v) || !a || !b) return NaN;
    if (from === to) return v;
    if (cat === "temperature") {
      const r = fromKelvin(toKelvin(v, from), to);
      return Math.abs(r) < 1e-9 ? 0 : r;
    }
    return (v * a.base * b.per) / (a.per * b.base);
  }

  const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  const group = (s) => {
    const [int, dec] = s.split(".");
    const neg = int.startsWith("-");
    const digits = neg ? int.slice(1) : int;
    const g = digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : digits;
    return (neg ? "-" : "") + g + (dec ? `.${dec}` : "");
  };

  // Up to `sig` significant figures, no trailing zeros. Scientific notation (× 10ⁿ) only for very
  // big or very small numbers; "" for anything that isn't a number.
  function formatNumber(x, sig = 6) {
    if (typeof x !== "number" || !Number.isFinite(x)) return "";
    if (x === 0) return "0";
    const abs = Math.abs(x);
    if (abs >= 1e12 || abs < 1e-6) {
      const [m, e] = x.toExponential(sig - 1).split("e");
      const mant = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
      return `${mant} × 10${String(Number(e)).replace(/./g, (c) => SUP[c] || c)}`;
    }
    const n = Number(x.toPrecision(sig));
    if (n === 0) return "0";
    // toFixed never switches to "1e-7" style; trim the zeros it pads with.
    const s = n.toFixed(Math.max(0, Math.min(20, sig - 1 - Math.floor(Math.log10(Math.abs(n))))));
    return group(s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  }
  const exact = (x) => formatNumber(x, 12);

  // { ok, value } or { ok: false, message } for what the student typed.
  function parseInput(text, from, category) {
    const raw = String(text == null ? "" : text).trim().slice(0, MAX_INPUT);
    if (!raw) return { ok: false, empty: true, message: "Type a number to convert." };
    const s = raw.replace(/[\s,_]/g, "").replace(/^[−–]/, "-").replace(/^\+/, "");
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return { ok: false, message: `“${raw}” isn't a number. Try something like 5, 2.5 or -40.` };
    const value = Number(s);
    if (!Number.isFinite(value)) return { ok: false, message: "That number is too big to work with." };
    if (category === "temperature" && belowAbsoluteZero(value, from)) {
      return { ok: false, message: `${raw} ${from} is colder than absolute zero (0 K = -273.15 °C = -459.67 °F). Nothing can be that cold, so check the number.` };
    }
    return { ok: true, value: value === 0 ? 0 : value };
  }

  // The worked steps. Factor units: { kind: "chain", start, factors: [{ top, bottom }], result, text }
  // where each side is { n, unit }. Temperature: { kind: "formula", formula, work, text }.
  function stepsFor(value, from, to, category) {
    const cat = category || categoryOf(from, to);
    const result = convert(value, from, to, cat);
    if (!Number.isFinite(result)) return null;
    const v = exact(value);
    const r = formatNumber(result);
    if (from === to) return { kind: "same", text: `${v} ${from} = ${r} ${to} (same unit, so nothing changes)` };
    if (cat === "temperature") {
      const sub = (x) => (x < 0 ? `(${exact(x)})` : exact(x));
      const F = {
        "°C>°F": ["°F = °C × 9/5 + 32", `${sub(value)} × 9/5 + 32`],
        "°C>K": ["K = °C + 273.15", `${sub(value)} + 273.15`],
        "°F>°C": ["°C = (°F − 32) × 5/9", `(${v} − 32) × 5/9`],
        "°F>K": ["K = (°F − 32) × 5/9 + 273.15", `(${v} − 32) × 5/9 + 273.15`],
        "K>°C": ["°C = K − 273.15", `${v} − 273.15`],
        "K>°F": ["°F = (K − 273.15) × 9/5 + 32", `(${v} − 273.15) × 9/5 + 32`],
      }[`${from}>${to}`];
      const work = `${F[1]} = ${r} ${to}`;
      return { kind: "formula", formula: F[0], work, text: `${F[0]}\n${work}` };
    }
    const base = UNITS[cat].base;
    const a = UNITS[cat].units[from];
    const b = UNITS[cat].units[to];
    const factors = [];
    // Each fraction equals 1 (top and bottom are the same amount), with the unit to cancel on the bottom.
    if (from !== base) factors.push({ top: { n: exact(a.base), unit: base }, bottom: { n: exact(a.per), unit: from } });
    if (to !== base) factors.push({ top: { n: exact(b.per), unit: to }, bottom: { n: exact(b.base), unit: base } });
    const side = (s) => (s.unit.includes("/") ? `(${s.n} ${s.unit})` : `${s.n} ${s.unit}`);
    const text = [`${v} ${from}`, ...factors.map((f) => `${side(f.top)}/${side(f.bottom)}`)].join(" × ") + ` = ${r} ${to}`;
    return { kind: "chain", start: { n: v, unit: from }, factors, result: { n: r, unit: to }, text };
  }

  function buildPrompt(value, from, to, category) {
    const cat = category || categoryOf(from, to);
    const steps = stepsFor(value, from, to, cat);
    if (!steps) return null;
    const a = UNITS[cat].units[from];
    const b = UNITS[cat].units[to];
    const answer = `${exact(value)} ${from} = ${formatNumber(convert(value, from, to, cat))} ${to}`;
    const system = "You are a friendly, patient math and science tutor for middle and high school students. "
      + "Explain unit conversions in plain words. Use the exact numbers you are given and do not change the answer.";
    const user = [
      `Explain how to convert ${exact(value)} ${from} (${a.name}) to ${to} (${b.name}).`,
      `The correct answer is: ${answer}`,
      `${steps.kind === "formula" ? "The formula and the work" : "The dimensional-analysis steps"}: ${steps.text.replace(/\n/g, "; ")}`,
      "",
      "Answer in exactly 3 short numbered steps (1., 2., 3.), one or two sentences each.",
      "Then one line starting with \"Example:\" that gives a real-world situation where someone would make this conversion.",
      "No other text.",
    ].join("\n");
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  return { UNITS, CATEGORIES, MAX_INPUT, categoryOf, unitOf, convert, toKelvin, belowAbsoluteZero, formatNumber, parseInput, stepsFor, buildPrompt };
})();
if (typeof window !== "undefined") window.LocalAIUnits = LocalAIUnits;
if (typeof module !== "undefined") module.exports = LocalAIUnits;

if (typeof document !== "undefined") (() => {
  const { UNITS, CATEGORIES, MAX_INPUT, convert, formatNumber, parseInput, stepsFor, buildPrompt } = LocalAIUnits;
  const SAVE_KEY = "local-ai-units";

  const style = document.createElement("style");
  style.textContent = `
    #units-dialog { width: min(720px, calc(100vw - 32px)); }
    .un-cats { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; }
    .un-cats button { padding: 6px 12px; border-radius: 999px; font-size: 0.9em; }
    .un-cats button[aria-pressed="true"] { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--accent); font-weight: 650; }
    .un-row { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: end; margin-top: 16px; }
    .un-field { display: block; font-weight: 600; font-size: 0.9em; min-width: 0; }
    .un-field input, .un-field select { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-size: 1.05rem; font-weight: 400;
      height: 46px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--card); color: var(--text); outline: none; min-width: 0; }
    .un-field input:focus, .un-field select:focus { border-color: var(--accent); }
    .un-field input.un-bad { border-color: var(--danger); }
    .un-swap { height: 46px; width: 46px; padding: 0; border-radius: 50%; font-size: 1.2em; }
    .un-result { margin-top: 16px; padding: 14px 16px; border-radius: 14px; border: 1.5px solid var(--border-strong); background: var(--card); min-width: 0; }
    .un-answer { margin: 0; font-size: 1.7em; font-weight: 750; letter-spacing: -0.01em; line-height: 1.25; overflow-wrap: anywhere; }
    .un-answer .un-to { color: var(--accent); }
    .un-names { margin: 4px 0 0; font-size: 0.88em; color: var(--muted); }
    .un-msg { margin: 0; padding: 2px 0; line-height: 1.45; font-weight: 600; }
    .un-msg.un-warn { color: var(--danger); }
    .un-steps { margin-top: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--card); min-width: 0; }
    .un-steps summary { cursor: pointer; padding: 10px 14px; font-weight: 650; }
    .un-steps-body { padding: 0 14px 14px; }
    .un-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 1.05em; }
    .un-frac { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.3; }
    .un-frac > span { padding: 1px 6px; white-space: nowrap; }
    .un-frac > span + span { border-top: 1.5px solid currentColor; }
    .un-term { white-space: nowrap; }
    .un-cancel { text-decoration: line-through; text-decoration-color: var(--accent); text-decoration-thickness: 2px; color: var(--muted); }
    .un-op { color: var(--muted); }
    .un-final { font-weight: 750; color: var(--accent); white-space: nowrap; }
    .un-formula { margin: 0; font-weight: 650; }
    .un-work { margin: 6px 0 0; font-size: 1.05em; overflow-wrap: anywhere; }
    .un-why { margin: 10px 0 0; font-size: 0.86em; color: var(--muted); line-height: 1.45; }
    .un-tutor { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .un-tutor .un-grow { flex: 1; }
    .un-explain { margin: 10px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; padding: 12px 14px; border-radius: 12px;
      background: var(--accent-soft); font-family: inherit; font-size: 0.95em; max-height: 320px; overflow-y: auto; }
    .un-explain.un-live { background: transparent; border: 1px dashed var(--border); color: var(--muted); }
    .un-note { margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); line-height: 1.45; font-size: 0.92em; }
    .un-working { display: flex; align-items: center; gap: 10px; font-weight: 600; }
    .un-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--border-strong); border-top-color: var(--accent);
      animation: un-spin 0.8s linear infinite; flex-shrink: 0; }
    @keyframes un-spin { to { transform: rotate(360deg); } }
    .un-private { margin: 12px 0 0; font-size: 0.82em; color: var(--muted); }
    #units-dialog button:disabled { opacity: 0.55; cursor: default; }
    @media (max-width: 640px) {
      .un-row { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
      .un-row .un-num { grid-column: 1 / -1; }
      .un-field select { padding: 0 6px; font-size: 1rem; }
      .un-row { gap: 8px; }
      .un-answer { font-size: 1.4em; }
      .un-cats button { padding: 5px 10px; font-size: 0.85em; }
    }`;
  document.head.append(style);

  const link = el("button", { id: "units-link", class: "sidebar-link plain", type: "button", onclick: () => open() }, "📏 Unit converter");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "units-dialog", "aria-labelledby": "units-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));

  let busy = null; // AbortController while the AI is working
  const fresh = () => ({ category: "length", value: "5", from: "mi", to: "km", steps: false });
  let state = fresh();

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* blocked; fine for this visit */ } };
  const loadSaved = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d !== "object" || !CATEGORIES.includes(d.category)) return null;
      const units = UNITS[d.category].units;
      const [f, t] = UNITS[d.category].pair;
      return {
        category: d.category,
        value: typeof d.value === "string" ? d.value.slice(0, MAX_INPUT) : "",
        from: Object.hasOwn(units, d.from) ? d.from : f,
        to: Object.hasOwn(units, d.to) ? d.to : t,
        steps: d.steps === true,
      };
    } catch { return null; }
  };

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "units-title" }, "📏 Unit converter"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  // The form is built once; typing only updates the result and steps, so the box keeps its focus.
  function draw() {
    const cats = el("div", { class: "un-cats", role: "group", "aria-label": "Kind of measurement" });
    const num = el("input", { type: "text", inputmode: "decimal", autocomplete: "off", maxlength: String(MAX_INPUT), placeholder: "e.g. 5", "aria-describedby": "units-result" });
    const from = el("select", {});
    const to = el("select", {});
    const swap = el("button", { type: "button", class: "un-swap", title: "Swap units", "aria-label": "Swap units" }, "⇄");
    const result = el("div", { class: "un-result", id: "units-result", "aria-live": "polite" });
    const stepsBody = el("div", { class: "un-steps-body" });
    const steps = el("details", { class: "un-steps" }, el("summary", {}, "🧮 Show the steps"), stepsBody);
    steps.open = state.steps;
    const tutorBox = el("div", {});
    const explainBtn = el("button", { type: "button" }, "🤖 Explain like a tutor");
    const tutor = el("div", { class: "un-tutor" }, explainBtn, el("span", { class: "un-grow" }),
      el("button", { type: "button", onclick: () => { stopAI(); state = fresh(); save(); setUp(); num.focus(); } }, "↺ Start over"));

    const catButtons = CATEGORIES.map((c) => el("button", { type: "button", "aria-pressed": "false", onclick: () => {
      if (state.category === c) return;
      state.category = c;
      [state.from, state.to] = UNITS[c].pair;
      setUp();
    } }, `${UNITS[c].icon} ${UNITS[c].label}`));
    cats.append(...catButtons);

    const fillSelect = (sel, chosen) => {
      sel.replaceChildren(...Object.entries(UNITS[state.category].units).map(([id, x]) => el("option", { value: id }, `${id} · ${x.name}`)));
      sel.value = chosen;
    };

    function setUp() {
      catButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(CATEGORIES[i] === state.category)));
      fillSelect(from, state.from);
      fillSelect(to, state.to);
      num.value = state.value;
      update();
    }

    function update() {
      stopAI();
      tutorBox.replaceChildren();
      save();
      const cat = state.category;
      const p = parseInput(state.value, state.from, cat);
      num.classList.toggle("un-bad", !p.ok && !p.empty);
      explainBtn.disabled = !p.ok;
      if (!p.ok) {
        result.replaceChildren(el("p", { class: p.empty ? "un-msg" : "un-msg un-warn", role: p.empty ? null : "alert" }, `${p.empty ? "" : "⚠ "}${p.message}`));
        stepsBody.replaceChildren(el("p", { class: "un-why" }, "The steps show up here once there's a number to convert."));
        return;
      }
      const out = convert(p.value, state.from, state.to, cat);
      const U = UNITS[cat].units;
      result.replaceChildren(
        el("p", { class: "un-answer" }, `${formatNumber(p.value, 12)} ${state.from} = `, el("span", { class: "un-to" }, `${formatNumber(out)} ${state.to}`)),
        el("p", { class: "un-names" }, `${U[state.from].name} → ${U[state.to].name}${cat === "temperature" ? "" : " · rounded to 6 significant figures"}`));
      stepsBody.replaceChildren(...stepsView(stepsFor(p.value, state.from, state.to, cat)));
    }

    num.addEventListener("input", () => { state.value = num.value; update(); });
    from.addEventListener("change", () => { state.from = from.value; update(); });
    to.addEventListener("change", () => { state.to = to.value; update(); });
    swap.addEventListener("click", () => {
      [state.from, state.to] = [state.to, state.from];
      from.value = state.from;
      to.value = state.to;
      update();
    });
    steps.addEventListener("toggle", () => { state.steps = steps.open; save(); });
    explainBtn.addEventListener("click", () => explain(tutorBox, explainBtn));

    setDialog(head(),
      el("p", { class: "note" }, "Pick what you're measuring, type a number and choose the units. The answer is worked out right here, no AI needed."),
      cats,
      el("div", { class: "un-row" },
        el("label", { class: "un-field un-num" }, "Number", num),
        el("label", { class: "un-field" }, "From", from),
        swap,
        el("label", { class: "un-field" }, "To", to)),
      result,
      steps,
      tutor,
      tutorBox,
      el("p", { class: "un-private" }, "🔒 Works offline. Only “Explain like a tutor” uses the AI, and it runs on this computer."));
    setUp();
    num.focus();
    num.select();
  }

  const side = (s, cancel) => el("span", {}, `${s.n} `, el("span", { class: cancel ? "un-cancel" : "" }, s.unit));
  function stepsView(s) {
    if (!s) return [];
    if (s.kind === "same") return [el("p", { class: "un-work" }, s.text)];
    if (s.kind === "formula") {
      return [el("p", { class: "un-formula" }, `Formula: ${s.formula}`), el("p", { class: "un-work" }, s.work),
        el("p", { class: "un-why" }, "Temperature scales start at different zero points, so you can't just multiply by one number. You use a formula with an add or subtract step.")];
    }
    const chain = el("div", { class: "un-chain", "aria-label": s.text },
      el("span", { class: "un-term" }, `${s.start.n} `, el("span", { class: "un-cancel" }, s.start.unit)));
    for (const f of s.factors) {
      // A unit is crossed out when the same unit sits on the other side of the line next to it.
      chain.append(el("span", { class: "un-op", "aria-hidden": "true" }, "×"),
        el("span", { class: "un-frac", "aria-hidden": "true" }, side(f.top, f.top.unit !== s.result.unit), side(f.bottom, true)));
    }
    chain.append(el("span", { class: "un-op", "aria-hidden": "true" }, "="), el("span", { class: "un-final" }, `${s.result.n} ${s.result.unit}`));
    return [chain,
      el("p", { class: "un-why" }, "Each fraction is equal to 1 (the top and bottom are the same amount), so multiplying by it doesn't change the size, only the unit. Units on the top and bottom cancel out, leaving the unit you want.")];
  }

  function stopAI() {
    const was = busy;
    busy = null;
    was?.abort();
  }

  async function explain(box, btn) {
    const p = parseInput(state.value, state.from, state.category);
    if (!p.ok) return;
    if (findModel(currentModel())?.experimental) {
      box.replaceChildren(el("p", { class: "un-note", role: "status" }, "TinyGPT is a tiny practice model, so it can't explain conversions. The steps above are always right, though! Pick a real chat model in Models for tutor explanations."));
      return;
    }
    stopAI();
    const ctl = new AbortController();
    busy = ctl;
    const live = el("pre", { class: "un-explain un-live" }, "Waiting for the AI...");
    box.replaceChildren(el("div", { class: "un-working" }, el("span", { class: "un-spin", "aria-hidden": "true" }), "The tutor is thinking…",
      el("span", { class: "un-grow" }), el("button", { type: "button", onclick: () => ctl.abort() }, "■ Stop")), live);
    btn.disabled = true;
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: currentModel(), messages: buildPrompt(p.value, state.from, state.to, state.category), think: false, auto_code: false }),
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
      let reply = "";
      let failed = null;
      await readLines(resp, (ev) => {
        if (ev.type === "text" && busy === ctl) { reply += ev.text; live.textContent = reply; live.scrollTop = live.scrollHeight; }
        if (ev.type === "error") failed = ev.message;
      });
      if (failed) throw new Error(failed);
      if (!reply.trim()) throw new Error("the AI sent an empty answer");
      if (busy !== ctl) return;
      box.replaceChildren(el("pre", { class: "un-explain" }, reply.trim().replace(/\*\*|__/g, "")),
        el("p", { class: "un-why" }, "AI can make mistakes. The answer and steps above are calculated exactly by this page."));
    } catch (err) {
      if (busy !== ctl) return; // closed, or the inputs changed
      box.replaceChildren(el("p", { class: "un-note", role: "alert" }, err.name === "AbortError" ? "Stopped. Press Explain like a tutor to try again." : `Couldn't get an explanation: ${err.message}`));
    } finally {
      if (busy === ctl) { busy = null; btn.disabled = false; }
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    state = loadSaved() || fresh();
    dialog.showModal();
    draw();
  }

  dialog.addEventListener("close", () => { busy?.abort(); });
})();
