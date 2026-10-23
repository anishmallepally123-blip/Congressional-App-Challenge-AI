"""Checks "🧐 Fact or opinion": it's on the page and its sentence splitting, prompt, parsing and marking helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class FactOpinionTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="factopinion.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("factopinion.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)

    def test_conventions(self):
        js = read("factopinion.js")
        self.assertIn('localStorage.getItem(SAVE_KEY)', js)
        self.assertIn('"local-ai-fact-opinion"', js)
        self.assertIn("findModel(model)?.experimental", js)
        self.assertIn('$("personal-link").before(link)', js)
        for name in (".hint", ".progress", ".step"):
            self.assertNotIn(name + " ", js)
        self.assertIn("button:disabled { opacity: 1; color: inherit; }", js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const F = require(%s);\n" % json.dumps(os.path.join(STATIC, "factopinion.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(F.MAX_CHARS, 4000);
check(F.MAX_SENTENCES, 40);

// Sentence splitting: titles, initialisms, decimals, money, times, quotes, ellipses, paragraphs.
check(F.splitSentences("Mr. Smith went to Washington, D.C. on Monday. He paid $3.50 for coffee! Was it worth it? \"No,\" he said."),
  ["Mr. Smith went to Washington, D.C. on Monday.", "He paid $3.50 for coffee!", "Was it worth it?", "\"No,\" he said."]);
check(F.splitSentences("The U.S. economy grew 2.1% last year. Dr. Kim and Mrs. Lee agree. See No. 5 for more. I said no. Then I left"),
  ["The U.S. economy grew 2.1% last year.", "Dr. Kim and Mrs. Lee agree.", "See No. 5 for more.", "I said no.", "Then I left"]);
check(F.splitSentences("She said, \"It's great.\" Others disagreed. 'Really?' Yes."),
  ["She said, \"It's great.\"", "Others disagreed.", "'Really?'", "Yes."]);
check(F.splitSentences("“Wow!” said Kim. Class starts at 8 a.m. on Monday. John F. Kennedy spoke."),
  ["“Wow!” said Kim.", "Class starts at 8 a.m. on Monday.", "John F. Kennedy spoke."]);
check(F.splitSentences("Wait... what happened? Nothing.\n\nNew paragraph here\nwith no period"),
  ["Wait... what happened?", "Nothing.", "New paragraph here", "with no period"]);
check(F.splitSentences("  Prices rose   3.5 percent.\r\nThe end.  "), ["Prices rose 3.5 percent.", "The end."]);
check(F.splitSentences(""), []);
check(F.splitSentences(null), []);
check(F.splitSentences("One sentence without an end"), ["One sentence without an end"]);
check(F.splitSentences("Line one.\n\"\nLine two."), ["Line one. \"", "Line two."]);
check(F.splitSentences("Short. ".repeat(60)).length, 40);
check(F.splitSentences("Short. ".repeat(60), 41).length, 41);
const ex = F.splitSentences(F.EXAMPLE);
check(ex.length, 7);
check(ex[0].includes("7:30 a.m. to 8:15 a.m. next fall."), true);
check(ex[2].startsWith("Dr. Lena Ortiz"), true);

const m = F.buildPrompt(["Taxes rose 5%.", "That is awful."]);
check(m.map((x) => x.role), ["system", "user"]);
check([m[0].content.includes("FACT"), m[0].content.includes("OPINION"), m[0].content.includes("LOADED"), m[0].content.includes("ASK:")], [true, true, true, true]);
check(m[1].content.endsWith("1: Taxes rose 5%.\n2: That is awful."), true);
check(F.buildPrompt(Array(50).fill("A."))[1].content.includes("41: "), false);

const reply = "1: FACT — the vote count and date can be checked in board minutes\n2: FACT — a cost from a named office\n"
  + "3: OPINION — \"the right choice\" is her view\n4: LOADED — \"disaster\" and \"wreck\" are emotional words\n"
  + "ASK:\n- Who ran the survey?\n- What do students say?";
const r = F.parseLabels(reply, 5);
check(r.labels, [
  { n: 1, kind: "fact", reason: "the vote count and date can be checked in board minutes", words: [] },
  { n: 2, kind: "fact", reason: "a cost from a named office", words: [] },
  { n: 3, kind: "opinion", reason: "\"the right choice\" is her view", words: [] },
  { n: 4, kind: "loaded", reason: "\"disaster\" and \"wreck\" are emotional words", words: ["disaster", "wreck"] },
  { n: 5, kind: "unknown", reason: "", words: [] }]);
check(r.questions, ["Who ran the survey?", "What do students say?"]);
check(F.parsedOk(r), true);

// Markdown, "Sentence 1:", "1.", lowercase, brackets, curly and single quotes, numbered questions, duplicates.
const messy = "Sure! Here you go.\n\n**Sentence 1:** **FACT** - checkable number\n2. opinion: a judgment\n* 3) [Loaded] uses “ruin” and 'shameful'\n"
  + "1: OPINION — duplicate, ignored\n9: FACT — out of range\n### Questions to ask:\n1. Who wrote this?\n2. What is missing?\n";
const r2 = F.parseLabels(messy, 3);
check(r2.labels.map((l) => [l.kind, l.reason, l.words]), [["fact", "checkable number", []], ["opinion", "a judgment", []], ["loaded", "uses “ruin” and 'shameful'", ["ruin", "shameful"]]]);
check(r2.questions, ["Who wrote this?", "What is missing?"]);
check(F.parsedOk(F.parseLabels("I can't do that.", 3)), false);
check(F.parseLabels("", 2).labels.map((l) => l.kind), ["unknown", "unknown"]);
check(F.parseLabels("1: FACT", 0).labels, []);

// Bold loaded words: case-insensitive, whole words only, only ones present, overlaps merged.
check(F.markWords("A Disaster that will wreck schedules.", ["disaster", "wreck", "chaos"]),
  [{ text: "A ", bold: false }, { text: "Disaster", bold: true }, { text: " that will ", bold: false }, { text: "wreck", bold: true }, { text: " schedules.", bold: false }]);
check(F.markWords("Careless and scary.", ["care"]), [{ text: "Careless and scary.", bold: false }]);
check(F.markWords("a total disaster", ["total disaster", "disaster"]), [{ text: "a ", bold: false }, { text: "total disaster", bold: true }]);
check(F.markWords("Cost (est.) rose.", ["(est.)", ""]), [{ text: "Cost ", bold: false }, { text: "(est.)", bold: true }, { text: " rose.", bold: false }]);
check(F.markWords("", []), [{ text: "", bold: false }]);

check(F.counts(r.labels), { fact: 2, opinion: 1, loaded: 1, unknown: 1 });
check(F.countsText({ fact: 5, opinion: 3, loaded: 2, unknown: 0 }), "5 facts to check · 3 opinions · 2 loaded");
check(F.countsText({ fact: 1, opinion: 1, loaded: 0, unknown: 0 }), "1 fact to check · 1 opinion · 0 loaded");

const t = F.asText(["Taxes rose.", "Awful.", "Huh"], F.parseLabels("1: FACT — a number\n2: LOADED — \"awful\"\nASK:\n- Who says so?", 3));
check(t, "1. [FACT] Taxes rose. (a number)\n2. [LOADED] Awful. (\"awful\")\n3. [?] Huh\n\n1 fact to check · 0 opinions · 1 loaded\n\nQuestions to ask:\n- Who says so?\n\nFacts here are claims you can check, not things the AI has confirmed are true.");
check(/null|undefined|NaN/.test(t), false);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
