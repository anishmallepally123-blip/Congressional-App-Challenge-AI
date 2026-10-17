"""Checks the "🔍 Double-check" script: it's on the page, asks the right thing and reads the verdict."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class DoubleCheckTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="check.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_prompt_and_verdicts(self):
        source = read("check.js")
        verdicts = re.search(r"  const VERDICTS = \[.*?\];\n", source, re.S).group(0)
        prompt = re.search(r"  const prompt = .*?;\n\n", source, re.S).group(0)
        verdict_of = re.search(r"  function verdictOf\(text\) \{.*?\n  \}\n", source, re.S).group(0)
        script = verdicts + prompt + verdict_of + """
const check = (got, want) => { if (got !== want) { console.log(JSON.stringify(got)); process.exit(1); } };
const p = prompt("When did WW2 end?", "It ended in 1946.");
check(p.includes("When did WW2 end?") && p.includes("It ended in 1946."), true);
check(verdictOf("✅ Looks right\\n\\n- Checked the dates.")[1], "good");
check(verdictOf("⚠️ Mostly right, with small issues\\n- one slip")[1], "warn");
check(verdictOf("❌ Has mistakes\\n- 2+2 is 4")[1], "bad");
check(verdictOf("has mistakes: the year is wrong")[1], "bad");
check(verdictOf("I think it's fine."), undefined);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
