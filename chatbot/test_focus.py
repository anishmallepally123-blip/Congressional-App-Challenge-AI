"""Checks "🎯 Focus timer": it's on the page and its clock, pause and today's-totals helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class FocusTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="focus.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const F = require(%s);\n" % json.dumps(os.path.join(STATIC, "focus.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(F.formatClock(754000), "12:34");
check(F.formatClock(25 * 60000), "25:00");
check(F.formatClock(1), "00:01");
check(F.formatClock(0), "00:00");
check(F.formatClock(-5000), "00:00");
check(F.formatClock(45 * 60000 + 999), "45:01");
const s = { goal: "Math", minutes: 25, end: 1000000 };
check(F.remaining(s, 1000000 - 90000), 90000);
check(F.remaining(s, 2000000), 0);
check(F.remaining(null, 5), 0);
const p = F.pause(s, 1000000 - 60000);
check(p.pausedLeft, 60000);
check(F.remaining(p, 9e12), 60000);
check(F.pause(p, 0), p);
const r = F.resume(p, 5000000);
check([r.end, "pausedLeft" in r, F.remaining(r, 5000000)], [5060000, false, 60000]);
check(F.localIso(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
const log = [
  { goal: "old", minutes: 45, result: "yes", date: "2026-10-20" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ goal: "g" + n, minutes: 15, result: "partly", date: "2026-10-21" })),
];
const t = F.todayStats(log, "2026-10-21");
check([t.sessions, t.minutes, t.recent.map((x) => x.goal)], [6, 90, ["g6", "g5", "g4", "g3", "g2"]]);
check(F.todayStats(null, "2026-10-21"), { sessions: 0, minutes: 0, recent: [] });
let big = [];
for (let i = 0; i < 105; i++) big = F.addToLog(big, { goal: "x" + i });
check([big.length, big[0].goal, big[99].goal], [100, "x5", "x104"]);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
