"""Checks "🎯 Rubric check": it's on the page and its prompt, parsing, quote-check and score helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class RubricTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="rubric.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("rubric.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertIn('"local-ai-rubric"', js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const R = require(%s);\n" % json.dumps(os.path.join(STATIC, "rubric.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check([R.MAX_CHARS, R.MAX_CRITERIA], [6000, 12]);

// One criterion per line; bullets, numbers and blank lines are dropped.
check(R.splitCriteria("1. Clear thesis\n\n- Three   sources\n* Counterargument\n  2) Conclusion  \n"), ["Clear thesis", "Three sources", "Counterargument", "Conclusion"]);
check(R.splitCriteria(""), []);
check(R.splitCriteria(null), []);

const crit = ["Clear thesis", "3 pieces of evidence", "Counterargument", "Conclusion restates thesis"];
const m = R.buildPrompt("My essay.", crit);
check(m.map((x) => x.role), ["system", "user"]);
check([m[0].content.includes("CRITERION 1: MET | PARTLY | NOT YET"), m[0].content.includes("EVIDENCE:"), m[0].content.includes("FIX:"),
  m[0].content.includes("NONE"), /never rewrite/i.test(m[0].content)], [true, true, true, true, true]);
check([m[1].content.includes("1. Clear thesis\n2. 3 pieces of evidence"), m[1].content.endsWith("My essay.")], [true, true]);
check(R.buildPrompt("x".repeat(9000), crit)[1].content.length < 6300, true);

const work = "School uniforms should not be required.  They limit “self-expression” and cost families money.\nSome people say uniforms stop bullying.";
const plain = 'CRITERION 1: MET\nEVIDENCE: "School uniforms should not be required"\nFIX: Name your two reasons in the thesis.\n'
  + 'CRITERION 2: PARTLY\nEVIDENCE: "cost families money"\nFIX: Add a source for the cost.\n'
  + 'CRITERION 3: NOT YET\nEVIDENCE: NONE\nFIX: Answer the bullying argument.\n'
  + 'CRITERION 4: MET\nEVIDENCE: "In conclusion, uniforms are bad"\nFIX: None';
const r = R.parseRubric(plain, crit);
check(r, [
  { criterion: "Clear thesis", status: "met", evidence: "School uniforms should not be required", fix: "Name your two reasons in the thesis." },
  { criterion: "3 pieces of evidence", status: "partly", evidence: "cost families money", fix: "Add a source for the cost." },
  { criterion: "Counterargument", status: "notyet", evidence: "", fix: "Answer the bullying argument." },
  { criterion: "Conclusion restates thesis", status: "met", evidence: "In conclusion, uniforms are bad", fix: "" }]);
check(R.summarize(r), "2 of 4 met · 1 partly · 1 not yet");
check(R.asText(r).split("\n").slice(0, 5), ["Rubric check: 2 of 4 met · 1 partly · 1 not yet", "", "1. Clear thesis — Met",
  '   Evidence: "School uniforms should not be required"', "   Fix: Name your two reasons in the thesis."]);
check(R.asText(r).includes("3. Counterargument — Not yet\n   Evidence: none\n   Fix: Answer the bullying argument."), true);
check(/null|undefined|NaN/.test(R.asText(r)), false);

// Markdown bold, lower case, "Partially", "Not met", out-of-order blocks, a missing block, wrapped fix.
const messy = "Here is my check:\n\n**Criterion 2:** Partially met\n**Evidence:** “cost families money”\n**Fix:** add a citation\nfor the price.\n\n"
  + "### criterion 1 - **Met**\n- evidence: 'school uniforms should not be required.'\n- fix: none needed\n\n"
  + "CRITERION 4: Not met\nEVIDENCE: none\nFIX: Restate the thesis at the end.";
check(R.parseRubric(messy, crit), [
  { criterion: "Clear thesis", status: "met", evidence: "school uniforms should not be required.", fix: "" },
  { criterion: "3 pieces of evidence", status: "partly", evidence: "cost families money", fix: "add a citation for the price." },
  { criterion: "Counterargument", status: "unknown", evidence: "", fix: "" },
  { criterion: "Conclusion restates thesis", status: "notyet", evidence: "", fix: "Restate the thesis at the end." }]);
check(R.summarize(R.parseRubric(messy, crit)), "1 of 4 met · 1 partly · 1 not yet · 1 unclear");
check(R.parseRubric("CRITERION 1:\nSTATUS: not yet\nEVIDENCE: NONE\nFIX: x", ["a"])[0].status, "notyet");
check(R.parseRubric("I can't do that.", ["a", "b"]).map((x) => x.status), ["unknown", "unknown"]);
check(R.summarize([]), "0 of 0 met");

// Quotes must really be in the work (case, spaces, curly quotes and end punctuation don't matter).
check(R.checkQuote("School uniforms should not be required", work), true);
check(R.checkQuote("school   UNIFORMS should not be required.", work), true);
check(R.checkQuote('"limit "self-expression" and cost"', work), true);
check(R.checkQuote("required. They limit", work), true);
check(R.checkQuote("money. Some people", work), true);
check(R.checkQuote("School uniforms ... stop bullying", work), true);
check(R.checkQuote("stop bullying ... School uniforms", work), false);
check(R.checkQuote("In conclusion, uniforms are bad", work), false);
check(R.checkQuote("NONE", work), false);
check(R.checkQuote("", work), false);
check(R.checkQuote(null, work), false);
const at = R.findQuote("cost families money", work);
check(work.slice(at[0], at[1]), "cost families money");
const at2 = R.findQuote("required. They limit", work);
check(work.slice(at2[0], at2[1]), "required.  They limit");
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
