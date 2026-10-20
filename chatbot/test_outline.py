"""Checks "🗂️ Outline an essay": it's on the page and reads the AI's thesis, body points and conclusion."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class OutlineTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="outline.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse(self):
        source = read("outline.js")
        parts = [re.search(r"  const MAX_POINTS = \d+;\n", source).group(0)] + [
            re.search(r"  function %s\(.*?\n  \}\n" % name, source, re.S).group(0) for name in ("parseOutline", "asText")]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Sure! Here is an outline.\n\n**THESIS:** Schools should start later because teens need sleep.\n\n"
  + "**1. Teens' body clocks shift later**\n- Melatonin is released later in teens\n* Doctors recommend 8-10 hours\n"
  + "Body paragraph 2: Better grades and attendance\n- Studies of later start times\n"
  + "3) Safer mornings\n\nCONCLUSION: Restate why a later start helps students.";
const o = parseOutline(text);
check(o.thesis, "Schools should start later because teens need sleep.");
check(o.points.map((p) => p.title), ["Teens' body clocks shift later", "Better grades and attendance", "Safer mornings"]);
check(o.points[0].details, ["Melatonin is released later in teens", "Doctors recommend 8-10 hours"]);
check(o.conclusion, "Restate why a later start helps students.");
check(parseOutline("I can't help with that."), null);
check(asText({ ...o, topic: "Start times" }).split("\n").slice(0, 5), ["Topic: Start times", "", `Thesis: ${o.thesis}`, "", "1. Teens' body clocks shift later"]);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
