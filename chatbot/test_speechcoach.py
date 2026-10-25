"""Checks "🎤 Speech coach": it's on the page and its word, time, filler, sentence, prompt, parsing and copy-text helpers work."""
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
    script = "const C = require(%s);\n" % json.dumps(os.path.join(STATIC, "speechcoach.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const SPEECH = "Um, good morning everyone. Today I want to talk about our school garden. It is basically a classroom without walls, you know.";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


GOOD = r"""
const reply = "STRONG OPENING: no - It starts with \"um\" and a plain greeting instead of a hook.\nSTRENGTHS:\n- Clear topic in the second sentence\n- Vivid image of a classroom without walls\n- Short, easy sentences\nIMPROVEMENTS:\n- Drop the filler words\n- Add a fact or number\n- End with a call to action\nSUGGESTED OPENING: \"What if our next classroom had no walls at all?\"";
"""


class SpeechCoachTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="speechcoach.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("speechcoach.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-speech-coach"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); stopTimer(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("sc-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_words_time_and_target(self):
        self.assertNodeOk(r"""
check(C.countWords(SPEECH), 22);
check(C.countWords("Don't stop — it's a well-known fact, 100%!"), 7);
check([C.countWords(""), C.countWords("   "), C.countWords(null)], [0, 0, 0]);
check(C.speakingTime(260), { seconds: 120, slow: 142, fast: 104 });
check(C.speakingTime(0), { seconds: 0, slow: 0, fast: 0 });
check([C.formatTime(65), C.formatTime(120), C.formatTime(5), C.formatTime(-3)], ["1:05", "2:00", "0:05", "0:00"]);
check(C.targetCheck(300, 2), { target: 260, diff: 40, status: "over" });
check(C.targetCheck(200, 2), { target: 260, diff: -60, status: "under" });
check(C.targetCheck(250, 2).status, "on");
check(C.targetCheck(130, 1.5), { target: 195, diff: -65, status: "under" });
// Long text is cut to the limit at a word.
const long = C.prepareText("word ".repeat(2000));
check([long.truncated, long.text.length <= C.MAX_TEXT, long.length, long.text.endsWith("word")], [true, true, 9999, true]);
check(C.prepareText("a  b\r\n\r\n\r\n c"), { text: "a b\n\nc", truncated: false, length: 6 });
""")

    @NEEDS_NODE
    def test_fillers_whole_words(self):
        self.assertNodeOk(r"""
const f = C.findFillers(SPEECH);
check([f.total, f.counts], [3, { um: 1, basically: 1, "you know": 1 }]);
check(f.matches.map((m) => SPEECH.slice(m.start, m.end)), ["Um", "basically", "you know"]);
// Whole words only: "likely", "Umbrella", "veryfast", "reallyy", "unknown" don't count.
check(C.findFillers("It is likely an umbrella; veryfast and reallyy unknown, alike, liked.").total, 0);
// Multiword fillers across spaces and line breaks; case doesn't matter; punctuation next to them is fine.
const m = C.findFillers("You  know, it's KIND OF\nsort of like... really, very (actually) literally uh");
check(m.counts, { "you know": 1, "kind of": 1, "sort of": 1, like: 1, really: 1, very: 1, actually: 1, literally: 1, uh: 1 });
check(C.findFillers("I don't know you. You knowledge.").total, 0);
check(C.findFillers("").total, 0);
""")

    @NEEDS_NODE
    def test_sentence_stats(self):
        self.assertNodeOk(r"""
const long = "This " + "very long sentence keeps going and ".repeat(6) + "ends.";
const s = C.sentenceStats("Hi there. How are you today?\n\n" + long + " Short one!");
check(s.count, 4);
check(s.longest.map((x) => x.words), [38, 4, 2]);
check(s.long.length, 1);
check(s.long[0].text.startsWith("This very long"), true);
check(s.average, 11.5);
// A paragraph without a full stop is still a sentence; empty text has none.
check(C.sentenceStats("Thank you\nand goodbye").count, 2);
check(C.sentenceStats(""), { count: 0, average: 0, longest: [], long: [] });
check(C.analyze(SPEECH, 1).target, { target: 130, diff: -108, status: "under" });
""")

    @NEEDS_NODE
    def test_parse_coaching(self):
        self.assertNodeOk(GOOD + r"""
const c = C.parseCoaching(reply);
check(c, { opening: "no", why: "It starts with \"um\" and a plain greeting instead of a hook.",
  strengths: ["Clear topic in the second sentence", "Vivid image of a classroom without walls", "Short, easy sentences"],
  improvements: ["Drop the filler words", "Add a fact or number", "End with a call to action"],
  newOpening: "What if our next classroom had no walls at all?" });
check(C.parsedOk(c), true);
// Markdown, a "?" label, labels on their own lines, numbered items, extra items and other names.
const messy = "Sure! Here's my feedback.\n\n## **Strong opening?** Yes, the question grabs attention.\n**Strengths:**\n1. Good energy\n2) Clear points\n3. Nice ending\n4. Extra one\n**Things to improve:**\n* Slow down\n**Suggested new opening line:**\n\"Picture this: a garden on our roof.\"";
check(C.parseCoaching(messy), { opening: "yes", why: "the question grabs attention.", strengths: ["Good energy", "Clear points", "Nice ending"],
  improvements: ["Slow down"], newOpening: "Picture this: a garden on our roof." });
// Not enough parts means show the raw answer instead.
check(C.parsedOk(C.parseCoaching("This is a nice speech, good job!")), false);
check(C.parsedOk(C.parseCoaching("STRENGTHS:\n- Nice")), false);
check(C.parsedOk(C.parseCoaching("")), false);
""")

    @NEEDS_NODE
    def test_prompt_and_plain_text(self):
        self.assertNodeOk(GOOD + r"""
const m = C.buildPrompt(SPEECH, 2);
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["STRONG OPENING:", "STRENGTHS:", "IMPROVEMENTS:", "SUGGESTED OPENING:"]) check(m[0].content.includes(h), true);
check(m[1].content, "Target length: 2:00 minutes\nWords: 22 (about 0:10 at 130 words per minute)\nFiller words: 3\nAverage sentence: 7.3 words\n\nSpeech script:\n\"\"\"\n" + SPEECH + "\n\"\"\"");
check(C.buildPrompt("x ".repeat(6000), 1)[1].content.length < C.MAX_TEXT + 200, true);
const stats = "Speech coach: target 2:00 (about 260 words)\n\nWords: 22\nSpeaking time: about 0:10 (0:09 fast to 0:12 slow)\nLength: 238 words under the target\nFiller words: 3 (um ×1, basically ×1, you know ×1)\nSentences: 3, average 7.3 words";
check(C.toPlainText(SPEECH, 2, C.parseCoaching(reply)), stats + "\n\nStrong opening? No: It starts with \"um\" and a plain greeting instead of a hook.\n\nStrengths:\n- Clear topic in the second sentence\n- Vivid image of a classroom without walls\n- Short, easy sentences\n\nImprovements:\n- Drop the filler words\n- Add a fact or number\n- End with a call to action\n\nSuggested new opening: \"What if our next classroom had no walls at all?\"");
check(C.toPlainText(SPEECH, 2, "  Nice speech!  "), stats + "\n\nCoaching:\nNice speech!");
check(C.toPlainText(SPEECH, 2, null), stats);
""")


if __name__ == "__main__":
    unittest.main()
