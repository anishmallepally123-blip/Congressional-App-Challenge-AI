"""Checks "🧠 Memory tricks": it's on the page and its prompt, parsing, letter checks and copy-text helpers work."""
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
    script = "const M = require(%s);\n" % json.dumps(os.path.join(STATIC, "mnemonic.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const LAKES = ["Huron", "Ontario", "Michigan", "Erie", "Superior"];
const REPLY = "ACRONYM: none\nSENTENCE: My Very Educated Mother Just Served Us Nachos.\nRHYME: Mercury's hot and Venus too,\nEarth and Mars are near to you.";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


class MemoryTricksTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="mnemonic.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("mnemonic.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-memory-tricks"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertIn("window.LocalAIMemoryTricks = LocalAIMemoryTricks", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("mn-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_items_and_prompt(self):
        self.assertNodeOk(r"""
check(M.parseItems("1. Mercury\n- Venus\n\n  Earth  \n* Mars"), ["Mercury", "Venus", "Earth", "Mars"]);
check(M.parseItems("Huron, Ontario, Michigan"), ["Huron", "Ontario", "Michigan"]);
check(M.parseItems(""), []);
check(M.initials(["the Great Lakes", "mitosis", "1st Amendment"]), ["G", "M", "1"]);
const m = M.buildPrompt(PLANETS, "  The planets   in order ");
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["ACRONYM:", "SENTENCE:", "RHYME:", "exact order", "one word per item"]) check(m[0].content.includes(h), true);
check(m[1].content.startsWith("Topic: The planets in order\nThings to memorize, in order (8):\n1. Mercury\n2. Venus\n"), true);
check(m[1].content.endsWith("\n\nFirst letters: M V E M J S U N"), true);
check(M.buildPrompt(["a", "b"], "")[1].content.startsWith("Things to memorize"), true);
""")

    @NEEDS_NODE
    def test_parse(self):
        self.assertNodeOk(r"""
check(M.parseTricks(REPLY), { acronym: "", acronymNote: "none", sentence: "My Very Educated Mother Just Served Us Nachos.",
  rhyme: "Mercury's hot and Venus too,\nEarth and Mars are near to you." });
// Markdown, quotes, an explanation after the acronym, a "STORY" label on its own line.
const md = "Sure! Here are your tricks.\n\n**ACRONYM:** HOMES (Huron, Ontario, Michigan, Erie, Superior)\n\n**Sentence:** \"Hungry Otters Make Excellent Sandwiches!\"\n\n### Story:\nA hungry otter\nmade a sandwich.";
check(M.parseTricks(md), { acronym: "HOMES", acronymNote: "", sentence: "Hungry Otters Make Excellent Sandwiches!", rhyme: "A hungry otter\nmade a sandwich." });
check(M.parsedOk(M.parseTricks(md)), true);
check([M.parsedOk(M.parseTricks("")), M.parsedOk(M.parseTricks("I can't help with that.")), M.parsedOk(null)], [false, false, false]);
""")

    @NEEDS_NODE
    def test_check_letters(self):
        self.assertNodeOk(r"""
check(M.checkSentence("My Very Educated Mother Just Served Us Nachos", PLANETS).ok, true);
check(M.checkSentence("  My very, educated mother -- just served us NACHOS!!", PLANETS).ok, true);
check(M.checkSentence("My Very Educated Mother Just Served Us Nine Pizzas", PLANETS).ok, false);
check(M.checkSentence("My Very Educated Mother Served Just Us Nachos", PLANETS).ok, false);  // sentence must be in order
check(M.checkSentence("", PLANETS).ok, false);
check(M.checkAcronym("HOMES", LAKES), { ok: true, inOrder: true, got: ["H", "O", "M", "E", "S"], want: ["H", "O", "M", "E", "S"] });
const west = ["Superior", "Michigan", "Huron", "Erie", "Ontario"];
check([M.checkAcronym("HOMES", west).ok, M.checkAcronym("HOMES", west).inOrder], [true, false]);  // any order still helps
check(M.checkAcronym("SMHEO", west).inOrder, true);
check(M.checkAcronym("HOME", LAKES).ok, false);
check(M.checkAcronym("HOMEY", LAKES).ok, false);
check(M.checkAcronym("", LAKES).ok, false);
""")

    @NEEDS_NODE
    def test_answers(self):
        self.assertNodeOk(r"""
check(M.checkAnswer("mercury", "Mercury"), true);
check(M.checkAnswer("  MARS  ", "Mars"), true);
check(M.checkAnswer("Lake Erie", "the Lake Erie"), true);
check(M.checkAnswer("The Bill of Rights.", "Bill of Rights"), true);
check(M.checkAnswer("Mars", "Venus"), false);
check(M.checkAnswer("", "Venus"), false);
check(M.checkAnswer("   ", ""), false);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(r"""
const t = M.toPlainText(M.parseTricks(REPLY), PLANETS, "Planets");
check(t.startsWith("Memory tricks: Planets\n1. Mercury\n2. Venus\n"), true);
check(t.includes("\n\nSENTENCE: My Very Educated Mother Just Served Us Nachos. (letters match)\n\nRHYME OR STORY:\nMercury's hot"), true);
check(t.includes("ACRONYM"), false);
check(t.endsWith("\n\n" + M.NOTE), true);
check(M.toPlainText(REPLY, PLANETS, "Planets"), t);
const l = M.toPlainText("ACRONYM: HOMES\nSENTENCE: Hi Oh", ["Superior", "Michigan", "Huron", "Erie", "Ontario"]);
check(l.startsWith("Memory tricks\n1. Superior"), true);
check(l.includes("ACRONYM: HOMES (same letters, different order)"), true);
check(l.includes("SENTENCE: Hi Oh (letters don't match)"), true);
check([M.toPlainText(null), M.toPlainText(""), M.toPlainText("hello")], ["", "", ""]);
check(/null|undefined|NaN/.test(M.toPlainText("RHYME: la", undefined, undefined)), false);
""")


if __name__ == "__main__":
    unittest.main()
