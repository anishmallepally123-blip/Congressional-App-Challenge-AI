// "📽️ Slides": the AI turns the current chat into a short slide presentation a student can show in
// class, played full screen right here and downloadable as a single web page that works offline.
// The slides are saved with the chat, so they open instantly next time.
(() => {
  const MAX_SLIDES = 8;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const PROMPT = "Turn the conversation below into a short slide presentation a student could give to their class. "
    + `Make 5 to ${MAX_SLIDES} slides. The first slide is the title of the topic with one short subtitle point. `
    + "The last slide is \"Key takeaways\". Write each slide in exactly this form:\n"
    + "# Slide title\n- point\n- point\n"
    + "Give each slide 2 to 4 points of under 14 words each. Write nothing else.\n\nThe conversation:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #slides-button { flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #slides-dialog { width: min(980px, 96vw); max-height: 96vh; outline: none; }
    #slides-dialog .slide { aspect-ratio: 16 / 9; display: flex; flex-direction: column; justify-content: center; gap: 4%;
      padding: 5% 7%; margin: 8px 0 12px; border-radius: 16px; border: 1px solid var(--border-strong);
      background: linear-gradient(135deg, var(--accent-soft), var(--panel) 60%); overflow: hidden; container-type: inline-size; }
    #slides-dialog .slide h3 { margin: 0; font-size: 5.2cqw; line-height: 1.15; letter-spacing: -0.02em; }
    #slides-dialog .slide ul { margin: 0; padding-left: 1.1em; font-size: 3cqw; line-height: 1.45; }
    #slides-dialog .slide li + li { margin-top: 0.35em; }
    #slides-dialog .slide.title { text-align: center; align-items: center; }
    #slides-dialog .slide.title h3 { font-size: 7cqw; color: var(--accent); }
    #slides-dialog .slide.title ul { list-style: none; padding: 0; color: var(--muted); }
    #slides-dialog .controls { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
    #slides-dialog .count { color: var(--muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
    #slides-dialog .footer { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    #slides-dialog .footer .grow { flex: 1; }
    #slides-dialog:fullscreen { width: 100vw; max-width: none; max-height: none; border-radius: 0; display: flex; flex-direction: column; justify-content: center; }
    #slides-dialog:fullscreen .slide { width: min(100%, calc((100vh - 140px) * 16 / 9)); margin: 8px auto 12px; }`;
  document.head.append(style);

  const button = el("button", { id: "slides-button", type: "button", title: "Turn this chat into slides you can present", hidden: true,
    onclick: () => open() }, "📽️ Slides");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "slides-dialog", "aria-labelledby": "slides-title" });
  document.body.append(dialog);
  // replaceChildren would show a skipped (null) part as the word "null", so leave those out.
  const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));
  let deck = [];
  let index = 0;
  let making = null;

  // Read "# title" lines and the "- point" lines under them, tolerating "Slide 2:" labels, bold text and numbering.
  function parseSlides(text) {
    const slides = [];
    for (let line of text.split("\n")) {
      line = line.replace(/\*\*/g, "").trim();
      const head = line.match(/^#{1,4}\s*(.+)$/) || line.match(/^Slide\s*\d+\s*[:.-]\s*(.+)$/i);
      if (head) {
        const title = head[1].replace(/^Slide\s*\d+\s*[:.-]\s*/i, "").trim();
        if (title) slides.push({ title, points: [] });
        continue;
      }
      const point = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (point && slides.length) slides[slides.length - 1].points.push(point[1].trim());
    }
    return slides.filter((s) => s.title.length <= 120).slice(0, MAX_SLIDES).map((s) => ({ ...s, points: s.points.slice(0, 6) }));
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeDeck(chat) {
    const model = currentModel();
    if (findModel(model)?.experimental) throw new Error("TinyGPT can't follow instructions. Pick a chat model in Models first.");
    making = new AbortController();
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT + transcript(chat) }], think: false, auto_code: false }),
      signal: making.signal,
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `error ${resp.status}`);
    let text = "";
    let failed = null;
    await readLines(resp, (ev) => {
      if (ev.type === "text") {
        text += ev.text;
        const status = dialog.querySelector(".making");
        const count = parseSlides(text).length;
        if (status && count) status.textContent = `Writing slide ${count}...`;
      }
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    const slides = parseSlides(text);
    if (slides.length < 2) throw new Error("the AI didn't write any slides. Try again, or try a bigger model.");
    return slides;
  }

  function slideView(s, i) {
    return el("div", { class: `slide${i === 0 ? " title" : ""}`, "aria-live": "polite" },
      el("h3", {}, s.title),
      s.points.length ? el("ul", {}, ...s.points.map((p) => el("li", {}, p))) : null);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "slides-title" }, "📽️ Slides"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => close() }, "✕"));

  function draw() {
    setDialog(
      head(),
      slideView(deck[index], index),
      el("div", { class: "controls" },
        el("button", { onclick: () => go(-1), disabled: index === 0 }, "← Back"),
        el("span", { class: "count" }, `${index + 1} of ${deck.length}`),
        el("button", { class: "primary", onclick: () => go(1), disabled: index === deck.length - 1 }, "Next →")),
      el("div", { class: "footer" },
        el("button", { onclick: fullscreen }, document.fullscreenElement ? "Exit full screen" : "⛶ Present full screen"),
        el("button", { onclick: download }, "⬇ Download"),
        el("span", { class: "grow" }),
        el("button", { onclick: () => remake() }, "↻ Make new slides")));
  }

  function drawMessage(text, retry) {
    setDialog(head(), el("p", { class: retry ? "" : "making" }, text),
      retry ? el("button", { class: "primary", onclick: () => remake() }, "Try again") : null);
  }

  const go = (step) => { index = Math.min(deck.length - 1, Math.max(0, index + step)); draw(); };

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else dialog.requestFullscreen?.().catch(() => toast("This browser can't go full screen here."));
  }
  document.addEventListener("fullscreenchange", () => { if (dialog.open && deck.length) draw(); });

  function close() {
    if (document.fullscreenElement) document.exitFullscreen();
    dialog.close();
  }

  // A single web page with the slides and arrow-key controls, to present from any computer, even offline.
  function slidesPage(title, slides) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const sections = slides.map((s, i) => `<section class="${i === 0 ? "title" : ""}"${i ? " hidden" : ""}><h1>${esc(s.title)}</h1>`
      + (s.points.length ? `<ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "") + "</section>").join("\n");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #1f1d1a; }
  section { box-sizing: border-box; position: absolute; inset: 0; margin: auto; width: min(100vw, 177.78vh); height: min(100vh, 56.25vw);
    padding: 5% 7%; display: flex; flex-direction: column; justify-content: center; gap: 4%; background: linear-gradient(135deg, #f7e6dc, #fbfaf7 60%); color: #1f1d1a; }
  section[hidden] { display: none; }
  h1 { margin: 0; font-size: min(5.2vw, 9.2vh); line-height: 1.15; }
  ul { margin: 0; padding-left: 1.1em; font-size: min(3vw, 5.3vh); line-height: 1.45; }
  .title { text-align: center; align-items: center; }
  .title h1 { color: #c4572f; font-size: min(7vw, 12.4vh); }
  .title ul { list-style: none; padding: 0; color: #6b6862; }
  footer { position: fixed; bottom: 8px; right: 14px; color: #8e8c85; font-size: 13px; }
</style></head>
<body>
${sections}
<footer>← → to change slides · made with Local AI Chat</footer>
<script>
  const slides = [...document.querySelectorAll("section")];
  let i = 0;
  const show = (n) => { i = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, k) => (s.hidden = k !== i)); };
  addEventListener("keydown", (e) => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) show(i + 1);
    if (["ArrowLeft", "PageUp"].includes(e.key)) show(i - 1);
  });
  addEventListener("click", (e) => show(e.clientX < innerWidth / 3 ? i - 1 : i + 1));
</script>
</body></html>
`;
  }

  function download() {
    const title = deck[0]?.title || currentChat()?.title || "Slides";
    const blob = new Blob([slidesPage(title, deck)], { type: "text/html" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "slides"}.html` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function remake() {
    const chat = currentChat();
    if (!chat) return;
    drawMessage("Making slides from this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      deck = await makeDeck(chat);
      chat.slides = deck;
      saveChats();
      index = 0;
      if (dialog.open) draw();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make slides: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.slides?.length) {
      deck = chat.slides.slice();
      index = 0;
      draw();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());
  dialog.addEventListener("keydown", (e) => {
    if (!deck.length || !dialog.querySelector(".slide")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  });

  // Show the button only on chats with an answer to present.
  const update = () => { button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && m.content); };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
