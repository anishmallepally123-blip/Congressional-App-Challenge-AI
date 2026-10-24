"""Checks "⚖️ Compare two things": it's on the page and its prompt, parsing, Venn layout and copy-text helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs Node")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def run_node(body):
    script = "const C = require(%s);\n" % json.dumps(os.path.join(STATIC, "compare.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


GOOD = r"""
const reply = "ONLY A:\n- Makes 2 cells\n- Cells are identical\nONLY B:\n- Makes 4 cells\n- Creates genetic variety\nBOTH:\n- Start with DNA copying\n- Happen in eukaryotes\nCRITERIA:\n- Purpose | Growth and repair | Making sex cells\n- Divisions | One | Two\nBOTTOM LINE: Mitosis copies cells; meiosis makes sex cells.";
"""


class CompareTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="compare.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("compare.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('"local-ai-compare"', js)
        self.assertIn("findModel(model)?.experimental", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => busy?.abort());', js)

    @NEEDS_NODE
    def test_prompt(self):
        self.assertNodeOk(r"""
const m = C.buildPrompt("  Mitosis ", "Meiosis", "Biology");
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["ONLY A:", "ONLY B:", "BOTH:", "CRITERIA:", "BOTTOM LINE:", "|"]) check(m[0].content.includes(h), true);
check(m[1].content, "Compare A and B.\nA = Mitosis\nB = Meiosis\nClass or context: Biology");
check(C.buildPrompt("x", "y", "")[1].content.includes("context"), false);
check(C.buildPrompt("a".repeat(500), "b", "c".repeat(500))[1].content.length < 260, true);
""")

    @NEEDS_NODE
    def test_parse_plain(self):
        self.assertNodeOk(GOOD + r"""
const c = C.parseComparison(reply, "Mitosis", "Meiosis");
check(c, { onlyA: ["Makes 2 cells", "Cells are identical"], both: ["Start with DNA copying", "Happen in eukaryotes"],
  onlyB: ["Makes 4 cells", "Creates genetic variety"],
  criteria: [{ criterion: "Purpose", a: "Growth and repair", b: "Making sex cells" }, { criterion: "Divisions", a: "One", b: "Two" }],
  bottomLine: "Mitosis copies cells; meiosis makes sex cells." });
check(C.parsedOk(c), true);
""")

    @NEEDS_NODE
    def test_parse_messy(self):
        # Markdown, topic names in headings, other bullets, a markdown table, "none", text after a heading.
        self.assertNodeOk(r"""
const messy = "Sure! Here you go.\n\n## **Only Democracy:**\n* People vote for leaders\n• Power can change hands peacefully\n\n**ONLY MONARCHY:** A king or queen rules\n1. Power is inherited\n2) Rules can last for life\n\n**Both:**\n- None\n- Have laws\n\n**Criteria:**\n| Criterion | Democracy | Monarchy |\n|---|---|---|\n| Who rules | Elected leaders | A royal family |\n- How leaders change: Elections | Death or abdication\n- Bad row with one cell\n\n**Bottom line:**\nWho picks the leader is the big difference.";
check(C.parseComparison(messy, "Democracy", "Monarchy"), {
  onlyA: ["People vote for leaders", "Power can change hands peacefully"], both: ["Have laws"],
  onlyB: ["A king or queen rules", "Power is inherited", "Rules can last for life"],
  criteria: [{ criterion: "Who rules", a: "Elected leaders", b: "A royal family" }, { criterion: "How leaders change", a: "Elections", b: "Death or abdication" }],
  bottomLine: "Who picks the leader is the big difference." });
// Missing sections are fine; a reply in no format shows as raw text.
const part = C.parseComparison("BOTH:\n- Are cells", "A", "B");
check([part.both, part.onlyA, part.criteria, C.parsedOk(part)], [["Are cells"], [], [], true]);
check(C.parsedOk(C.parseComparison("They are both kinds of cell division.", "Mitosis", "Meiosis")), false);
check(C.parsedOk(C.parseComparison("", "a", "b")), false);
// A bullet that starts with "only" stays an item.
check(C.parseComparison("ONLY A:\n- Only one division\n- only in body cells: yes", "Mitosis", "Meiosis").onlyA, ["Only one division", "only in body cells: yes"]);
""")

    @NEEDS_NODE
    def test_venn_layout(self):
        self.assertNodeOk(r"""
check(C.truncate("short", 10), "short");
check(C.truncate("Power can change hands peacefully", 17), "Power can change…");
check(C.truncate("abcdefghij", 5).length, 5);
check(C.fitItems([1, 2, 3]), { shown: [1, 2, 3], more: 0 });
check(C.fitItems([1, 2, 3, 4, 5, 6]), { shown: [1, 2, 3, 4, 5, 6], more: 0 });
check(C.fitItems([1, 2, 3, 4, 5, 6, 7, 8, 9]), { shown: [1, 2, 3, 4, 5], more: 4 });
check(C.wrapLines("Makes 2 daughter cells", 17), ["Makes 2 daughter", "cells"]);
check(C.wrapLines("Creates genetic variety in all of the offspring", 17), ["Creates genetic", "variety in all o…"]);
check(C.wrapLines("Short", 17), ["Short"]);
check(C.wrapLines("Supercalifragilisticexpialidocious", 10), ["Supercali…"]);
const many = Array.from({ length: 9 }, (_, i) => `Item number ${i + 1} which is rather long`);
const L = C.vennLayout({ onlyA: many, both: ["DNA"], onlyB: [], criteria: [], bottomLine: "" }, "Mitosis", "A very very long topic name here");
check([L.width, L.height, L.circles.length], [400, 300, 2]);
check(L.titles.map((t) => t.text), ["Mitosis", "A very very long topi…"]);
const a = L.items.filter((i) => i.region === "onlyA");
check(new Set(a.map((i) => i.item)).size, C.MAX_ITEMS);
check(a.length <= 8, true);
check(a.at(-1).text, "+4 more");
check(a.at(-1).more, true);
check(a.every((i) => i.text.length <= 17), true);
check(a[0].full, many[0]);
// Lines stay inside the drawing, in order, and the shared item sits in the middle of the overlap.
check(L.items.every((i) => i.y > 40 && i.y < L.height - 10), true);
check(a.every((i, n) => n === 0 || i.y > a[n - 1].y), true);
check(L.items.filter((i) => i.region === "both").map((i) => [i.x, i.y, i.text]), [[200, 169, "DNA"]]);
check(L.items.filter((i) => i.region === "onlyB").length, 0);
// Phones get a narrower drawing with shorter lines.
const P = C.vennLayout({ onlyA: many, both: [], onlyB: ["x"], criteria: [], bottomLine: "" }, "Mitosis", "Meiosis", 320);
check([P.width, P.height], [320, 240]);
check(P.items.every((i) => i.text.length <= 14 && i.x < 320 && i.y < 240), true);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(GOOD + r"""
const c = C.parseComparison(reply, "Mitosis", "Meiosis");
check(C.toPlainText(c, "Mitosis", "Meiosis", "Biology"), "Mitosis vs. Meiosis (Biology)\n\nOnly Mitosis:\n- Makes 2 cells\n- Cells are identical\n\nBoth:\n- Start with DNA copying\n- Happen in eukaryotes\n\nOnly Meiosis:\n- Makes 4 cells\n- Creates genetic variety\n\nSide by side:\n- Purpose: Mitosis: Growth and repair; Meiosis: Making sex cells\n- Divisions: Mitosis: One; Meiosis: Two\n\nBottom line: Mitosis copies cells; meiosis makes sex cells.");
check(C.toPlainText({ onlyA: [], both: ["x"], onlyB: [], criteria: [], bottomLine: "" }, "A", "B", ""), "A vs. B\n\nBoth:\n- x");
""")


if __name__ == "__main__":
    unittest.main()
