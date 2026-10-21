"""Checks "⚖️ Debate practice": it's on the page and reads the AI's score and feedback lines."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class DebateTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="debate.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse_feedback(self):
        source = read("debate.js")
        script = re.search(r"  function parseFeedback\(.*?\n  \}\n", source, re.S).group(0) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
check(parseFeedback("**Score:** 7/10\n**Strong point:** You used a real example.\n- Try next time: Answer my point first."),
  { score: 7, strong: "You used a real example.", next: "Answer my point first." });
check(parseFeedback("Score: 8\nStrong point: Clear reasons."), { score: 8, strong: "Clear reasons.", next: null });
check(parseFeedback("I'd give you 6 out of 10 overall.\nTry next time - use numbers."), { score: 6, strong: null, next: "use numbers." });
check(parseFeedback("Great job debating!"), { score: null, strong: null, next: null });
check(parseFeedback("Score: 42"), { score: null, strong: null, next: null });
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
