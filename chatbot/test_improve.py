"""Checks the "✨ Improve" button script: it's on the page and its instructions stay safe."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class ImproveTest(unittest.TestCase):
    def test_page_loads_it_after_app_js(self):
        page = read("index.html")
        self.assertIn('<script src="improve.js" defer></script>', page)  # defer runs it after app.js

    def test_instructions_keep_the_users_meaning(self):
        ask = read("improve.js")
        for rule in ("Keep the same goal", "Don't answer it", "don't add facts", "only the rewritten message"):
            self.assertIn(rule, ask)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_tidy_strips_labels_and_quotes(self):
        source = read("improve.js")
        tidy = re.search(r"  function tidy\(text\) \{.*?\n  \}\n", source, re.S).group(0)
        script = tidy + """
const cases = [
  ['Rewritten message: "Explain gravity simply."', 'Explain gravity simply.'],
  ["Here is the improved prompt: Write a poem about rain.", "Write a poem about rain."],
  ["“Summarize chapter 3.”", "Summarize chapter 3."],
  ['Explain what "gravity" means.', 'Explain what "gravity" means.'],
];
for (const [given, want] of cases) if (tidy(given) !== want) { console.log(JSON.stringify(tidy(given))); process.exit(1); }
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
