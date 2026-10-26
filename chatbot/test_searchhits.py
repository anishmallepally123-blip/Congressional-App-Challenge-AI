"""Checks the search snippets: they're on the page and show the matching words without markdown."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class SearchHitsTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="searchhits.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_snippet(self):
        source = read("searchhits.js")
        plain = re.search(r"  const plain = .*?;\n", source).group(0)
        snippet = re.search(r"  function snippet\(text, q\) \{.*?\n  \}\n", source, re.S).group(0)
        # A tiny stand-in for the page, just enough for snippet() to build its row.
        script = """
const document = { createElement: () => ({ parts: [], append(...p) { this.parts.push(...p); },
  set textContent(t) { this.parts = [t]; }, get text() { return this.parts.map((p) => p.text ?? p).join(""); } }) };
""" + plain + snippet + """
const check = (got, want) => { if (got !== want) { console.log(JSON.stringify(got)); process.exit(1); } };
check(snippet("The **mitochondria** is the powerhouse of the cell.", "mitochondria").text,
  "The mitochondria is the powerhouse of the cell.");
const long = "x".repeat(50) + " Steam engines changed factories and " + "y".repeat(100);
const s = snippet(long, "steam").text;
check(s.startsWith("…") && s.endsWith("…") && s.includes("Steam engines"), true);
check(snippet("nothing here", "steam"), null);
check(snippet("```python\\nprint(1)\\n```", "print").text, "print(1)");
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
