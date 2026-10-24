"""Checks "🔗 Cause and effect": it's on the page and its prompt, parsing and copy-text helpers work."""
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
    script = "const C = require(%s);\n" % json.dumps(os.path.join(STATIC, "causeeffect.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


GOOD = r"""
const reply = "CAUSES:\n- Stock market crash of 1929\n- Banks failed\n- Too much debt\nSHORT-TERM EFFECTS:\n- Millions lost jobs\n- Businesses closed\nLONG-TERM EFFECTS:\n- New Deal programs\n- Social Security\nWHY IT MATTERS: It shaped how the government handles the economy today.";
"""


class CauseEffectTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="causeeffect.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("causeeffect.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-cause-effect"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => busy?.abort());', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        import re
        self.assertTrue(all(c.startswith("ce-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_prompt(self):
        self.assertNodeOk(r"""
const m = C.buildPrompt("  The Great   Depression ", "US History");
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["CAUSES:", "SHORT-TERM EFFECTS:", "LONG-TERM EFFECTS:", "WHY IT MATTERS:"]) check(m[0].content.includes(h), true);
check(m[1].content, "Event or phenomenon: The Great Depression\nClass or context: US History");
check(C.buildPrompt("Deforestation", "")[1].content, "Event or phenomenon: Deforestation");
check(C.buildPrompt("a".repeat(500), "c".repeat(500))[1].content.length < 280, true);
""")

    @NEEDS_NODE
    def test_parse_plain(self):
        self.assertNodeOk(GOOD + r"""
const r = C.parse(reply);
check(r, { causes: ["Stock market crash of 1929", "Banks failed", "Too much debt"], shortTerm: ["Millions lost jobs", "Businesses closed"],
  longTerm: ["New Deal programs", "Social Security"], why: "It shaped how the government handles the economy today." });
check(C.parsedOk(r), true);
""")

    @NEEDS_NODE
    def test_parse_messy(self):
        # Markdown, other bullets, numbered lists, "of X" headings, text after a heading, "none", a plain "Effects" section.
        self.assertNodeOk(r"""
const messy = "Sure! Here is the breakdown.\n\n## **Causes of the French Revolution:**\n* Heavy taxes on the poor\n• Food shortages\n1. Ideas of the Enlightenment\n2) **King Louis XVI** was weak\n\n**Short term effects:** The monarchy ended\n- None\n- The Reign of Terror\n\n### Long-term effects\n- Spread of democracy in Europe\n- Napoleon rose to power\n\n**Why it matters:**\nIt showed that ordinary people could change a government.";
check(C.parse(messy), {
  causes: ["Heavy taxes on the poor", "Food shortages", "Ideas of the Enlightenment", "King Louis XVI was weak"],
  shortTerm: ["The monarchy ended", "The Reign of Terror"],
  longTerm: ["Spread of democracy in Europe", "Napoleon rose to power"],
  why: "It showed that ordinary people could change a government." });
const plainEffects = C.parse("Causes:\n- Logging\n- Farming\nEffects:\n- Habitat loss\n- Effects: more floods");
check([plainEffects.shortTerm, plainEffects.longTerm], [["Habitat loss", "Effects: more floods"], []]);
""")

    @NEEDS_NODE
    def test_parse_limits(self):
        self.assertNodeOk(r"""
const many = "CAUSES:\n" + Array.from({ length: 10 }, (_, i) => `- Cause ${i + 1}`).join("\n") + "\n- Cause 1\nLONG-TERM EFFECTS:\n- " + "x".repeat(400);
const r = C.parse(many);
check(r.causes.length, C.MAX_ITEMS);
check(r.causes.at(-1), "Cause 6");
check(r.longTerm[0].length <= 140, true);
check(C.parsedOk(r), true);
// Missing sections are fine, but it needs a cause and an effect to draw a diagram.
check(C.parsedOk(C.parse("CAUSES:\n- Logging")), false);
check(C.parsedOk(C.parse("Deforestation is when forests are cut down.")), false);
check(C.parsedOk(C.parse("")), false);
check(C.parse("WHY IT MATTERS: one\ntwo").why, "one two");
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(GOOD + r"""
const r = C.parse(reply);
check(C.toPlainText(r, "The Great Depression", "US History"), "Cause and effect: The Great Depression (US History)\n\nCauses:\n- Stock market crash of 1929\n- Banks failed\n- Too much debt\n\nShort-term effects:\n- Millions lost jobs\n- Businesses closed\n\nLong-term effects:\n- New Deal programs\n- Social Security\n\nWhy it matters: It shaped how the government handles the economy today.");
check(C.toPlainText({ causes: ["a"], shortTerm: [], longTerm: ["b"], why: "" }, "X", ""), "Cause and effect: X\n\nCauses:\n- a\n\nLong-term effects:\n- b");
""")


if __name__ == "__main__":
    unittest.main()
