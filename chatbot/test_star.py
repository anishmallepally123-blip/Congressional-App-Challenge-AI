"""Checks the "☆ Star" script: it's on the page and lists starred answers newest first, with search."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class StarTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="star.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_starred_list(self):
        source = read("star.js")
        shown = re.search(r"  function shownMessages\(chat\) \{.*?\n  \}\n", source, re.S).group(0)
        question = re.search(r"  function questionFor\(chat, m\) \{.*?\n  \}\n", source, re.S).group(0)
        starred = re.search(r"  function starred\(list, query = \"\"\) \{.*?\n  \}\n", source, re.S).group(0)
        preview = re.search(r"  function preview\(text\) \{.*?\n  \}\n", source, re.S).group(0)
        script = shown + question + starred + preview + """
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const chats = [
  { title: "Biology", messages: [
    { role: "user", content: "What does chlorophyll do?" },
    { role: "tool", content: "ignored" },
    { role: "assistant", content: "It absorbs light.", star: 100 },
    { role: "user", content: "And roots?" },
    { role: "assistant", content: "They take in water." } ] },
  { title: "Math", messages: [
    { role: "user", content: "Area of a circle?" },
    { role: "assistant", content: "**A = πr²**", star: 200 } ] },
];
check(starred(chats).map((s) => s.question), ["Area of a circle?", "What does chlorophyll do?"]);
check(starred(chats, "LIGHT").map((s) => s.m.content), ["It absorbs light."]);
check(starred(chats, "math").length, 1);
check(starred(chats, "roots").length, 0);
check(preview("# Title\\n\\n```py\\nprint(1)\\n```\\n**bold**  text"), "Title [code] bold text");
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
