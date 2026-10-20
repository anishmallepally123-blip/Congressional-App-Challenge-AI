"""Checks "📚 Cite a source": it's on the page and builds MLA and APA citations in the right format."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class CiteTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="cite.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_citations(self):
        source = read("cite.js")
        parts = [re.search(r"  const MLA_MONTHS = .*?;\n  const APA_MONTHS = .*?;\n", source, re.S).group(0),
                 re.search(r"  const sentence = .*?;\n", source).group(0),
                 re.search(r"  const plain = .*?;\n", source).group(0)] + [
            re.search(r"  function %s\(.*?\n  \}\n" % name, source, re.S).group(0)
            for name in ("splitName", "splitDate", "citation", "parseFields")]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const site = { kind: "website", author: "Jane Q. Smith", title: "How Volcanoes Work", container: "National Geographic",
  date: "2024-03-07", url: "https://www.nationalgeographic.com/volcanoes" };
check(plain(citation({ ...site, styleName: "MLA" })),
  'Smith, Jane Q. "How Volcanoes Work." National Geographic, 7 Mar. 2024, www.nationalgeographic.com/volcanoes.');
check(plain(citation({ ...site, styleName: "APA" })),
  "Smith, J. Q. (2024, March 7). How Volcanoes Work. National Geographic. https://www.nationalgeographic.com/volcanoes");
check(citation({ ...site, styleName: "MLA" }).filter(([, i]) => i).map(([t]) => t), ["National Geographic"]);
const book = { kind: "book", author: "Seuss, Dr.", title: "Green Eggs and Ham", publisher: "Random House", date: "1960" };
check(plain(citation({ ...book, styleName: "MLA" })), "Seuss, Dr. Green Eggs and Ham. Random House, 1960.");
check(plain(citation({ ...book, styleName: "APA" })), "Seuss, D. (1960). Green Eggs and Ham. Random House.");
const noAuthor = { kind: "website", author: "", title: "Water Cycle", container: "NASA", date: "", url: "https://nasa.gov/water" };
check(plain(citation({ ...noAuthor, styleName: "MLA" })), '"Water Cycle." NASA, nasa.gov/water.');
check(plain(citation({ ...noAuthor, styleName: "APA" })), "Water Cycle. (n.d.). NASA. https://nasa.gov/water");
const article = { kind: "article", author: "Ana Lopez", title: "Bees Are Back", container: "The Daily News", date: "2025-06", url: "" };
check(plain(citation({ ...article, styleName: "APA" })), "Lopez, A. (2025, June). Bees Are Back. The Daily News.");
check(parseFields("**Author:** Ana Lopez\nTitle: Bees Are Back\nPublisher: none\nPublished: 2025-06-02\nLink:"),
  { author: "Ana Lopez", title: "Bees Are Back", date: "2025-06-02" });
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
