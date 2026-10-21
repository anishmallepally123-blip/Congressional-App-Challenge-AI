"""Checks "🔢 Practice problems": it's on the page and its prompt, parsing, answer checking and copy text work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class ProblemsTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="problems.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("problems.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)

    def test_conventions(self):
        js = read("problems.js")
        self.assertIn('"local-ai-practice-problems"', js)
        self.assertIn("findModel(model)?.experimental", js)
        for name in (".hint", ".progress", ".step"):
            self.assertNotIn('class: "%s' % name[1:], js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const P = require(%s);\n" % json.dumps(os.path.join(STATIC, "problems.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };

for (const [grade, words] of [["6-8", "grades 6 to 8"], ["9-10", "grades 9 to 10"], ["11-12", "grades 11 to 12"], ["x", "grades 9 to 10"]]) {
  const m = P.buildPrompt("  two-step equations ", grade, 3);
  check(m.map((x) => x.role), ["system", "user"]);
  check([m[0].content.includes("PROBLEM 1:"), m[0].content.includes("ANSWER:"), m[0].content.includes("STEPS:"), m[0].content.includes(words)], [true, true, true, true]);
  check(m[1].content.includes("exactly 3 practice problems about: two-step equations."), true);
}
check(P.buildPrompt("x", "9-10", 8)[1].content.includes("exactly 8 "), true);
check(P.buildPrompt("x", "9-10", 99)[1].content.includes("exactly 5 "), true);

const plain = "PROBLEM 1: Solve 2x + 3 = 11.\nANSWER: x = 4\nSTEPS: Subtract 3 from both sides, then divide by 2.\n\nPROBLEM 2: Solve 3x - 5 = 10.\nANSWER: x = 5\nSTEPS: Add 5, then divide by 3.";
check(P.parseProblems(plain), [
  { question: "Solve 2x + 3 = 11.", answer: "x = 4", steps: "Subtract 3 from both sides, then divide by 2." },
  { question: "Solve 3x - 5 = 10.", answer: "x = 5", steps: "Add 5, then divide by 3." }]);

// Markdown bold, headings, "Problem 1." and "1)" variants, extra blank lines, answer on the next line; no answer is dropped.
const messy = "Sure! Here are your problems.\n\n**Problem 1.** Find the area of a triangle with base 6 cm and height 4 cm.\n\n\n**Answer:** 12 cm²\n**Steps:** Multiply base by height and halve it.\n\n### Problem 2\nBalance: H2 + O2 -> H2O\n\nAnswer:\n2H2 + O2 -> 2H2O\nSteps: Put a 2 in front of H2 and H2O.\n\n3) Solve x/2 = 7\nAnswer: **x = 14**.\nSteps: Multiply both sides by 2.\n\n4) What is 2 + 2?\nSteps: count";
check(P.parseProblems(messy), [
  { question: "Find the area of a triangle with base 6 cm and height 4 cm.", answer: "12 cm²", steps: "Multiply base by height and halve it." },
  { question: "Balance: H2 + O2 -> H2O", answer: "2H2 + O2 -> 2H2O", steps: "Put a 2 in front of H2 and H2O." },
  { question: "Solve x/2 = 7", answer: "x = 14", steps: "Multiply both sides by 2." }]);
check(P.parseProblems(""), []);
check(P.parseProblems("I can't help with that."), []);

const yes = [["x = 4", "x=4"], ["4", "x=4"], ["4.0", "x=4"], ["X=4", "x = 4"], ["1/2", "0.5"], ["0.50", "1/2"], ["-3/4", "-0.75"],
  ["2 1/2", "2.5"], ["12", "12 cm²"], ["12 square cm", "12 cm^2"], ["$5", "5 dollars"], ["1,000", "1000"], ["3.33", "10/3"],
  ["Paris", "paris."], ["2H2 + O2 → 2H2O", "2H2 + O2 -> 2H2O"], ["x = 2, y = 3", "x=2, y=3"], ["7.0", "x = 7."], ["x = −2", "-2"]];
for (const [a, b] of yes) check([a, b, P.answersMatch(a, b)], [a, b, true]);
const no = [["-4", "x=4"], ["5", "x=4"], ["13", "12 cm²"], ["3", "10/3"], ["", "4"], [null, "4"], ["5x", "5"], ["x = 3, y = 2", "x=2, y=3"], ["London", "Paris"], ["12 and 4", "12"]];
for (const [a, b] of no) check([a, b, P.answersMatch(a, b)], [a, b, false]);

const probs = P.parseProblems(plain);
check(P.score(probs, ["4", "x = 6"]), 1);
check(P.score(probs, ["x=4", "5.0"]), 2);
check(P.score(probs, []), 0);
check(P.asText(probs, "two-step equations"), "Practice problems: two-step equations\n\n1. Solve 2x + 3 = 11.\n\n2. Solve 3x - 5 = 10.\n\nAnswer key:\n1. x = 4 (Subtract 3 from both sides, then divide by 2.)\n2. x = 5 (Add 5, then divide by 3.)");
check(P.asText([{ question: "Q", answer: "A", steps: "" }]), "1. Q\n\nAnswer key:\n1. A");
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
