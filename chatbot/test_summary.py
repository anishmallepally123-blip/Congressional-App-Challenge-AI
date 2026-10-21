"""Checks "📝 Summarize a reading": it's on the page and its prompt, parsing and word-count helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class SummaryTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="summary.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("summary.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const S = require(%s);\n" % json.dumps(os.path.join(STATIC, "summary.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(S.MAX_CHARS, 6000);
check(S.countWords("  Plants make\n\nfood from   light. "), 5);
check(S.countWords(""), 0);
check(S.countWords(null), 0);

for (const [len, n] of [["short", 3], ["medium", 5], ["detailed", 8], ["weird", 5]]) {
  const m = S.buildPrompt("Some reading.", len);
  check(m.map((x) => x.role), ["system", "user"]);
  check([m[0].content.includes("MAIN IDEA:"), m[0].content.includes("KEY POINTS:"), m[0].content.includes("WORDS TO KNOW:"),
    m[0].content.includes("THINK ABOUT:"), m[0].content.includes(`exactly ${n} points`)], [true, true, true, true, true]);
  check(m[1].content.endsWith("Some reading."), true);
}
check(S.buildPrompt("x".repeat(9000), "short")[1].content.length < 6200, true);

const plain = "MAIN IDEA: Plants turn light into food.\nKEY POINTS:\n- Leaves catch light.\n- Water and CO2 go in.\n- Oxygen comes out.\nWORDS TO KNOW:\n- chlorophyll: the green pigment that catches light\n- glucose: a sugar plants use for energy\nTHINK ABOUT: What would happen to animals without plants?";
const s = S.parseSummary(plain);
check(s, { mainIdea: "Plants turn light into food.", points: ["Leaves catch light.", "Water and CO2 go in.", "Oxygen comes out."],
  terms: [{ term: "chlorophyll", definition: "the green pigment that catches light" }, { term: "glucose", definition: "a sugar plants use for energy" }],
  question: "What would happen to animals without plants?" });
check(S.parsedOk(s), true);
check(S.asText(s), "Main idea: Plants turn light into food.\n\nKey points:\n- Leaves catch light.\n- Water and CO2 go in.\n- Oxygen comes out.\n\nWords to know:\n- chlorophyll: the green pigment that catches light\n- glucose: a sugar plants use for energy\n\nThink about: What would happen to animals without plants?");

// Markdown bold, headings, numbered lists, blank lines, dash definitions, heading text on the next line.
const messy = "Sure! Here are your notes.\n\n**MAIN IDEA:**\nThe water cycle moves water around Earth.\n\n## **Key Points:**\n\n1. Water evaporates.\n2) Vapor condenses into clouds.\n\n\n**Words to Know:**\n* **evaporation** - water turning into gas\n* **Condensation**: gas turning into liquid\n\n**Think about:** *Where does rain come from?*\n";
check(S.parseSummary(messy), { mainIdea: "The water cycle moves water around Earth.", points: ["Water evaporates.", "Vapor condenses into clouds."],
  terms: [{ term: "evaporation", definition: "water turning into gas" }, { term: "Condensation", definition: "gas turning into liquid" }],
  question: "Where does rain come from?" });

// Missing sections are fine; "none" is skipped.
const part = S.parseSummary("MAIN IDEA: Short one.\nWORDS TO KNOW:\n- None\n");
check(part, { mainIdea: "Short one.", points: [], terms: [], question: "" });
check(S.asText(part), "Main idea: Short one.");
check(S.parseSummary("KEY POINTS:\n- a\n- b").points, ["a", "b"]);
check(S.parsedOk(S.parseSummary("KEY POINTS:\n- a")), true);

// Nothing in the format: the app shows the raw reply instead.
const none = S.parseSummary("This reading is about frogs and how they jump.");
check(S.parsedOk(none), false);
check(S.parsedOk(S.parseSummary("")), false);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
