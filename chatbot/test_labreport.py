"""Checks "🔬 Lab report": it's on the page and its prompt, parsing, to-do list and results-table helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class LabReportTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="labreport.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("labreport.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertIn('"local-ai-lab-report"', js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const L = require(%s);\n" % json.dumps(os.path.join(STATIC, "labreport.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(L.MAX_CHARS, 5000);

const m = L.buildPrompt("Salt and boiling", "0g 100°C");
check(m.map((x) => x.role), ["system", "user"]);
const sys = m[0].content;
check(["QUESTION:", "HYPOTHESIS: If ..., then ..., because ...", "VARIABLES: independent:", "MATERIALS:", "PROCEDURE:", "RESULTS:", "CONCLUSION:", "NEXT TIME:",
  "ONLY", "Never make up numbers", "[ADD:"].map((s) => sys.includes(s)), Array(11).fill(true));
check([m[1].content.includes("EXPERIMENT TITLE: Salt and boiling"), m[1].content.endsWith("0g 100°C")], [true, true]);
check(L.buildPrompt("", "notes")[1].content.includes("TITLE"), false);
check(L.buildPrompt("t", "x".repeat(9000))[1].content.length < 5200, true);

const plain = "QUESTION: Does salt raise the boiling point of water?\nHYPOTHESIS: If I add more salt, then the water will boil at a higher temperature, because salt gets in the way of water molecules escaping.\n"
  + "VARIABLES: independent: amount of salt; dependent: boiling temperature; controlled: 500 mL water, same pot, same burner\n"
  + "MATERIALS:\n- pot\n- kitchen thermometer\n- salt\nPROCEDURE:\n1. Measure 500 mL of water.\n2. Add the salt and stir.\n3. Heat and read the temperature.\n"
  + "RESULTS: 0g boiled at 100°C, 10g at 100.8°C and 20g at 101.5°C.\nCONCLUSION: The data supports the hypothesis.\nNEXT TIME: Use a digital thermometer.";
const lab = L.parseLab(plain);
check(lab, { question: "Does salt raise the boiling point of water?",
  hypothesis: "If I add more salt, then the water will boil at a higher temperature, because salt gets in the way of water molecules escaping.",
  variables: { independent: "amount of salt", dependent: "boiling temperature", controlled: "500 mL water, same pot, same burner" },
  materials: ["pot", "kitchen thermometer", "salt"], procedure: ["Measure 500 mL of water.", "Add the salt and stir.", "Heat and read the temperature."],
  results: "0g boiled at 100°C, 10g at 100.8°C and 20g at 101.5°C.", conclusion: "The data supports the hypothesis.", nextTime: "Use a digital thermometer." });
check(L.parsedOk(lab), true);
check(L.missingItems(lab), []);
check(L.asText(lab, "Salt"), "Lab report: Salt\n\nQuestion: Does salt raise the boiling point of water?\n\nHypothesis: If I add more salt, then the water will boil at a higher temperature, because salt gets in the way of water molecules escaping.\n\n"
  + "Variables:\n- Independent variable: amount of salt\n- Dependent variable: boiling temperature\n- Controlled variables: 500 mL water, same pot, same burner\n\n"
  + "Materials:\n- pot\n- kitchen thermometer\n- salt\n\nProcedure:\n1. Measure 500 mL of water.\n2. Add the salt and stir.\n3. Heat and read the temperature.\n\n"
  + "Results: 0g boiled at 100°C, 10g at 100.8°C and 20g at 101.5°C.\n\nConclusion: The data supports the hypothesis.\n\nNext time: Use a digital thermometer.");

// Markdown bold and headings, bulleted procedure, numbered materials, variables on their own lines, blank lines, missing sections.
const messy = "Here is your lab report!\n\n## **Question:**\nDo plants grow taller with more light?\n\n**Hypothesis:** If plants get more light, then they grow taller, because they make more food.\n\n"
  + "### Variables\n- **Independent variable:** hours of light\n- Dependent: plant height (cm)\n- Controlled: same soil; same water\n\n**MATERIALS**\n1. 4 bean plants\n2) ruler\n\n\n"
  + "**Procedure:**\n* Put plants under the lamp.\n* Measure every day.\n\n**Results:**\n- Plant A: 12 cm\n- Plant B: [ADD: height of plant B]\n\n**Conclusion:** [ADD: your conclusion after the data is in]\n";
const ml = L.parseLab(messy);
check(ml, { question: "Do plants grow taller with more light?", hypothesis: "If plants get more light, then they grow taller, because they make more food.",
  variables: { independent: "hours of light", dependent: "plant height (cm)", controlled: "same soil; same water" },
  materials: ["4 bean plants", "ruler"], procedure: ["Put plants under the lamp.", "Measure every day."],
  results: "Plant A: 12 cm\nPlant B: [ADD: height of plant B]", conclusion: "[ADD: your conclusion after the data is in]", nextTime: "" });
check(L.missingItems(ml), ["height of plant B", "your conclusion after the data is in", "Next time (empty)"]);

const part = L.parseLab("QUESTION: Why?\nVARIABLES: independent: [ADD: what you changed]\n");
check(L.missingItems(part), ["what you changed", "Hypothesis (empty)", "Dependent variable (empty)", "Controlled variables (empty)",
  "Materials (empty)", "Procedure (empty)", "Results (empty)", "Conclusion (empty)", "Next time (empty)"]);
check(L.asText(part, ""), "Question: Why?\n\nVariables:\n- Independent variable: [ADD: what you changed]");
check(L.parsedOk(L.parseLab("My experiment was fun.")), false);
check(L.parsedOk(L.parseLab("")), false);

// Results table: only simple, consistent "label value unit" pairs.
check(L.numbersTable("Tested salt. 3 trials each with 0g, 10g, 20g salt in 500 mL. Averages: 0g 100°C, 10g 100.8°C, 20g 101.5°C."),
  { columns: ["What you changed (g)", "What you measured (°C)"], rows: [["0 g", "100 °C"], ["10 g", "100.8 °C"], ["20 g", "101.5 °C"]] });
check(L.numbersTable("1 m: 2.1 s; 2 m: 2.9 s; 3 m: 3.6 s"), { columns: ["What you changed (m)", "What you measured (s)"], rows: [["1 m", "2.1 s"], ["2 m", "2.9 s"], ["3 m", "3.6 s"]] });
check(L.numbersTable("0g 100°C"), null);
check(L.numbersTable("0g 100°C, 10 mL 3 s"), null);
check(L.numbersTable("5 cm 10 cm and 6 cm 12 cm"), null);
check(L.numbersTable("The plant grew a lot over 3 weeks."), null);
check(L.numbersTable(""), null);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
