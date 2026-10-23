"""Checks "🏛️ Explain a bill": it's on the page and its prompt, parsing and balance helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class BillTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="bill.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("bill.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertIn('"local-ai-bill"', js)
        self.assertIn("This explains the text you pasted. It isn't legal advice, and it doesn't tell you what to think.", js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const B = require(%s);\n" % json.dumps(os.path.join(STATIC, "bill.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check(B.MAX_CHARS, 8000);
check(B.EXAMPLE.length < B.MAX_CHARS && B.EXAMPLE.includes("Section 1"), true);

for (const level of ["middle", "high", "weird", undefined]) {
  const m = B.buildPrompt("Section 1. Bikes.", level, false);
  check(m.map((x) => x.role), ["system", "user"]);
  const sys = m[0].content;
  check(["IN ONE SENTENCE:", "WHAT IT DOES:", "WHO IT AFFECTS:", "SUPPORTERS MIGHT SAY:", "CRITICS MIGHT SAY:", "WORDS TO KNOW:", "QUESTIONS TO ASK:",
    "The text doesn't say", "never tell the student how to vote", "Use only the text"].map((w) => sys.includes(w)), Array(10).fill(true));
  check(sys.includes(level === "middle" ? "middle school" : "high school"), true);
  check(m[1].content.endsWith("Section 1. Bikes."), true);
  check(m[1].content.includes("exactly 3 for critics"), false);
}
check(B.buildPrompt("x", "high", true)[1].content.includes("exactly 3 for critics"), true);
check(B.buildPrompt("x".repeat(9000), "high")[1].content.length < 8300, true);
check(B.buildPrompt(null, "high")[1].content.includes("null"), false);

const plain = "IN ONE SENTENCE: Schools must keep phones put away in class.\nWHAT IT DOES:\n- Phones off in class.\n- Filters school Wi-Fi.\nWHO IT AFFECTS:\n- Students\n- Teachers\nSUPPORTERS MIGHT SAY:\n- Fewer distractions.\n- Safer internet.\nCRITICS MIGHT SAY:\n- Hard to reach family.\n- Filters can block useful sites.\nWORDS TO KNOW:\n- IEP: a plan for a student with a disability\nQUESTIONS TO ASK:\n- Who checks the filters?";
const r = B.parseBill(plain);
check(r, { oneSentence: "Schools must keep phones put away in class.", does: ["Phones off in class.", "Filters school Wi-Fi."], affects: ["Students", "Teachers"],
  supporters: ["Fewer distractions.", "Safer internet."], critics: ["Hard to reach family.", "Filters can block useful sites."],
  terms: [{ term: "IEP", definition: "a plan for a student with a disability" }], questions: ["Who checks the filters?"] });
check(B.parsedOk(r), true);
check(B.balanceNote(r), "");
check(B.asText(r), "In one sentence: Schools must keep phones put away in class.\n\nWhat it does:\n- Phones off in class.\n- Filters school Wi-Fi.\n\nWho it affects:\n- Students\n- Teachers\n\nSupporters might say:\n- Fewer distractions.\n- Safer internet.\n\nCritics might say:\n- Hard to reach family.\n- Filters can block useful sites.\n\nWords to know:\n- IEP: a plan for a student with a disability\n\nQuestions to ask:\n- Who checks the filters?");

// Markdown, numbered headings and lists, text on the next line, dash definitions, bullets that start like a heading.
const messy = "Sure! Here's a neutral explanation.\n\n## **In One Sentence:**\nThe town would add bike lanes on Main Street.\n\n**What It Does**\n1. Adds painted bike lanes.\n2) Removes 20 parking spots.\n\n### Who it affects:\n* Cyclists\n\n1. **Supporters might say:**\n- Supporters say it is safer for kids.\n- It encourages exercise.\n- It cuts traffic.\n\n**Critics Might Say:**\n- Shops may lose customers.\n\n**Words to Know:**\n* **ordinance** - a town law\n* **Right-of-way**: the part of the road the public uses\n\n**Questions to ask:** *How much will it cost?*\n";
const m = B.parseBill(messy);
check(m, { oneSentence: "The town would add bike lanes on Main Street.", does: ["Adds painted bike lanes.", "Removes 20 parking spots."], affects: ["Cyclists"],
  supporters: ["Supporters say it is safer for kids.", "It encourages exercise.", "It cuts traffic."], critics: ["Shops may lose customers."],
  terms: [{ term: "ordinance", definition: "a town law" }, { term: "Right-of-way", definition: "the part of the road the public uses" }],
  questions: ["How much will it cost?"] });
check(B.balanceNote(m), B.BALANCE_NOTE);
check(B.balanceNote(m).includes("ask the AI to balance it"), true);

// Missing sections are fine; "none" is skipped.
const part = B.parseBill("IN ONE SENTENCE: Short one.\nWORDS TO KNOW:\n- None\n");
check(part, { oneSentence: "Short one.", does: [], affects: [], supporters: [], critics: [], terms: [], questions: [] });
check(B.asText(part), "In one sentence: Short one.");
check(B.balanceNote(part), "");
check(B.parsedOk(B.parseBill("CRITICS MIGHT SAY:\n- a")), true);
check(B.balanceNote(B.parseBill("CRITICS MIGHT SAY:\n- a\n- b")), B.BALANCE_NOTE);

// Nothing in the format: the app shows the raw reply instead.
check(B.parsedOk(B.parseBill("This bill is about bikes.")), false);
check(B.parsedOk(B.parseBill("")), false);
check(B.parsedOk(B.parseBill(null)), false);
check(B.balanceNote(null), "");
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
