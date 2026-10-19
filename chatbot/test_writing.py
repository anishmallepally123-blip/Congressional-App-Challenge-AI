"""Checks "✍️ Check my writing": it's on the page, shows the AI's fixes word by word and counts them."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class WritingTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="writing.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_diff_and_clean(self):
        source = read("writing.js")
        parts = [re.search(r"  const tokens = .*?;\n", source).group(0)] + [
            re.search(r"  function %s\(.*?\n  \}\n" % name, source, re.S).group(0)
            for name in ("diffWords", "countFixes", "cleanReply")]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const before = "Their going to the libary tomorow.\n\nIt was fun.";
const after = "They're going to the library tomorrow.\n\nIt was fun.";
const parts = diffWords(before, after);
check(parts.filter(([k]) => k === "del").map(([, t]) => t.trim()), ["Their", "libary", "tomorow."]);
check(parts.filter(([k]) => k !== "ins").map(([, t]) => t).join(""), before);
check(parts.filter(([k]) => k !== "del").map(([, t]) => t).join(""), after);
check(countFixes(parts), 3);
check(countFixes(diffWords("I like it alot.", "I really like it a lot.")), 2);
check(countFixes(diffWords("All good here.", "All good here.")), 0);
check(cleanReply("Here is the corrected text:\n\nI am happy."), "I am happy.");
check(cleanReply("```\nI am happy.\n```"), "I am happy.");
check(cleanReply('"I am happy."'), "I am happy.");
check(cleanReply('He said "hi" and "bye".'), 'He said "hi" and "bye".');
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
