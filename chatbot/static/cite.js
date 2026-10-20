// "📚 Cite a source": builds MLA or APA citations for a website, book or article, the way teachers
// ask for them in essays. The AI can fill in the boxes from pasted text (like the top of a web page),
// but the citation itself is put together by the rules below, so the format is always right.
// Saved citations make a "Works Cited" list kept in this browser.
(() => {
  const STORE = "local-ai-citations";
  const MAX_SAVED = 60;
  const KINDS = { website: "Website", book: "Book", article: "Article" };
  const FIELDS = [
    ["author", "Author", "First Last (leave empty if none)"],
    ["title", "Title", "Title of the page, book or article"],
    ["container", "Website / publication", "e.g. National Geographic"],
    ["publisher", "Publisher", "e.g. Scholastic"],
    ["date", "Published", "YYYY-MM-DD, or just the year"],
    ["url", "Link", "https://..."],
  ];
  const SHOWN = { website: ["author", "title", "container", "date", "url"], book: ["author", "title", "publisher", "date"],
    article: ["author", "title", "container", "date", "url"] };
  const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  const APA_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const FILL_PROMPT = "Read the text below about a source a student wants to cite, and pull out its details. "
    + "Reply with only these six lines, leaving a line empty after the colon when the text doesn't say:\n"
    + "Author: first and last name of the person who wrote it\nTitle: \nWebsite or publication: \nPublisher: \n"
    + "Published: the date as YYYY-MM-DD, or YYYY-MM, or YYYY\nLink: \n\nThe text:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #cite-dialog { width: min(680px, 94vw); }
    #cite-dialog .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-top: 12px; }
    #cite-dialog label { display: grid; gap: 4px; font-weight: 600; font-size: 0.92em; }
    #cite-dialog input, #cite-dialog textarea { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--border-strong);
      border-radius: 8px; background: var(--card); color: var(--text); box-sizing: border-box; width: 100%; }
    #cite-dialog textarea { min-height: 70px; resize: vertical; }
    #cite-dialog details { margin-top: 12px; }
    #cite-dialog summary { cursor: pointer; font-weight: 600; }
    #cite-dialog .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    #cite-dialog .row .grow { flex: 1; }
    #cite-dialog .result { margin-top: 14px; padding: 12px 14px 12px 2.6em; text-indent: -1.6em; border-radius: 10px;
      border: 1px solid var(--border); background: var(--card); line-height: 1.6; overflow-wrap: anywhere; min-height: 1.6em; }
    #cite-dialog .works { margin-top: 14px; }
    #cite-dialog .works h3 { font-size: 1em; margin: 0 0 6px; }
    #cite-dialog .works li { margin: 4px 0; padding-left: 1.6em; text-indent: -1.6em; list-style: none; overflow-wrap: anywhere; }
    #cite-dialog .works ul { padding: 0; margin: 0; max-height: 26vh; overflow-y: auto; }
    #cite-dialog .works li button { font-size: 0.8em; padding: 1px 8px; margin-left: 6px; text-indent: 0; }`;
  document.head.append(style);

  const link = el("button", { id: "cite-link", class: "sidebar-link plain", type: "button",
    title: "Make an MLA or APA citation for a website, book or article", onclick: () => open() }, "📚 Cite a source");
  $("personal-link").before(link);

  const dialog = el("dialog", { id: "cite-dialog", "aria-labelledby": "cite-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  const state = { kind: "website", styleName: "MLA", author: "", title: "", container: "", publisher: "", date: "", url: "" };
  let making = null;

  // "Jane Q. Smith" -> { first: "Jane Q.", last: "Smith" }; "Smith, Jane" works too.
  function splitName(name) {
    name = name.trim().replace(/\s+/g, " ");
    if (!name) return null;
    if (name.includes(",")) {
      const [last, first] = name.split(",").map((s) => s.trim());
      return { first, last };
    }
    const parts = name.split(" ");
    return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
  }

  // "2024-03-07" / "2024-03" / "2024" -> [year, month (1-12) or 0, day or 0]
  function splitDate(date) {
    const m = (date || "").trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    return m ? [m[1], Number(m[2] || 0), Number(m[3] || 0)] : null;
  }

  const sentence = (s) => (s && !/[.?!]$/.test(s) ? `${s}.` : s);

  // Build one citation as parts: [text, italic?]. Plain text is the parts joined.
  function citation(src) {
    const name = splitName(src.author || "");
    const date = splitDate(src.date);
    const title = (src.title || "").trim();
    const where = (src.container || "").trim();
    const url = (src.url || "").trim().replace(/^https?:\/\//, src.styleName === "MLA" ? "" : "$&");
    const out = [];
    const add = (text, italic = false) => { if (text) out.push([text, italic]); };
    if (src.styleName === "MLA") {
      if (name) add(sentence(name.first ? `${name.last}, ${name.first}` : name.last) + " ");
      const mlaDate = date ? [date[2] || "", date[1] ? MLA_MONTHS[date[1] - 1] : "", date[0]].filter(Boolean).join(" ") : "";
      if (src.kind === "book") {
        add(sentence(title), true);
        const tail = [src.publisher?.trim(), date?.[0]].filter(Boolean).join(", ");
        if (tail) add(` ${tail}.`);
      } else {
        add(`"${sentence(title)}" `);
        const tail = [];
        if (where) tail.push([where, true]);
        if (mlaDate) tail.push([mlaDate]);
        if (url) tail.push([url]);
        tail.forEach(([text, italic], i) => { add(text, italic); add(i < tail.length - 1 ? ", " : "."); });
      }
    } else {
      const initials = name?.first ? name.first.split(/[\s-]+/).map((p) => `${p[0].toUpperCase()}.`).join(" ") : "";
      const apaDate = !date ? "n.d." : src.kind === "book" || !date[1] ? date[0]
        : `${date[0]}, ${APA_MONTHS[date[1] - 1]}${date[2] ? ` ${date[2]}` : ""}`;
      if (name) add(`${name.last}${initials ? `, ${initials}` : ""} (${apaDate}). `);
      if (src.kind === "article") {
        add(sentence(title));
        if (!name) add(` (${apaDate}).`);
        if (where) { add(" "); add(where, true); add("."); }
      } else {
        add(sentence(title), true);
        if (!name) add(` (${apaDate}).`);
        const by = src.kind === "book" ? src.publisher?.trim() : where;
        if (by) add(` ${sentence(by)}`);
      }
      if (url && src.kind !== "book") add(` ${url}`);
    }
    return out;
  }

  const plain = (parts) => parts.map(([t]) => t).join("").trim();
  const render = (parts) => parts.map(([t, italic]) => (italic ? el("i", {}, t) : t));

  // Read the AI's "Field: value" lines into the boxes it filled.
  function parseFields(text) {
    const keys = { author: "author", title: "title", "website or publication": "container", publisher: "publisher", published: "date", link: "url" };
    const found = {};
    for (const line of text.replace(/\*\*/g, "").split("\n")) {
      const m = line.match(/^\W*(author|title|website or publication|publisher|published|link)\s*:\s*(.*)$/i);
      const value = m?.[2].trim();
      if (value && !/^(none|n\/a|unknown|-)$/i.test(value)) found[keys[m[1].toLowerCase()]] = value.slice(0, 300);
    }
    return found;
  }

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
  const save = (list) => localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX_SAVED)));

  async function fill(text) {
    const model = currentModel();
    if (!model) throw new Error("Pick an AI model in Models first.");
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: FILL_PROMPT + text.slice(0, 3000) }], think: false, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let out = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") out += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    return parseFields(out);
  }

  const segmented = (options, key) => el("div", { class: "segmented" }, ...Object.entries(options).map(([value, label]) =>
    el("button", { type: "button", class: state[key] === value ? "on" : "", onclick: () => { state[key] = value; draw(); } }, label)));

  function draw(message) {
    const result = el("div", { class: "result", "aria-live": "polite" });
    const showResult = () => {
      const parts = citation(state);
      result.replaceChildren(...(state.title.trim() ? render(parts) : [el("span", { class: "note" }, "Type a title to see the citation.")]));
    };
    const inputs = SHOWN[state.kind].map((key) => {
      const [, label, placeholder] = FIELDS.find(([k]) => k === key);
      const input = el("input", { placeholder, maxlength: 300, "aria-label": label });
      input.value = state[key];
      input.addEventListener("input", () => { state[key] = input.value; showResult(); });
      return el("label", {}, key === "container" && state.kind === "article" ? "Newspaper / magazine / journal" : label, input);
    });
    const pasted = el("textarea", { placeholder: "Paste the top of the web page, or the book's cover and title page details" });
    const fillButton = el("button", { type: "button", onclick: async () => {
      if (!pasted.value.trim()) return;
      fillButton.disabled = true;
      fillButton.textContent = "Filling in...";
      try {
        Object.assign(state, await fill(pasted.value));
        draw("✅ Filled in by the AI. Check each box before you use it.");
      } catch (err) {
        if (err.name !== "AbortError") draw(`Couldn't fill it in: ${err.message}`);
      } finally {
        making = null;
      }
    } }, "✨ Fill in with AI");
    const copy = el("button", { class: "primary", type: "button" }, "Copy");
    copy.addEventListener("click", () => state.title.trim() && copyText(copy, plain(citation(state))));
    const add = el("button", { type: "button", onclick: () => {
      if (!state.title.trim()) return;
      const { styleName, ...entry } = state;
      save([entry, ...load()]);
      draw("Added to your Works Cited list.");
    } }, "＋ Add to list");

    // Every saved source is shown in the style picked above, so switching MLA/APA redoes the whole list.
    const sorted = load().map((c) => ({ c, parts: citation({ ...c, styleName: state.styleName }) }))
      .map((s) => ({ ...s, text: plain(s.parts) })).sort((a, b) => a.text.localeCompare(b.text));
    const copyAll = el("button", { type: "button" }, "Copy list");
    copyAll.addEventListener("click", () => copyText(copyAll, sorted.map((s) => s.text).join("\n")));
    const works = sorted.length ? el("div", { class: "works" },
      el("h3", {}, state.styleName === "MLA" ? "Works Cited" : "References", " ", copyAll),
      el("ul", {}, ...sorted.map(({ c, parts }) => el("li", {}, ...render(parts),
        el("button", { type: "button", "aria-label": "Remove", onclick: () => { save(load().filter((x) => JSON.stringify(x) !== JSON.stringify(c))); draw(); } }, "✕"))))) : null;

    setDialog(
      el("div", { class: "dialog-head" }, el("h2", { id: "cite-title" }, "📚 Cite a source"),
        el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕")),
      el("div", { class: "row" }, segmented(KINDS, "kind"), el("span", { class: "grow" }), segmented({ MLA: "MLA", APA: "APA" }, "styleName")),
      el("details", { open: !state.title }, el("summary", {}, "✨ Let the AI fill it in"),
        el("p", { class: "note" }, "Paste what you can see about the source, and the AI fills in the boxes. It runs on this computer."),
        pasted, el("div", { class: "row" }, el("span", { class: "grow" }), fillButton)),
      el("div", { class: "grid" }, ...inputs),
      el("div", { class: "result-wrap" }, result),
      message ? el("p", { class: "note" }, message) : null,
      el("div", { class: "row" }, el("button", { type: "button", onclick: () => {
        Object.assign(state, { author: "", title: "", container: "", publisher: "", date: "", url: "" });
        draw();
      } }, "Clear"), el("span", { class: "grow" }), add, copy),
      works);
    showResult();
  }

  function open() {
    dialog.showModal();
    draw();
  }

  dialog.addEventListener("close", () => making?.abort());
})();
