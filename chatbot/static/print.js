// Print a chat as a clean page, for study notes or homework help to hand in or keep:
// no sidebar, buttons or message box, just the questions and answers with the chat's title.
// It also tidies Ctrl+P, since the rules apply to any print.
(function () {
  const style = document.createElement("style");
  style.textContent = `
    #print-chat { margin-left: auto; flex: none; }
    #print-heading { display: none; }
    @media print {
      :root { color-scheme: light; }
      html, body { height: auto !important; background: #fff !important; color: #111 !important; display: block !important; }
      #sidebar, #scrim, #composer-wrap, header, dialog, #toast, .actions, .thinking, .switch-banner,
      .welcome, .suggestions, button { display: none !important; }
      main, #messages { display: block !important; overflow: visible !important; height: auto !important; padding: 0 !important; }
      #print-heading { display: block; margin: 0 0 18px; padding-bottom: 8px; border-bottom: 1px solid #bbb; }
      #print-heading h1 { font-size: 1.35em; margin: 0 0 2px; }
      #print-heading p { margin: 0; color: #555; font-size: 0.85em; }
      .msg { max-width: none; margin: 0 0 16px; break-inside: avoid-page; }
      .msg.user .content { background: none !important; padding: 0 !important; margin: 0 !important; max-width: none !important;
        width: auto !important; border-radius: 0; font-weight: 600; }
      .msg.user .content::before { content: "Q: "; color: #888; }
      .msg.assistant .content { color: #111; }
      pre, code { white-space: pre-wrap !important; overflow-wrap: anywhere; background: #f4f4f4 !important; color: #111 !important; }
      pre { border: 1px solid #ddd; break-inside: avoid; }
      a { color: #111; }
      @page { margin: 16mm 14mm; }
    }
  `;
  document.head.append(style);

  const messages = document.getElementById("messages");
  const button = document.createElement("button");
  button.id = "print-chat";
  button.className = "icon";
  button.title = "Print this chat";
  button.setAttribute("aria-label", "Print this chat");
  button.textContent = "🖨 Print";
  button.hidden = true;
  button.addEventListener("click", () => window.print());
  document.querySelector("main > header").append(button);

  const hasChat = () => !!messages.querySelector(".msg.user, .msg.assistant");
  new MutationObserver(() => { button.hidden = !hasChat(); }).observe(messages, { childList: true });

  // A title line at the top of the printed page: the chat's name and today's date.
  window.addEventListener("beforeprint", () => {
    document.getElementById("print-heading")?.remove();
    if (!hasChat()) return;
    const heading = document.createElement("div");
    heading.id = "print-heading";
    const title = document.createElement("h1");
    title.textContent = document.getElementById("chat-title").textContent;
    const line = document.createElement("p");
    const models = [...new Set([...messages.querySelectorAll(".model-tag")].map((t) => t.textContent.trim()).filter(Boolean))];
    line.textContent = `From Local AI Chat, ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}` +
      (models.length ? ` · Answers by ${models.join(", ")}` : "") + " · AI can make mistakes, so check important facts.";
    heading.append(title, line);
    messages.prepend(heading);
  });
  window.addEventListener("afterprint", () => document.getElementById("print-heading")?.remove());
})();
