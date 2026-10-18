"""Checks "🧠 Mind map": it's on the page and turns the AI's indented list into a map."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class MindMapTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="mindmap.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse_and_wrap(self):
        source = read("mindmap.js")
        limits = "".join(re.findall(r"  const MAX_(?:BRANCHES|LEAVES) = \d+;\n", source))
        parse = re.search(r"  function parseMap\(text, fallbackTitle\) \{.*?\n  \}\n", source, re.S).group(0)
        wrap = re.search(r"  function wrap\(label, width\) \{.*?\n  \}\n", source, re.S).group(0)
        script = limits + parse + wrap + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const labels = (m) => m && [m.label, m.children.map((b) => [b.label, b.children.map((l) => l.label)])];
check(labels(parseMap("Here's your map:\n- **Photosynthesis**\n  - Needs\n    - Sunlight\n    - Water.\n  - Makes\n    - Oxygen\n", "x")),
  ["Photosynthesis", [["Needs", ["Sunlight", "Water"]], ["Makes", ["Oxygen"]]]]);
// No top line: the chat title is the center. Tabs and numbers are fine.
check(labels(parseMap("1. Needs\n\t- Sunlight\n2. Makes\n\t- Oxygen", "Plants")), ["Plants", [["Needs", ["Sunlight"]], ["Makes", ["Oxygen"]]]]);
check(parseMap("just a sentence", "x"), null);
check(parseMap("- Only\n  - one branch", "x"), null);
const many = "- T\n" + Array.from({ length: 9 }, (_, i) => `  - B${i}\n` + "    - leaf\n".repeat(5)).join("");
const big = parseMap(many, "x");
check([big.children.length, big.children[0].children.length], [MAX_BRANCHES, MAX_LEAVES]);
check(wrap("Chlorophyll absorbs light", 16), ["Chlorophyll", "absorbs light"]);
check(wrap("one two three four five six seven", 10).length, 2);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
