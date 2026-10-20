"""Checks "🧮 Check my steps": it's on the page, splits the student's working into steps and reads the AI's verdict."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class StepsTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="steps.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_split_and_verdict(self):
        source = read("steps.js")
        parts = [re.search(r"  const MAX_STEPS = \d+;\n", source).group(0),
                 re.search(r"  const splitSteps = .*?\.slice\(0, MAX_STEPS\);\n", source, re.S).group(0),
                 re.search(r"  function parseVerdict\(.*?\n  \}\n", source, re.S).group(0)]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
check(splitSteps("1. 3x + 5 = 20\n\nStep 2: 3x = 25\n  x = 25/3  \n"), ["3x + 5 = 20", "3x = 25", "x = 25/3"]);
check(splitSteps(Array.from({ length: 30 }, (_, i) => `x${i}`).join("\n")).length, MAX_STEPS);
check(parseVerdict("**VERDICT: STEP 2**\nWHY: You added 5 instead of subtracting it.\n**HINT:** What undoes +5?", 3),
  { wrong: 2, why: "You added 5 instead of subtracting it.", hint: "What undoes +5?" });
check(parseVerdict("Verdict: Correct", 3), { wrong: 0, why: "", hint: "" });
check(parseVerdict("VERDICT: STEP 7\nWHY: x", 3), null);
check(parseVerdict("I think it looks fine.", 3), null);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
