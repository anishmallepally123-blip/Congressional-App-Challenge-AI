"""Checks "📜 Primary source analyzer": it's on the page and its prompt, parsing, quote and copy-text helpers work."""
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
    script = "const P = require(%s);\n" % json.dumps(os.path.join(STATIC, "primarysource.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const SOURCE = "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.\n\nNow we are engaged in a great civil war, testing whether that nation can long endure.";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


GOOD = r"""
const reply = "SPEAKER: Abraham Lincoln, the 16th US president\nOCCASION: The dedication of a cemetery at Gettysburg in 1863, during the Civil War\nAUDIENCE: Americans at the ceremony and across the nation\nPURPOSE: To honor fallen soldiers and inspire people to keep fighting for the Union\nSUBJECT: Equality and the survival of the nation\nTONE: Solemn and hopeful\nKEY QUOTE: \"all men are created equal\"\nQUESTIONS:\n- Why does Lincoln go back to 1776?\n- What does he mean by a new nation?";
"""


class PrimarySourceTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="primarysource.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("primarysource.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-primary-source"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => busy?.abort());', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("ps-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_prompt_and_truncation(self):
        self.assertNodeOk(r"""
const m = P.buildPrompt(SOURCE, { title: "  The Gettysburg   Address ", author: "Abraham Lincoln", date: "" });
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["SPEAKER:", "OCCASION:", "AUDIENCE:", "PURPOSE:", "SUBJECT:", "TONE:", "KEY QUOTE:", "QUESTIONS:"]) check(m[0].content.includes(h), true);
check(m[1].content.startsWith("Title: The Gettysburg Address\nAuthor: Abraham Lincoln\n\nPrimary source text:\n\"\"\"\nFour score"), true);
check(P.buildPrompt("Hello there", {})[1].content, "Primary source text:\n\"\"\"\nHello there\n\"\"\"");
const long = P.prepareText("word ".repeat(3000));
check([long.truncated, long.text.length <= P.MAX_TEXT, long.length, long.text.endsWith("word")], [true, true, 14999, true]);
check(P.prepareText("short  text\r\n\r\n\r\n\r\nend"), { text: "short text\n\nend", truncated: false, length: 15 });
check(P.buildPrompt("x".repeat(9000), {})[1].content.length < P.MAX_TEXT + 60, true);
""")

    @NEEDS_NODE
    def test_parse_plain(self):
        self.assertNodeOk(GOOD + r"""
const r = P.parse(reply);
check(r, { speaker: "Abraham Lincoln, the 16th US president", occasion: "The dedication of a cemetery at Gettysburg in 1863, during the Civil War",
  audience: "Americans at the ceremony and across the nation", purpose: "To honor fallen soldiers and inspire people to keep fighting for the Union",
  subject: "Equality and the survival of the nation", tone: "Solemn and hopeful", quote: "all men are created equal",
  questions: ["Why does Lincoln go back to 1776?", "What does he mean by a new nation?"] });
check(P.parsedOk(r), true);
""")

    @NEEDS_NODE
    def test_parse_messy(self):
        # Bold markdown, bullets, lowercase labels, a label on its own line, attribution after the quote, numbered and extra questions, "Not stated".
        self.assertNodeOk(r"""
const messy = "Here is the analysis!\n\n## SOAPSTone\n- **Speaker:** Abraham Lincoln\n* **occasion** - Gettysburg, 1863\n**Audience:**\nThe crowd at the cemetery\nand the whole nation\npurpose: to honor the dead\n**Subject (topic):** equality\nTone: Not stated\n**Key quote:** “Four score and seven years ago” — Lincoln\n**Questions to think about:**\n1. Who are \"our fathers\"?\n2) Why is equality important here?\n3. A third question";
check(P.parse(messy), { speaker: "Abraham Lincoln", occasion: "Gettysburg, 1863", audience: "The crowd at the cemetery and the whole nation",
  purpose: "to honor the dead", subject: "equality", tone: "", quote: "Four score and seven years ago",
  questions: ["Who are \"our fathers\"?", "Why is equality important here?"] });
// Missing fields: fewer than 3 SOAPSTone parts means show the raw answer instead.
check(P.parsedOk(P.parse("SPEAKER: Lincoln\nTONE: sad")), false);
check(P.parsedOk(P.parse("This is a famous speech by Lincoln.")), false);
check(P.parsedOk(P.parse("")), false);
check(P.parse("KEY QUOTE: none\nQUESTIONS: Why now?").quote, "");
check(P.parse("KEY QUOTE: none\nQUESTIONS: Why now?").questions, ["Why now?"]);
""")

    @NEEDS_NODE
    def test_find_quote(self):
        self.assertNodeOk(r"""
const span = P.findQuote("all men are created equal", SOURCE);
check(SOURCE.slice(span[0], span[1]), "all men are created equal");
// Case, curly quotes, extra spaces, trailing punctuation and line breaks don't matter.
check(P.checkQuote("“Four  score and SEVEN years ago,”", SOURCE), true);
check(P.checkQuote("created equal. Now we are engaged", SOURCE), true);
// "..." skips words, but the pieces must appear in order.
check(P.checkQuote("Four score ... a new nation", SOURCE), true);
check(P.checkQuote("a new nation ... Four score", SOURCE), false);
// Made-up or changed words are not found.
check(P.checkQuote("all people are created equal", SOURCE), false);
check(P.checkQuote("government of the people, by the people", SOURCE), false);
check([P.checkQuote("", SOURCE), P.checkQuote("none", SOURCE)], [false, false]);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(GOOD + r"""
const r = P.parse(reply);
check(P.toPlainText(r, { title: "The Gettysburg Address", author: "Abraham Lincoln", date: "1863" }, SOURCE),
  "Primary source analysis: The Gettysburg Address (Abraham Lincoln, 1863)\n\nSpeaker: Abraham Lincoln, the 16th US president\nOccasion: The dedication of a cemetery at Gettysburg in 1863, during the Civil War\nAudience: Americans at the ceremony and across the nation\nPurpose: To honor fallen soldiers and inspire people to keep fighting for the Union\nSubject: Equality and the survival of the nation\nTone: Solemn and hopeful\n\nKey quote: \"all men are created equal\"\n\nQuestions to think about:\n1. Why does Lincoln go back to 1776?\n2. What does he mean by a new nation?");
const made = { speaker: "Lincoln", occasion: "", audience: "", purpose: "", subject: "", tone: "", quote: "of the people, by the people", questions: [] };
check(P.toPlainText(made, {}, SOURCE), "Primary source analysis: Untitled source\n\nSpeaker: Lincoln\nOccasion: Not stated\nAudience: Not stated\nPurpose: Not stated\nSubject: Not stated\nTone: Not stated\n\nKey quote: \"of the people, by the people\" (not found in the text)");
""")


if __name__ == "__main__":
    unittest.main()
