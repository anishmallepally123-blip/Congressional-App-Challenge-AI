"""Checks "📚 Book companion": it's on the page and its prompt, parsing and copy-text helpers work."""
import json
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs Node")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def run_node(body):
    script = "const B = require(%s);\n" % json.dumps(os.path.join(STATIC, "book.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const REPLY = "MAIN CHARACTERS:\n- Scout Finch — the curious young narrator\n- Atticus Finch — Scout's calm, fair father, a lawyer\n- Jem Finch — Scout's older brother\n\n"
  + "THEMES:\n- Courage — Atticus explains real courage to Jem\n- Prejudice — how the town talks about the Radleys\n\n"
  + "SYMBOLS:\n- The mockingbird — innocence that should be protected\n\n"
  + "DISCUSSION QUESTIONS:\n1. Who tells the story?\n2. Why are the kids curious about Boo Radley?\n3. What does Atticus mean by walking in someone's skin?\n4. How does Maycomb treat outsiders?\n5. Is Atticus a good father? Why?\n\n"
  + "ESSAY IDEAS:\n1. Harper Lee uses Scout's young voice to show how children learn prejudice.\n2. Atticus shows that courage is quiet, not loud.";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


class BookTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="book.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("book.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-book"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertIn('$("input")', js)
        self.assertIn('new Event("input", { bubbles: true })', js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("bk-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_prompt(self):
        self.assertNodeOk(r"""
const m = B.buildPrompt("  To Kill a   Mockingbird ", "Harper Lee", "Chapter 10", "");
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["read up to: Chapter 10", "No spoilers", "after that point", "MAIN CHARACTERS:", "THEMES:", "SYMBOLS:", "DISCUSSION QUESTIONS:", "ESSAY IDEAS:", "exactly 5", "exactly 2"]) check(m[0].content.includes(h), true);
check(m[0].content.includes("passage"), false);
check(m[1].content, "Book: To Kill a Mockingbird\nAuthor: Harper Lee\nI have read up to: Chapter 10");
const none = B.buildPrompt("Holes", "", "", "");
check(none[1].content, "Book: Holes\nI have read up to: not given");
check(none[0].content.includes("only use the first few chapters"), true);
""")

    @NEEDS_NODE
    def test_passage(self):
        self.assertNodeOk(r"""
const m = B.buildPrompt("Holes", "Louis Sachar", "finished", "Stanley   was sent\n\n\n\nto Camp Green Lake.");
check(m[0].content.includes("Ground your answers in that passage"), true);
const Q = '"'.repeat(3);
check(m[1].content.endsWith(`Passage I pasted:\n${Q}\nStanley was sent\n\nto Camp Green Lake.\n${Q}`), true);
const long = "word ".repeat(2000);
check(B.passageTooLong(long), true);
check(B.passageTooLong("short"), false);
check(B.buildPrompt("Holes", "", "", long)[1].content.length < B.MAX_PASSAGE + 120, true);
""")

    @NEEDS_NODE
    def test_parse(self):
        self.assertNodeOk(r"""
const b = B.parseBook(REPLY);
check(b.characters[0], { name: "Scout Finch", desc: "the curious young narrator" });
check(b.characters.length, 3);
check(b.themes, [{ name: "Courage", where: "Atticus explains real courage to Jem" }, { name: "Prejudice", where: "how the town talks about the Radleys" }]);
check(b.symbols, [{ name: "The mockingbird", meaning: "innocence that should be protected" }]);
check(b.questions.length, 5);
check(b.questions[0], "Who tells the story?");
check(b.essays.length, 2);
check(B.parsedOk(b), true);
check([B.parsedOk(B.parseBook("")), B.parsedOk(B.parseBook("I don't know that book.")), B.parsedOk(null)], [false, false, false]);
""")

    @NEEDS_NODE
    def test_parse_messy(self):
        self.assertNodeOk(r"""
// Markdown headers, bold names, "-" and ":" separators, sub-lines, unbulleted questions, too many items, a missing section.
const md = "Sure! Here you go.\n\n## **Main Characters**\n* **Scout** - the narrator\n* **Atticus**: her father\n* Jem — brother\n* Dill — summer friend\n* Calpurnia — the cook\n* Boo Radley — the hidden neighbor\n* Miss Maudie — kind neighbor\n\n"
  + "**Themes:**\n1. **Growing up**\n   Where you see it: Scout starts school\n2. Justice - the trial is coming\n3. Fear: the Radley house\n4. Family — Aunt Alexandra\n5. Extra — too many\n\n"
  + "### Discussion Questions\nWhy does Scout fight\nat school?\nWhat is Boo like?\n- Q3?\n- Q4?\n- Q5?\n- Q6?\n\n**Essay Ideas:** Courage is shown in many forms.";
const b = B.parseBook(md);
check(b.characters.map((c) => c.name), ["Scout", "Atticus", "Jem", "Dill", "Calpurnia", "Boo Radley"]);
check(b.characters[1].desc, "her father");
check(b.themes, [{ name: "Growing up", where: "Scout starts school" }, { name: "Justice", where: "the trial is coming" }, { name: "Fear", where: "the Radley house" }, { name: "Family", where: "Aunt Alexandra" }]);
check(b.symbols, []);
check(b.questions, ["Why does Scout fight at school?", "What is Boo like?", "Q3?", "Q4?", "Q5?"]);
check(b.essays, ["Courage is shown in many forms."]);
check(B.parsedOk(b), true);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(r"""
const info = { title: "To Kill a Mockingbird", author: "Harper Lee", progress: "Chapter 10" };
const t = B.toPlainText(B.parseBook(REPLY), info);
check(t.startsWith("Book companion: To Kill a Mockingbird by Harper Lee (read up to: Chapter 10)\n\nMAIN CHARACTERS\n- Scout Finch — the curious young narrator\n"), true);
check(t.includes("\n\nDISCUSSION QUESTIONS\n1. Who tells the story?\n2. "), true);
check(t.includes("\n\nESSAY IDEAS\n1. Harper Lee uses"), true);
check(t.endsWith("\n\n" + B.NOTE), true);
check(B.NOTE, "The AI may get details wrong about books, especially less famous ones. Check with the text.");
check(B.toPlainText(REPLY, info), t);
check(B.toPlainText(REPLY).startsWith("Book companion\n\n"), true);
check([B.toPlainText(null), B.toPlainText(""), B.toPlainText("hello")], ["", "", ""]);
check(/null|undefined|NaN/.test(B.toPlainText("THEMES:\n- Hope\nQUESTIONS:\n1. Why?", { title: "X" })), false);
""")


if __name__ == "__main__":
    unittest.main()
