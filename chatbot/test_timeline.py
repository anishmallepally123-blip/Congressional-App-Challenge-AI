"""Checks "🕰️ Timeline": it's on the page, reads the AI's events and sorts them by date, BC first."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class TimelineTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="timeline.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse_and_sort(self):
        source = read("timeline.js")
        parts = [re.search(r"  const MAX_EVENTS = \d+;\n", source).group(0),
                 re.search(r"  const MONTHS = .*?;\n", source).group(0),
                 re.search(r"  function sortKey\(when\) \{.*?\n  \}\n", source, re.S).group(0),
                 re.search(r"  function parseEvents\(text\) \{.*?\n  \}\n", source, re.S).group(0)]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Here is the timeline:\n| Date | Event |\n|---|---|\n| 1865 | Lincoln is assassinated |\n"
  + "- **January 1, 1863** | Emancipation Proclamation takes effect\n2. 1861: The Civil War begins\n"
  + "July 4, 1863 - Union wins at Vicksburg\n44 BC | Julius Caesar is killed\n1860s | Railroads spread west\nno date here\n";
check(parseEvents(text).map((e) => e.when), ["44 BC", "1860s", "1861", "January 1, 1863", "July 4, 1863", "1865"]);
check(parseEvents("NONE"), []);
check(sortKey("3000 BCE") < sortKey("44 BC"), true);
check(sortKey("March 1863") < sortKey("November 19, 1863"), true);
check(parseEvents(Array.from({ length: 20 }, (_, i) => `${1900 + i} | event`).join("\n")).length, MAX_EVENTS);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
