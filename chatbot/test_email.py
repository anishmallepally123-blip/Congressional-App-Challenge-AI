"""Checks "✉️ Write an email": it's on the page and its prompt, parsing, checklist and link helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class EmailTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="email.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("email.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertIn('"local-ai-email"', js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const E = require(%s);\n" % json.dumps(os.path.join(STATIC, "email.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(E.countWords("  Dear Ms.\n\nLopez,  hi "), 4);
check(E.countWords(null), 0);

// The prompt asks for the strict format and carries the student's details.
for (const tone of ["polite", "formal", "friendly", "weird"]) {
  const m = E.buildPrompt("Ms. Lopez, my chemistry teacher", "I missed the quiz.", tone, "Jordan");
  check(m.map((x) => x.role), ["system", "user"]);
  check([m[0].content.includes("SUBJECT:"), m[0].content.includes("BODY:"), m[0].content.includes(E.TONES[tone] || E.TONES.polite)], [true, true, true]);
  check([m[1].content.includes("Ms. Lopez, my chemistry teacher"), m[1].content.includes("I missed the quiz."), m[1].content.includes("Jordan")], [true, true, true]);
}
check(E.buildPrompt("", "x", "polite", "  ")[1].content.includes("[Your name]"), true);
check(E.buildPrompt("Coach", "y".repeat(5000), "polite", "A")[1].content.length < 2200, true);
const rev = E.buildRevisePrompt({ subject: "Quiz", body: "Dear Coach,\nHi.\nThanks,\nA" }, "shorter", "polite", "A");
check([rev[1].content.includes("Subject: Quiz"), rev[1].content.includes("shorter"), rev[0].content.includes("SUBJECT:")], [true, true, true]);
check(E.buildRevisePrompt({ subject: "", body: "x" }, "formal", "friendly", "A")[0].content.includes(E.TONES.formal), true);

// Parsing: the plain format.
const plain = "SUBJECT: Making up Monday's quiz\nBODY:\nDear Ms. Lopez,\n\nI was sick on Monday and missed the quiz. Could I make it up this week?\n\nThank you,\nJordan";
check(E.parseEmail(plain), { subject: "Making up Monday's quiz", body: "Dear Ms. Lopez,\n\nI was sick on Monday and missed the quiz. Could I make it up this week?\n\nThank you,\nJordan" });
// Markdown bold, a chatty intro, "Subject -", a code fence and the body on the BODY line.
const messy = "Sure! Here's your email:\n\n```\n**Subject -** \"Extension request\"\n**Body:** Dear Coach Kim,\nCan I miss Tuesday's practice?\nBest,\nSam\n```\n";
check(E.parseEmail(messy), { subject: "Extension request", body: "Dear Coach Kim,\nCan I miss Tuesday's practice?\nBest,\nSam" });
// No BODY marker: everything after the subject is the body.
check(E.parseEmail("Subject: Thanks!\n\nHi Mr. Diaz,\nThank you.\nSam"), { subject: "Thanks!", body: "Hi Mr. Diaz,\nThank you.\nSam" });
// No SUBJECT at all: the whole text is the body.
check(E.parseEmail("  Dear Ms. Lopez,\nThank you!\nSam  \n"), { subject: "", body: "Dear Ms. Lopez,\nThank you!\nSam" });
check(E.parseEmail(""), { subject: "", body: "" });
// A body line that starts with "Email" isn't taken for the BODY marker.
check(E.parseEmail("SUBJECT: Hi\nEmail me back when you can.\nSam").body, "Email me back when you can.\nSam");

// Checklist.
const keys = (cs) => Object.fromEntries(cs.map((c) => [c.key, c.ok]));
check(keys(E.emailChecks(E.parseEmail(plain), "Ms. Lopez")), { greeting: true, signoff: true, length: true, subject: true, caps: true });
check(keys(E.emailChecks({ subject: "", body: "I NEED this grade changed RIGHT NOW." }, "")), { greeting: false, signoff: false, length: true, subject: false, caps: false });
check(E.emailChecks({ subject: "", body: "I NEED this NOW" }, "").find((c) => c.key === "caps").text.includes("NEED"), true);
check(keys(E.emailChecks({ subject: "AP and SAT", body: "Hello,\nMy PSAT score for the NASA program.\nRegards,\nA" }, "")).caps, true);
check(keys(E.emailChecks({ subject: "x", body: "Hello,\nThe MESA club.\nThanks,\nA" }, "Mr. Ruiz, MESA advisor")).caps, true);
check(keys(E.emailChecks({ subject: "x", body: "Hi,\n" + "word ".repeat(210) + "\nThanks,\nA" }, "")).length, false);
check(E.emailChecks({ subject: "x", body: "" }, "").length, 5);

// Copy text and the mailto link.
check(E.asText({ subject: "Quiz", body: "Dear Ms. Lopez,\nHi" }), "Subject: Quiz\n\nDear Ms. Lopez,\nHi");
check(E.asText({ subject: " ", body: "Hi\n" }), "Hi");
check(E.mailtoLink({ subject: "Quiz & test?", body: "Dear Ms. Lopez,\nThanks" }), "mailto:?subject=Quiz%20%26%20test%3F&body=Dear%20Ms.%20Lopez%2C%0D%0AThanks");
check(E.mailtoLink({ subject: "Long", body: "word ".repeat(500) }), "");
check(E.mailtoLink({ subject: "Long", body: "word ".repeat(200) }).length <= E.MAILTO_MAX, true);
check(E.EXAMPLES.length >= 4, true);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
