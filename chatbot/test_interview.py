"""Checks "💼 Interview practice": it's on the page and its prompts, parsing and scoring helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class InterviewTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="interview.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("interview.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)

    def test_no_shared_class_names(self):
        js = read("interview.js")
        for name in ('"hint"', '"progress"', '"step"', ".hint ", ".progress ", ".step "):
            self.assertNotIn(name, js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const I = require(%s);\n" % json.dumps(os.path.join(STATIC, "interview.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(Object.keys(I.TYPES), ["job", "college", "scholarship", "internship", "club"]);
check(I.countWords("  I worked at\n\nthe   library. "), 5);
check(I.countWords(null), 0);

for (const t of Object.keys(I.TYPES)) check(I.fallbackQuestions(t).length, 5);
check(I.fallbackQuestions("nope"), I.fallbackQuestions("job"));
const bank = I.fallbackQuestions("college"); bank.push("x");
check(I.fallbackQuestions("college").length, 5);

for (const n of [3, 5]) {
  const m = I.buildQuestionsPrompt("job", "cashier at a grocery store", n);
  check(m.map((x) => x.role), ["system", "user"]);
  check([m[0].content.includes(`Q${n}: question`), m[0].content.includes(`Q${n + 1}:`), m[0].content.includes("Never invent"),
    m[1].content.includes("cashier at a grocery store"), m[1].content.includes(`${n} interview questions`)], [true, false, true, true, true]);
}
check(I.buildQuestionsPrompt("college", "", 3)[1].content, "Write 3 interview questions for a college admission interview.");

const f = I.buildFeedbackPrompt("scholarship", "", "Why you?", "Because I study hard.");
check([f[0].content.includes("SCORE:"), f[0].content.includes("GOOD:"), f[0].content.includes("IMPROVE:"), f[0].content.includes("BETTER START:"),
  f[0].content.includes("Never invent"), f[1].content.includes("Why you?"), f[1].content.endsWith("Because I study hard.")], [true, true, true, true, true, true, true]);

// Questions: the asked format, markdown, numbered lists, duplicates and extra lines.
check(I.parseQuestions("Q1: Tell me about yourself.\nQ2: Why do you want this job?\nQ3: Tell me about a time you helped a customer.", 3),
  ["Tell me about yourself.", "Why do you want this job?", "Tell me about a time you helped a customer."]);
check(I.parseQuestions("Here you go!\n\n**Q1:** \"Why this school?\"\n2. What do you do for fun?\nQuestion 3 - How do you handle stress?\n**Q4:** Extra one here?", 3),
  ["Why this school?", "What do you do for fun?", "How do you handle stress?"]);
check(I.parseQuestions("Q1: Why this job?\nQ2: why this job?\n- What are your strengths?", 5), ["Why this job?", "What are your strengths?"]);
check(I.parseQuestions("I can't do that.", 3), []);
const filled = I.fillQuestions(I.parseQuestions("Q1: Why do you want to join our robotics team?", 3), "club", 3);
check(filled, ["Why do you want to join our robotics team?", "Why do you want to join this club or team?", "What skills or strengths would you bring?"]);
check(I.fillQuestions([], "internship", 5), I.fallbackQuestions("internship"));
check(I.fillQuestions(["Tell me a little about yourself."], "job", 3), ["Tell me a little about yourself.", "Why do you want to work here?", "Tell me about a time you helped someone who was upset or confused."]);

// Behavioral questions get the STAR tip.
check(I.tipFor("Tell me about a time you failed."), I.STAR_TIP);
check(I.tipFor("Describe a time you showed leadership."), I.STAR_TIP);
check(I.tipFor("Why do you want to work here?"), I.GENERAL_TIP);

// Feedback: plain, markdown with "4/5", missing lines, out-of-range scores.
check(I.parseFeedback("SCORE: 4\nGOOD: You named a real example.\nIMPROVE: Say what you learned.\nBETTER START: I like helping people, like when I tutored my brother."),
  { score: 4, good: "You named a real example.", improve: "Say what you learned.", betterStart: "I like helping people, like when I tutored my brother." });
check(I.parseFeedback("Great job!\n\n**Score:** 3/5\n**Good:** Clear and polite.\n- **Improve:** Add one example\nfrom school.\n**Better start:** \"I am a reliable person.\""),
  { score: 3, good: "Clear and polite.", improve: "Add one example from school.", betterStart: "I am a reliable person." });
check(I.parseFeedback("Score: 4 out of 5\nIMPROVE: Be specific."), { score: 4, good: "", improve: "Be specific.", betterStart: "" });
check(I.parseFeedback("SCORE: 9").score, 5);
check(I.parseFeedback("SCORE: 0").score, 1);
check(I.parseFeedback("SCORE: 3.6").score, 4);
check(I.parsedOk(I.parseFeedback("Nice answer, keep going.")), false);
check(I.parsedOk(I.parseFeedback("GOOD: ok")), true);

// Averages and the summary.
const items = [
  { question: "A?", answer: "one", feedback: { score: 4, good: "g1", improve: "i1", betterStart: "b1" } },
  { question: "B?", answer: "two", feedback: { score: 2, good: "", improve: "Use the STAR method.", betterStart: "" } },
  { question: "C?", answer: "", feedback: null },
];
check(I.averageScore(items), 3);
check(I.averageScore([{ feedback: { score: 4 } }, { feedback: { score: 5 } }, { feedback: { score: 5 } }]), 4.7);
check(I.averageScore([]), null);
check(I.averageScore([{ feedback: { score: null } }]), null);
check(I.fallbackFocus(items), "Use the STAR method.");
check(I.fallbackFocus([{ feedback: { score: null, improve: "x" } }]), "x");
check(I.fallbackFocus([]), "");
check(I.buildFocusPrompt(items)[1].content, "IMPROVEMENT NOTES:\n- i1\n- Use the STAR method.");
check(I.cleanFocus("\n**Focus:** \"Practice giving one clear example.\"\nMore text"), "Practice giving one clear example.");

check(I.asText({ type: "job", role: "cashier", items, focus: "Use the STAR method." }),
  "Interview practice: Part-time job (cashier)\nAverage score: 3 / 5\n\nQ1: A?\nMy answer: one\nScore: 4 / 5\nGood: g1\nImprove: i1\nBetter start: b1\n\n"
  + "Q2: B?\nMy answer: two\nScore: 2 / 5\nImprove: Use the STAR method.\n\nQ3: C?\nMy answer: (no answer)\n\nMost useful thing to practice: Use the STAR method.");
const empty = I.asText({ type: "weird", items: [] });
check(empty, "Interview practice: Part-time job");
check(/null|undefined|NaN/.test(I.asText({})), false);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
