"""Checks "📖 Reading level": it's on the page and its syllable, readability, prompt, parsing and copy-text helpers work."""
import json
import os
import re
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs Node")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def run_node(body):
    script = "const C = require(%s);\n" % json.dumps(os.path.join(STATIC, "readinglevel.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const near = (got, want, slack, what) => { if (!(Math.abs(got - want) <= slack)) { console.log(what, got, "not within", slack, "of", want); process.exit(1); } };
const SIMPLE = "The cat sat on the mat. It was a warm day. The dog ran to the park and back.";
const HARD = "Photosynthesis is the biochemical process by which autotrophic organisms convert electromagnetic radiation into chemical energy. "
  + "Chlorophyll molecules within the chloroplasts preferentially absorb photons, initiating light-dependent reactions that ultimately generate carbohydrates.";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


class ReadingLevelTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="readinglevel.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("readinglevel.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-reading-level"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("rl-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_syllables(self):
        self.assertNodeOk(r"""
const want = { the: 1, table: 2, cake: 1, readability: 6, beautiful: 3, photosynthesis: 5, simple: 2, apple: 2, dog: 1, water: 2, energy: 3, little: 2 };
for (const [w, n] of Object.entries(want)) near(C.countSyllables(w), n, 1, w);
check([C.countSyllables("the"), C.countSyllables("cake"), C.countSyllables("table")], [1, 1, 2]);
check([C.countSyllables("Cake!"), C.countSyllables("A"), C.countSyllables("42"), C.countSyllables(""), C.countSyllables(null)], [1, 1, 1, 0, 0]);
""")

    @NEEDS_NODE
    def test_readability(self):
        self.assertNodeOk(r"""
const easy = C.readability(SIMPLE), hard = C.readability(HARD);
check([easy.words, easy.sentences, hard.sentences], [19, 3, 2]);
check(easy.grade < hard.grade, true);
check(easy.ease > hard.ease, true);
check(easy.grade <= 3, true);
check(hard.grade > 12, true);
check([C.gradeText(easy.grade), C.gradeText(hard.grade), C.gradeText(6.4), C.gradeText(12.4), C.gradeText(12.6)], ["Grade 1", "College", "Grade 6", "Grade 12", "College"]);
check([C.easeLabel(95), C.easeLabel(65), C.easeLabel(40), C.easeLabel(10)], ["Very easy", "Plain", "Hard", "Very hard"]);
// Grade stays 0 to 18 and ease 0 to 100, even for one giant sentence.
const huge = C.readability("Incomprehensibilities ".repeat(80));
check([huge.grade, huge.ease, huge.sentences], [18, 0, 1]);
// Empty and one-word text give numbers, never NaN.
for (const t of ["", "   ", null, "Hello", "Hello."]) {
  const r = C.readability(t);
  check([r.grade, r.ease, r.words, r.sentences].every(Number.isFinite), true);
}
check(C.readability(""), { grade: 0, ease: 0, label: "No text yet", words: 0, sentences: 0, syllables: 0 });
check(C.readability("Hello").sentences, 1);
// "3.5" is not the end of a sentence; a line break is.
check(C.countSentences("It is 3.5 meters long. Yes!\nNo"), 3);
""")

    @NEEDS_NODE
    def test_parse_rewrite(self):
        self.assertNodeOk(r"""
const reply = "REWRITTEN:\nPlants make their own food.\n\nThey use sunlight to do it.\nWORD CHANGES:\n- photosynthesis -> how plants make food\n- absorb -> take in";
check(C.parseRewrite(reply), { rewritten: "Plants make their own food.\n\nThey use sunlight to do it.",
  changes: [{ from: "photosynthesis", to: "how plants make food" }, { from: "absorb", to: "take in" }] });
// Bold labels, text on the label line, other arrows, numbered and starred items, duplicates and "None".
const messy = "Sure! Here you go.\n**REWRITTEN:** Plants use light.\n**Word changes:**\n1. **predominantly** → mostly\n* \"initiating\" => starting\n- byproduct - extra thing\n- Predominantly -> mainly\nNone";
check(C.parseRewrite(messy), { rewritten: "Plants use light.",
  changes: [{ from: "predominantly", to: "mostly" }, { from: "initiating", to: "starting" }, { from: "byproduct", to: "extra thing" }] });
// No WORD CHANGES; no REWRITTEN label at all; at most 8 changes; light-dependent isn't split.
check(C.parseRewrite("REWRITTEN:\nPlants use light."), { rewritten: "Plants use light.", changes: [] });
check(C.parseRewrite("Plants use light to make sugar.\n\nThat sugar is food."), { rewritten: "Plants use light to make sugar.\n\nThat sugar is food.", changes: [] });
check(C.parseRewrite("Plants use light.\nWORD CHANGES:\nlight-dependent -> needs light"), { rewritten: "Plants use light.", changes: [{ from: "light-dependent", to: "needs light" }] });
const many = "REWRITTEN: x\nWORD CHANGES:\n" + Array.from({ length: 12 }, (_, i) => `- word${i} -> w${i}`).join("\n");
check(C.parseRewrite(many).changes.length, 8);
check(C.parseRewrite(""), { rewritten: "", changes: [] });
""")

    @NEEDS_NODE
    def test_prompt(self):
        self.assertNodeOk(r"""
const m = C.buildPrompt(HARD, "6");
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["REWRITTEN:", "WORD CHANGES:", "hard word -> simpler word", "6th grade", "Keep every fact"]) check(m[0].content.includes(h), true);
check(m[1].content, "Target: Grade 6\nThe text is now about College (Flesch-Kincaid).\n\nText:\n\"\"\"\n" + HARD + "\n\"\"\"");
check(C.buildPrompt(HARD, "keep")[1].content.startsWith("Target: same level, just clearer\n"), true);
check(C.buildPrompt(HARD, "3")[0].content.includes("3rd grade"), true);
check(C.buildPrompt(HARD, "weird")[0].content.includes("6th grade"), true);
check(C.TARGETS.map((t) => t.label), ["Grade 3", "Grade 6", "Grade 9", "Keep level, just clearer"]);
// Long text is cut to the limit at a word.
check(C.buildPrompt("word ".repeat(3000), "6")[1].content.length < C.MAX_TEXT + 200, true);
const long = C.prepareText("word ".repeat(2000));
check([long.truncated, long.text.length <= C.MAX_TEXT, long.length, long.text.endsWith("word")], [true, true, 9999, true]);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(r"""
const reply = "**REWRITTEN:**\nPlants make food.   \n\n\n\nThey use light.\nWORD CHANGES:\n- absorb -> take in";
check(C.toPlainText(C.parseRewrite(reply)), "Plants make food.\n\nThey use light.");
check(C.toPlainText(reply), "Plants make food.\n\nThey use light.");
check([C.toPlainText(null), C.toPlainText(""), C.toPlainText({})], ["", "", ""]);
// The rewrite scores lower than the original.
check(C.readability(C.toPlainText(reply)).grade < C.readability(HARD).grade, true);
""")


if __name__ == "__main__":
    unittest.main()
