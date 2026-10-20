"""Checks "✅ Quiz me": it's on the page and reads the AI's multiple-choice questions, skipping broken ones."""
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class QuizTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="quiz.js" defer></script>', read("index.html"))

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse(self):
        source = read("quiz.js")
        parts = [re.search(r"  const MAX_QUESTIONS = \d+;\n", source).group(0),
                 re.search(r"  const LETTERS = .*?;\n", source).group(0),
                 re.search(r"  function parseQuiz\(text\) \{.*?\n  \}\n", source, re.S).group(0)]
        script = "".join(parts) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got)); process.exit(1); } };
const text = "Here is your quiz!\n\n**Q1: What gas do plants take in?**\nA) Oxygen\nB) Carbon dioxide\nC) Helium\nD) Nitrogen\n"
  + "**Answer: B**\nWhy: Plants use carbon dioxide to make sugar.\n\n"
  + "2. Question 2: Where does photosynthesis happen?\n(A) Roots\n(B) Chloroplasts\nAnswer - (b)\nExplanation: Chloroplasts hold chlorophyll.\n\n"
  + "Q: A question with no answer line\nA) one\nB) two\n\n"
  + "Q: A question whose answer is missing from the choices\nA) one\nB) two\nAnswer: D\n";
const quiz = parseQuiz(text);
check(quiz.map((q) => q.question), ["What gas do plants take in?", "Where does photosynthesis happen?"]);
check(quiz[0].choices, ["Oxygen", "Carbon dioxide", "Helium", "Nitrogen"]);
check([quiz[0].answer, quiz[1].answer], [1, 1]);
check(quiz[1].why, "Chloroplasts hold chlorophyll.");
check(parseQuiz("Sorry, I can't."), []);
const many = Array.from({ length: 8 }, (_, i) => `Q: q${i}\nA) x\nB) y\nAnswer: A`).join("\n\n");
check(parseQuiz(many).length, MAX_QUESTIONS);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
