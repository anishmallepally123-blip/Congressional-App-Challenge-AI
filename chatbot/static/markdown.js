// A small Markdown renderer so the app works fully offline (no internet libraries).
// It escapes all HTML first, so text from the model can never inject scripts.
// Supports: headings, bold, italic, inline code, fenced code blocks, lists,
// links, blockquotes, horizontal rules, tables and math (see renderMath below).

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInline(text) {
  const codes = [];
  // Pull out inline code first so nothing inside it gets formatted.
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Then math, so its * and _ aren't read as bold or italic. A lone $ only starts math when
  // it hugs its contents ($x^2$), so prices like "$5 and $10" stay plain text.
  const maths = [];
  text = text.replace(/\$\$(.+?)\$\$|\\\[(.+?)\\\]|\\\((.+?)\\\)|\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, a, b, c, d) => {
    maths.push(renderMath(a ?? b ?? c ?? d, a != null || b != null));
    return `\u0001${maths.length - 1}\u0001`;
  });
  text = escapeHtml(text);
  text = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text
    .replace(/\u0001(\d+)\u0001/g, (_, i) => maths[i])
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[i])}</code>`);
}

// ---------- Math ----------
// Models write math in LaTeX, like \frac{-b \pm \sqrt{b^2-4ac}}{2a}. Rather than load a big
// math library from the internet, this turns the common parts (fractions, powers, roots,
// Greek letters, symbols) into plain HTML. Anything it doesn't know is shown as its name.

const MATH_SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", implies: "⟹", iff: "⟺", mapsto: "↦",
  sum: "∑", prod: "∏", int: "∫", oint: "∮", partial: "∂", nabla: "∇", circ: "∘", degree: "°", angle: "∠",
  triangle: "△", perp: "⊥", parallel: "∥", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃",
  cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", neg: "¬", land: "∧",
  lor: "∨", ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", therefore: "∴", because: "∵", prime: "′",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", "{": "{", "}": "}",
  "%": "%", "$": "$", "&": "&", "#": "#", "_": "_", "|": "‖", ",": "\u2009", ";": "\u2005", ":": "\u2005",
  "!": "", " ": " ", quad: "\u2003", qquad: "\u2003\u2003", displaystyle: "", left: "", right: "",
  big: "", Big: "", bigg: "", Bigg: "", limits: "", nolimits: "",
};
const MATH_FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "mod", "deg"]);
const BLACKBOARD = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" };
const ACCENTS = { hat: "\u0302", vec: "\u20D7", dot: "\u0307", ddot: "\u0308", tilde: "\u0303" };

function renderMath(tex, display) {
  let pos = 0;

  function group() {
    // One argument: {…}, a single command, or a single character.
    while (tex[pos] === " ") pos++;
    if (tex[pos] === "{") {
      pos++;
      const html = run("}");
      pos++;
      return html;
    }
    return atom();
  }

  function rawGroup() {
    while (tex[pos] === " ") pos++;
    if (tex[pos] !== "{") return tex[pos++] || "";
    let depth = 0, start = ++pos;
    while (pos < tex.length && (tex[pos] !== "}" || depth)) {
      if (tex[pos] === "{") depth++;
      else if (tex[pos] === "}") depth--;
      pos++;
    }
    return tex.slice(start, pos++);
  }

  function command() {
    pos++; // the backslash
    let name = tex[pos] || "";
    if (/[a-zA-Z]/.test(name)) name = tex.slice(pos).match(/^[a-zA-Z]+/)[0];
    pos += name.length;
    if (name === "\\") return "<br>";
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const top = group(), bottom = group();
      return `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;
    }
    if (name === "sqrt") {
      let index = "";
      if (tex[pos] === "[") {
        let end = tex.indexOf("]", pos);
        if (end === -1) end = tex.length;
        index = `<sup class="root">${escapeHtml(tex.slice(pos + 1, end))}</sup>`;
        pos = end + 1;
      }
      return `${index}√<span class="sqrt">${group()}</span>`;
    }
    if (name === "text" || name === "mathrm" || name === "operatorname" || name === "textrm") return escapeHtml(rawGroup());
    if (name === "textbf" || name === "mathbf" || name === "boldsymbol") return `<b>${group()}</b>`;
    if (name === "mathbb") return escapeHtml(rawGroup().split("").map((c) => BLACKBOARD[c] || c).join(""));
    if (name === "boxed") return `<span class="boxed">${group()}</span>`;
    if (name === "overline" || name === "bar") return `<span class="over">${group()}</span>`;
    if (name === "underline") return `<u>${group()}</u>`;
    if (ACCENTS[name]) return group() + ACCENTS[name];
    if (name === "begin" || name === "end") { rawGroup(); return ""; }
    if ((name === "left" || name === "right") && tex[pos] === ".") { pos++; return ""; } // an invisible bracket
    if (MATH_FUNCTIONS.has(name)) return `<span class="fn">${name}</span>` + (/[\^_]/.test(tex[pos]) ? "" : "\u2009");
    if (name in MATH_SYMBOLS) return escapeHtml(MATH_SYMBOLS[name]);
    return escapeHtml(name);
  }

  function atom() {
    if (pos >= tex.length) return ""; // e.g. a ^ or \frac at the very end while streaming
    const c = tex[pos];
    if (c === "\\") return command();
    pos++;
    if (/[a-zA-Z]/.test(c)) return `<i>${c}</i>`;
    if (c === "&") return " "; // column breaks in aligned equations
    if (c === "~") return "\u00a0";
    if (c === "'") return "′";
    if (c === "-") return "−";
    if (c === "*") return "∗";
    return escapeHtml(c);
  }

  function run(stop) {
    let html = "";
    while (pos < tex.length && tex[pos] !== stop) {
      const c = tex[pos];
      if (c === "^" || c === "_") {
        pos++;
        let arg = group();
        if (c === "^" && arg === "∘") arg = "°";
        html += c === "^" ? `<sup>${arg}</sup>` : `<sub>${arg}</sub>`;
      } else if (c === "{") {
        html += group();
      } else if (c === "}") {
        pos++; // a stray closing brace
      } else if (/\s/.test(c)) {
        pos++;
        if (!/\s$/.test(html)) html += " ";
      } else {
        html += atom();
      }
    }
    return html;
  }

  const html = run(null).trim();
  return display ? `<span class="math display">${html}</span>` : `<span class="math">${html}</span>`;
}

function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (also handles one that is still streaming in, with no closing fence yet)
    const fence = line.match(/^\s*```\s*([\w+#.-]*)/);
    if (fence) {
      const lang = fence[1];
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(
        `<pre>${lang ? `<span class="lang">${escapeHtml(lang)}</span>` : ""}` +
        `<button class="copy" type="button">Copy</button><code>${escapeHtml(code.join("\n"))}</code></pre>`
      );
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // Display math on its own lines: $$ … $$ or \[ … \] (also while still streaming in)
    const mathOpen = line.trim().match(/^(\$\$|\\\[)/);
    if (mathOpen) {
      const close = mathOpen[1] === "$$" ? "$$" : "\\]";
      let body = line.trim().slice(2);
      while (!body.includes(close) && i + 1 < lines.length) body += "\n" + lines[++i];
      i++;
      const end = body.indexOf(close);
      const after = end === -1 ? "" : body.slice(end + 2).trim();
      out.push(`<div class="math-block">${renderMath(end === -1 ? body : body.slice(0, end), true)}</div>`);
      if (after) out.push(`<p>${renderInline(after)}</p>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    // Table: a header row followed by a |---|---| separator row
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = splitRow(line).map((c) => `<th>${renderInline(c)}</th>`).join("");
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push("<tr>" + splitRow(lines[i++]).map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>");
      }
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
        if (m) { items.push(m[2]); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // Paragraph: gather lines until a blank line or another block starts
    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>|([-*+]|\d+[.)])\s|\$\$|\\\[)/.test(lines[i]) && !isTableRow(lines[i])
    ) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
  }
  return out.join("\n");
}
