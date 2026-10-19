"""Checks "📅 Study plan": it's on the page, reads the AI's "Day 1: ..." lines and puts them on real dates."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class StudyPlanTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="studyplan.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse_and_schedule(self):
        source = read("studyplan.js")
        parts = [re.search(r"  const iso = .*?  const daysBetween = .*?;\n", source, re.S).group(0)] + [
            re.search(r"  function %s\(.*?\n  \}\n" % name, source, re.S).group(0) for name in ("parsePlan", "schedule")]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Here is your plan:\n**Day 1:** Learn the parts of the water cycle\n- Day 2 - Evaporation and condensation\n"
  + "Day 2: a repeat that should be ignored\nDay 3. Precipitation\nDay 9: past the test, ignored\nGood luck!";
check(parsePlan(text, 4), ["Learn the parts of the water cycle", "Evaporation and condensation", "Precipitation"]);
check(parsePlan("Sorry, I can't.", 3), []);
const plan = schedule(["a", "b", "c"], "2026-10-30");
check(plan.map((d) => d.date), ["2026-10-30", "2026-10-31", "2026-11-01"]);
check(daysBetween("2026-10-30", "2026-11-04"), 5);
check(daysBetween("2026-03-07", "2026-03-09"), 2);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True, env={**os.environ, "TZ": "America/New_York"})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
