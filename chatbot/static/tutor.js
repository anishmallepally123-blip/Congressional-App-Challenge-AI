// "🧑‍🏫 Tutor mode": the AI coaches with questions and hints instead of handing over answers,
// so students (and their teachers) can use it for homework without it doing the work for them.
// The instructions themselves live in server.py (TUTOR_PROMPT); this file adds the switch.
(() => {
  const KEY = "local-ai-tutor";
  const input = $("input");
  const normalPlaceholder = input.placeholder;
  let on = false;
  try { on = localStorage.getItem(KEY) === "on"; } catch {}

  const chip = el("button", { type: "button", id: "tutor-toggle", class: "chip", "aria-pressed": String(on),
    title: "The AI helps you work it out with questions and hints, instead of giving you the answer." },
    "🧑‍🏫 Tutor mode");
  $("think-toggle").after(chip);

  function draw() {
    chip.setAttribute("aria-pressed", String(on));
    input.placeholder = on ? "Tutor mode: ask for help and you'll get hints, not answers..." : normalPlaceholder;
  }

  chip.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {}
    draw();
    toast(on ? "Tutor mode is on. The AI will guide you with hints instead of giving answers."
      : "Tutor mode is off.");
    input.focus();
  });

  // Tell the server about tutor mode on chat replies (the requests that carry the model settings),
  // not on helpers like chat titles, flashcards or translations.
  const send = window.fetch.bind(window);
  window.fetch = (url, init) => {
    if (on && url === "/api/chat" && init?.method === "POST" && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if ("settings_by_model" in body) init = { ...init, body: JSON.stringify({ ...body, tutor: true }) };
      } catch {}
    }
    return send(url, init);
  };

  draw();
})();
