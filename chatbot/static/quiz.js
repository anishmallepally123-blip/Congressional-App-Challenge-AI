// "✅ Quiz me": the AI writes a short multiple-choice quiz about the current chat, and the student
// answers it one question at a time, sees why each answer is right, and gets a score at the end.
// The quiz and the best score are saved with the chat, so it can be retaken later without waiting.
(() => {
  const MAX_QUESTIONS = 5;
  const MAX_CHARS = 6000; // small models have small memories, so only the latest part of a long chat is used
  const LETTERS = ["A", "B", "C", "D"];
  const PROMPT = `Write a multiple-choice quiz with ${MAX_QUESTIONS} questions that checks whether a student understood `
    + "the conversation below. Use exactly this form for every question, with a blank line between questions:\n\n"
    + "Q: the question\nA) a choice\nB) a choice\nC) a choice\nD) a choice\nAnswer: the letter of the right choice\n"
    + "Why: one short sentence explaining the right answer\n\n"
    + "Only one choice may be right. Keep questions and choices short. Ask only about things in the conversation.\n\n"
    + "The conversation:\n\n";

  const style = document.createElement("style");
  style.textContent = `
    #chat-title { flex: 1; }
    #quiz-button { flex-shrink: 0; font-size: 0.85em; padding: 4px 12px; }
    #quiz-dialog { width: min(600px, 94vw); }
    #quiz-dialog .quiz-count { color: var(--muted); font-size: 0.9em; margin: 10px 0 4px; }
    #quiz-dialog .question { font-size: 1.1em; font-weight: 600; margin: 0 0 14px; }
    #quiz-dialog .choices { display: grid; gap: 8px; }
    #quiz-dialog .choices button { text-align: left; padding: 10px 14px; white-space: normal; line-height: 1.4; }
    #quiz-dialog .choices button b { margin-right: 8px; }
    #quiz-dialog .choices button:disabled { opacity: 1; color: inherit; cursor: default; }
    #quiz-dialog .choices button.right { border-color: #2e9d57; background: color-mix(in srgb, #2e9d57 16%, transparent); }
    #quiz-dialog .choices button.wrong { border-color: #d64545; background: color-mix(in srgb, #d64545 16%, transparent); }
    #quiz-dialog .why { margin: 14px 0 0; }
    #quiz-dialog .score { font-size: 2.4em; font-weight: 700; text-align: center; margin: 18px 0 4px; color: var(--accent); }
    #quiz-dialog .review { padding-left: 20px; }
    #quiz-dialog .review li { margin: 6px 0; }
    #quiz-dialog .footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    #quiz-dialog .footer .grow { flex: 1; }`;
  document.head.append(style);

  const button = el("button", { id: "quiz-button", type: "button", title: "Take a short quiz about this chat", hidden: true,
    onclick: () => open() }, "✅ Quiz me");
  $("chat-title").after(button);

  const dialog = el("dialog", { id: "quiz-dialog", "aria-labelledby": "quiz-title" });
  document.body.append(dialog);
  let quiz = [];
  let index = 0;
  let picks = [];
  let making = null;

  // Read the "Q: / A) / Answer: / Why:" blocks, tolerating bold text, numbering and "A." or "(A)" choices.
  function parseQuiz(text) {
    const out = [];
    let q = null;
    const finish = () => {
      if (q && q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length) out.push(q);
      q = null;
    };
    for (let line of text.split("\n")) {
      line = line.replace(/\*\*/g, "").trim();
      let m;
      if ((m = line.match(/^(?:\d+[.)]\s*)?(?:Q(?:uestion)?\s*\d*\s*[:.)])\s*(.+)$/i))) {
        finish();
        q = { question: m[1].trim(), choices: [], answer: -1, why: "" };
      } else if (!q) {
        continue;
      } else if ((m = line.match(/^\(?([A-D])[).:]\s*(.+)$/)) && !/^answer/i.test(line)) {
        if (LETTERS.indexOf(m[1]) === q.choices.length) q.choices.push(m[2].trim().slice(0, 200));
      } else if ((m = line.match(/^(?:correct\s+)?answer\s*[:\-]\s*\(?([A-D])\b/i))) {
        q.answer = LETTERS.indexOf(m[1].toUpperCase());
      } else if ((m = line.match(/^(?:why|explanation)\s*[:\-]\s*(.+)$/i))) {
        q.why = m[1].trim().slice(0, 300);
      }
    }
    finish();
    return out.slice(0, MAX_QUESTIONS);
  }

  function transcript(chat) {
    const text = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n");
    return text.slice(-MAX_CHARS);
  }

  async function makeQuiz(chat) {
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
      if (ev.type === "text") text += ev.text;
      if (ev.type === "error") failed = ev.message;
    });
    if (failed) throw new Error(failed);
    return parseQuiz(text);
  }

  const head = () => el("div", { class: "dialog-head" },
    el("h2", { id: "quiz-title" }, "✅ Quiz me"),
    el("button", { class: "icon close", "aria-label": "Close", onclick: () => dialog.close() }, "✕"));

  function drawQuestion() {
    const q = quiz[index];
    const picked = picks[index];
    const answered = picked !== undefined;
    const choices = q.choices.map((choice, i) => {
      const cls = !answered ? "" : i === q.answer ? "right" : i === picked ? "wrong" : "";
      return el("button", { class: cls, disabled: answered, onclick: () => { picks[index] = i; drawQuestion(); } },
        el("b", {}, LETTERS[i]), choice);
    });
    const last = index === quiz.length - 1;
    dialog.replaceChildren(head(),
      el("p", { class: "quiz-count" }, `Question ${index + 1} of ${quiz.length}`),
      el("p", { class: "question" }, q.question),
      el("div", { class: "choices" }, ...choices),
      answered ? el("p", { class: "why" }, picked === q.answer ? "✅ Right! " : `❌ Not quite. The answer is ${LETTERS[q.answer]}. `, q.why) : null,
      el("div", { class: "footer" }, el("span", { class: "grow" }),
        answered ? el("button", { class: "primary", onclick: () => { if (last) drawScore(); else { index++; drawQuestion(); } } },
          last ? "See my score" : "Next →") : null));
    dialog.querySelector(answered ? ".footer .primary" : ".choices button")?.focus();
  }

  function drawScore() {
    const right = picks.filter((p, i) => p === quiz[i].answer).length;
    const chat = currentChat();
    if (chat) {
      chat.quiz = { questions: quiz, best: Math.max(right, chat.quiz?.best || 0) };
      saveChats();
    }
    const cheer = right === quiz.length ? "Perfect score! 🎉" : right >= quiz.length / 2 ? "Nice work!" : "Keep studying and try again.";
    dialog.replaceChildren(head(),
      el("p", { class: "score" }, `${right} / ${quiz.length}`),
      el("p", { style: "text-align:center;margin:0" }, cheer, chat?.quiz.best > right ? ` Your best is ${chat.quiz.best}.` : ""),
      el("ol", { class: "review" }, ...quiz.map((q, i) =>
        el("li", {}, picks[i] === q.answer ? "✅ " : "❌ ", q.question, el("br"),
          el("span", { class: "note" }, `Answer: ${q.choices[q.answer]}`)))),
      el("p", { class: "note" }, "Made by the AI from this chat. It can make mistakes, so check anything that looks wrong."),
      el("div", { class: "footer" },
        el("button", { class: "primary", onclick: () => start() }, "Take it again"),
        el("span", { class: "grow" }),
        el("button", { onclick: () => remake() }, "↻ New questions")));
  }

  function drawMessage(text, retry) {
    dialog.replaceChildren(head(), el("p", {}, text),
      retry ? el("button", { class: "primary", onclick: () => remake() }, "Try again") : null);
  }

  function start() {
    index = 0;
    picks = [];
    drawQuestion();
  }

  async function remake() {
    const chat = currentChat();
    if (!chat) return;
    drawMessage("Writing quiz questions about this chat... This takes a few seconds with a small model, longer with a big one.");
    try {
      const questions = await makeQuiz(chat);
      if (!questions.length) return drawMessage("The AI didn't write the quiz in a form the app can read. Try again, or pick a bigger model.", true);
      quiz = questions;
      chat.quiz = { questions, best: 0 };
      saveChats();
      if (dialog.open) start();
    } catch (err) {
      if (err.name !== "AbortError") drawMessage(`Couldn't make a quiz: ${err.message}`, true);
    } finally {
      making = null;
    }
  }

  function open() {
    if (controller) return toast("Wait for the answer to finish first.");
    const chat = currentChat();
    dialog.showModal();
    if (chat?.quiz?.questions?.length) {
      quiz = chat.quiz.questions;
      start();
    } else {
      remake();
    }
  }

  dialog.addEventListener("close", () => making?.abort());

  // Show the button once the chat has an answer to be quizzed on.
  const update = () => {
    button.hidden = !currentChat()?.messages.some((m) => m.role === "assistant" && (m.content || "").length > 80);
  };
  new MutationObserver(update).observe(messagesEl, { childList: true });
  update();
})();
