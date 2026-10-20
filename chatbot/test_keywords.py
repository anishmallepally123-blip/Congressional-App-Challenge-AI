"""Checks "📖 Key words": it's on the page and reads the AI's "term: definition" lines."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class KeywordsTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="keywords.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse(self):
        source = read("keywords.js")
        parts = [re.search(r"  const MAX_TERMS = \d+;\n", source).group(0),
                 re.search(r"  function parseTerms\(.*?\n  \}\n", source, re.S).group(0)]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Here are the key words:\n\n1. **Photosynthesis**: How plants make food from sunlight.\n"
  + "- Chlorophyll - The green pigment that catches light.\n* Glucose: A sugar the plant uses for energy.\n"
  + "Term: Definition\nphotosynthesis: a repeat that should be skipped\nno separator here";
check(parseTerms(text).map((t) => t.term), ["Photosynthesis", "Chlorophyll", "Glucose"]);
check(parseTerms(text)[1].meaning, "The green pigment that catches light.");
check(parseTerms(Array.from({ length: 15 }, (_, i) => `word${i}: meaning ${i}`).join("\n")).length, MAX_TERMS);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
