"""Checks "📊 Grade calculator": it's on the page and its grade math, letters, summary and tip prompt work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class GradesTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="grades.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("grades.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('"local-ai-grades"', js)
        self.assertNotIn("dialog.replaceChildren(el", js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const G = require(%s);\n" % json.dumps(os.path.join(STATIC, "grades.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const near = (got, want) => { if (typeof got !== "number" || Math.abs(got - want) > 1e-6) { console.log(got, "!~", want); process.exit(1); } };

// Letters, including the +/- edges.
const L = [[100, "A+"], [97, "A+"], [96.99, "A"], [93, "A"], [92.99, "A-"], [90, "A-"], [89.99, "B+"], [87, "B+"], [86.99, "B"],
  [83, "B"], [82.99, "B-"], [80, "B-"], [79.99, "C+"], [75, "C"], [70, "C-"], [69, "D+"], [65, "D"], [60, "D-"], [59.99, "F"], [0, "F"]];
for (const [p, l] of L) check([p, G.letter(p)], [p, l]);
check([G.letter(NaN), G.letter(null), G.letter(undefined)], ["", "", ""]);
check([G.goalLabel(90), G.goalLabel(80), G.goalLabel(70), G.goalLabel(85)], ["A", "B", "C", "B"]);

// Display rounding never prints NaN or -0.
check([G.fmt(84.46), G.fmt(84.45001), G.fmt(90), G.fmt(-0.01), G.fmt(NaN), G.fmt(null), G.fmt(Infinity)], ["84.5", "84.5", "90", "0", "", "", ""]);

// Weighted grade: blank scores are left out and the rest is normalized by their weight.
near(G.weightedGrade([{ weight: 20, score: 90 }, { weight: 30, score: 80 }, { weight: 50, score: 70 }]), 77);
near(G.weightedGrade([{ weight: "20", score: "90" }, { weight: "30", score: "80" }, { weight: "50", score: "" }]), 84);
near(G.weightedGrade([{ weight: 1, score: 100 }, { weight: 3, score: 60 }]), 70);
check(G.weightedGrade([{ weight: 20, score: "" }, { weight: 30, score: null }]), null);
check(G.weightedGrade([]), null);
check(G.weightedGrade([{ weight: 0, score: 90 }]), null);
check(G.totalWeight([{ weight: "20" }, { weight: "30" }, { weight: "" }, { weight: "-5" }]), 50);

// Inline problems instead of NaN.
check(G.rowProblems([{ name: "Homework", weight: "20", score: "95" }]), []);
check(G.rowProblems([{ name: "Quiz", weight: "0", score: "80" }, { name: "", weight: "20", score: "120" }, { name: "Lab", weight: "", score: "70" }]).map((p) => [p.row, p.field]),
  [[0, "weight"], [1, "score"], [2, "weight"]]);
check(G.rowProblems([{ name: "Empty", weight: "", score: "" }]), []);

// What do I need on the final: (goal - current*(1-w))/w.
near(G.neededOnFinal(80, 20, 80), 80);
near(G.neededOnFinal(85, 25, 90), 105);
near(G.neededOnFinal(78.5, 20, 80), 86);
near(G.neededOnFinal(70, 100, 80), 80);
check(G.neededOnFinal(80, 0, 90), null);
near(G.gradeWithFinal(80, 20, 100), 84);
near(G.gradeWithFinal(80, 20, 0), 64);

const need = G.finalResult(78.5, 20, 80);
check([need.kind, need.text], ["need", "You need 86% on the final to get a B (80%)."]);
near(need.needed, 86);
check(G.finalResult(90, 10, 91).kind, "need"); // needs exactly 100%: still possible
check(G.finalResult(80, 10, 72).kind, "done"); // needs exactly 0%
const reach = G.finalResult(85, 25, 90);
check([reach.kind, reach.text], ["reach", "Getting an A (90%) is out of reach: you'd need 105% on the final. With 100% on the final you'd finish with 88.8% (B+)."]);
const done = G.finalResult(95, 10, 80);
check([done.kind, done.text], ["done", "You've already got a B (80%), even with 0% on the final (you'd finish with 85.5%)."]);
check(G.finalResult(80, 20, 64).kind, "done");
check(G.finalResult(null, 20, 80).kind, "error");
check(G.finalResult(120, 20, 80).text, "Your current grade must be from 0 to 100.");
check(G.finalResult(80, 0, 80).kind, "error");
check(G.finalResult(80, 150, 80).kind, "error");
check(G.finalResult(80, NaN, 80).kind, "error");
check(G.finalResult(80, 20, -1).kind, "error");
check(G.whatIf(80, 20).map((t) => [t.score, G.fmt(t.grade), t.letter]),
  [[60, "76", "C"], [70, "78", "C+"], [80, "80", "B-"], [90, "82", "B-"], [100, "84", "B"]]);

// The whole state: the table feeds the current grade unless the student typed their own.
const state = { rows: [{ name: "Homework", weight: "20", score: "95" }, { name: "Quizzes", weight: "30", score: "82" }, { name: "Tests", weight: "50", score: "74" }],
  current: "", currentEdited: false, finalWeight: "20", goal: "80", tips: "" };
const c = G.compute(state);
near(c.tableGrade, 80.6);
check([c.current, c.finalWeight, c.goal, c.total, c.result.text], [80.6, 20, 80, 100, "You need 77.6% on the final to get a B (80%)."]);
check(G.compute({ ...state, currentEdited: true, current: "70" }).current, 70);
check(G.compute({ ...state, rows: [{ name: "Bad", weight: "20", score: "200" }] }).tableGrade, null);

const text = G.asText({ ...state, tips: "1. **Review** your tests.\n2. Do practice problems.\n3. Sleep well." });
check(text, "Grade calculator\n- Homework (20% of grade): 95%\n- Quizzes (30% of grade): 82%\n- Tests (50% of grade): 74%\nWeighted grade: 80.6% (B-)\n\n"
  + "Current grade: 80.6% (B-). Final is worth 20%. Goal: B (80%).\nYou need 77.6% on the final to get a B (80%).\n"
  + "- 60% on the final → 76.5% (C)\n- 70% on the final → 78.5% (C+)\n- 80% on the final → 80.5% (B-)\n- 90% on the final → 82.5% (B-)\n- 100% on the final → 84.5% (B)\n\n"
  + "Study tips:\n1. Review your tests.\n2. Do practice problems.\n3. Sleep well.");
const blank = G.asText({ rows: [{ name: "", weight: "", score: "" }], current: "", currentEdited: false, finalWeight: "", goal: "", tips: "" });
check(/NaN|null|undefined/.test(blank), false);
check(blank, "Grade calculator\n- Category (?% of grade): no score yet");

// Tip prompt carries the computed numbers and says not to redo the math.
const m = G.buildTipPrompt(state);
check(m.map((x) => x.role), ["system", "user"]);
check([/do not recompute/.test(m[0].content), /exactly 3/.test(m[0].content), m[1].content.includes("Tests: worth 50% of the grade, score 74%"),
  m[1].content.includes("Current grade: 80.6% (B-)"), m[1].content.includes("You need 77.6% on the final")], [true, true, true, true, true]);
check(/NaN|null|undefined/.test(G.buildTipPrompt({ rows: [{ name: "", weight: "", score: "" }], finalWeight: "", goal: "" })[1].content), false);

check(G.tipList("Here you go:\n1. **Redo** quiz mistakes.\n   Focus on fractions.\n2) Make flashcards.\n- Sleep."), ["Redo quiz mistakes. Focus on fractions.", "Make flashcards.", "Sleep."]);
check(G.tipList("Just study a bit every day."), ["Just study a bit every day."]);
check(G.tipList(""), []);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
