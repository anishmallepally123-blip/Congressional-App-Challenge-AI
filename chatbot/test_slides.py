"""Checks "📽️ Slides": it's on the page, reads the AI's slides, and the downloaded page escapes text."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class SlidesTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="slides.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse_and_download(self):
        source = read("slides.js")
        max_slides = re.search(r"  const MAX_SLIDES = \d+;\n", source).group(0)
        parse = re.search(r"  function parseSlides\(text\) \{.*?\n  \}\n", source, re.S).group(0)
        page = re.search(r"  function slidesPage\(title, slides\) \{.*?\n`;\n  \}\n", source, re.S).group(0)
        script = max_slides + parse + page + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Sure! Here are your slides:\n\n# Photosynthesis\n- How plants make food\n\n## Slide 2: **What plants need**\n* Sunlight\n1. Water\n2) Carbon dioxide\n\nSlide 3: Key takeaways\n- Light makes sugar\n";
check(parseSlides(text), [
  { title: "Photosynthesis", points: ["How plants make food"] },
  { title: "What plants need", points: ["Sunlight", "Water", "Carbon dioxide"] },
  { title: "Key takeaways", points: ["Light makes sugar"] },
]);
check(parseSlides("no slides here\n- a stray point"), []);
check(parseSlides(Array.from({ length: 12 }, (_, i) => `# S${i}`).join("\n")).length, MAX_SLIDES);
const html = slidesPage("A <b> test", [{ title: "<script>alert(1)</script>", points: ["x & y"] }, { title: "Two", points: [] }]);
check(html.includes("<script>alert(1)") , false);
check(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && html.includes("x &amp; y") && html.includes("<title>A &lt;b&gt; test</title>"), true);
check((html.match(/<section/g) || []).length, 2);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
