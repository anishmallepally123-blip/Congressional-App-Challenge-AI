"""Checks "🧭 Career explorer": it's on the page and its prompt, parsing and copy-text helpers work."""
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
    script = "const C = require(%s);\n" % json.dumps(os.path.join(STATIC, "career.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const REPLY = "CAREER 1: Bike Mechanic\nWHAT THEY DO: Fix and tune bicycles in a shop.\nWHY IT FITS: You like fixing bikes and building things.\nCLASSES: Physics, Shop, Business\nTRY IT: Fix a flat tire on a friend's bike.\nEDUCATION: Certificate or apprenticeship\n\n"
  + "CAREER 2: Biomedical Engineer\nWHAT THEY DO: Design devices that help patients.\nWHY IT FITS: Mixes science, computers and helping people.\nCLASSES: Biology, Chemistry, Computer Science\nTRY IT: Watch a free video on how prosthetic legs work.\nEDUCATION: 4-year degree\n\n"
  + "CAREER 3: Physical Therapist Assistant\nWHAT THEY DO: Help people move again after injuries.\nWHY IT FITS: You enjoy science and helping people.\nCLASSES: Anatomy, Health, PE\nTRY IT: Learn three stretches and teach them to family.\nEDUCATION: 2-year degree";
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


class CareerTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="career.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("career.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-career"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertIn("Your answers stay on this computer", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("cr-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_prompt(self):
        self.assertNodeOk(r"""
const m = C.buildPrompt(["Science", "Computers", "Helping people", "Nonsense"], "  fixing   bikes ", "10", []);
check(m.map((x) => x.role), ["system", "user"]);
for (const h of ["exactly 3", "CAREER 1:", "WHAT THEY DO:", "WHY IT FITS:", "CLASSES:", "TRY IT:", "EDUCATION:", "do not give salaries"]) check(m[0].content.includes(h), true);
check(m[1].content, "Favorite subjects: Science, Computers, Helping people\nWhat I enjoy: fixing bikes\nGrade: 10th grade");
check(C.buildPrompt([], "", "", [])[1].content, "Favorite subjects: not given\nWhat I enjoy: not given");
check(C.buildPrompt(["Art"], "x".repeat(900), "weird", [])[1].content.length < C.MAX_HOBBIES + 80, true);
check(C.SUBJECTS.length, 12);
check([C.gradeText("1"), C.gradeText("2"), C.gradeText("3"), C.gradeText("12"), C.gradeText("")], ["", "", "", "12th grade", ""]);
""")

    @NEEDS_NODE
    def test_rerun_excludes_previous(self):
        self.assertNodeOk(r"""
const names = C.parseCareers(REPLY).map((c) => c.name);
const m = C.buildPrompt(["Science"], "fixing bikes", "10", [...names, "Bike Mechanic", ""]);
check(m[1].content.split("\n").pop(), "Do not suggest any of these careers (I already saw them): Bike Mechanic, Biomedical Engineer, Physical Therapist Assistant");
check(C.buildPrompt(["Science"], "", "", [])[1].content.includes("Do not suggest"), false);
""")

    @NEEDS_NODE
    def test_parse(self):
        self.assertNodeOk(r"""
const cards = C.parseCareers(REPLY);
check(cards.length, 3);
check(cards[0], { name: "Bike Mechanic", what: "Fix and tune bicycles in a shop.", why: "You like fixing bikes and building things.",
  classes: ["Physics", "Shop", "Business"], tryit: "Fix a flat tire on a friend's bike.", education: "Certificate or apprenticeship" });
check(cards.map((c) => c.education), ["Certificate or apprenticeship", "4-year degree", "2-year degree"]);
check(C.parsedOk(cards), true);
// Only 3 careers even if the AI sends 4; nothing before the first career.
check(C.parseCareers("Sure!\n" + REPLY + "\n\nCAREER 4: Extra\nWHAT THEY DO: x").length, 3);
check([C.parseCareers(""), C.parsedOk([]), C.parsedOk(C.parseCareers("I like turtles."))], [[], false, false]);
""")

    @NEEDS_NODE
    def test_parse_messy(self):
        self.assertNodeOk(r"""
// Markdown headings with the name on the next line, bold labels, bullet classes, more than 3 classes.
const md = "Here are some ideas!\n\n## Career 1\n**Game Developer**\n- **What they do:** Make video games.\n  They write code.\n- **Why it fits you:** You love computers.\n- **Classes to take in high school:**\n  - Computer Science\n  - Math\n  - Art\n  - Physics\n- **Try it now:** Make a tiny game in Scratch.\n- **Education path:** 4-year degree\n\n## Career 2: **Nurse**\nWhat they do: Care for patients.\nClasses: Biology; Chemistry; Health; Psychology";
const a = C.parseCareers(md);
check(a.map((c) => c.name), ["Game Developer", "Nurse"]);
check(a[0].what, "Make video games. They write code.");
check(a[0].classes, ["Computer Science", "Math", "Art"]);
check([a[0].tryit, a[0].education], ["Make a tiny game in Scratch.", "4-year degree"]);
// Missing fields are just empty.
check([a[1].why, a[1].tryit, a[1].education, a[1].classes], ["", "", "", ["Biology", "Chemistry", "Health"]]);
check(C.parsedOk(a), true);
// Numbered "1." headers; classes split by bullets; the "2." inside CLASSES stays a class until 3 are found.
const num = "1. **Electrician**\nWhat they do: Wire buildings.\nClasses: Algebra • Physics • Shop class\n2. Carpenter\nWhat they do: Build things from wood.\nClasses:\n1. Geometry\n2. Woodshop\n3. Drafting\n3. Chef\nWhat they do: Cook food.";
check(C.parseCareers(num).map((c) => [c.name, c.classes]), [["Electrician", ["Algebra", "Physics", "Shop class"]], ["Carpenter", ["Geometry", "Woodshop", "Drafting"]], ["Chef", []]]);
""")

    @NEEDS_NODE
    def test_plain_text(self):
        self.assertNodeOk(r"""
const t = C.toPlainText(C.parseCareers(REPLY));
check(t.startsWith("Career ideas\n\n1. Bike Mechanic\nWhat they do: Fix and tune bicycles in a shop.\nWhy it fits you: You like fixing bikes and building things.\nClasses to take in high school: Physics, Shop, Business\nTry it now: Fix a flat tire on a friend's bike.\nEducation path: Certificate or apprenticeship\n\n2. Biomedical Engineer\n"), true);
check(t.endsWith("\n\n" + C.NOTE), true);
check(C.NOTE.includes("BLS Occupational Outlook Handbook"), true);
check(C.toPlainText(REPLY), t);
check([C.toPlainText(null), C.toPlainText(""), C.toPlainText([])], ["", "", ""]);
check(/null|undefined|NaN/.test(C.toPlainText("CAREER 1: Chef\nWHAT THEY DO: Cook.")), false);
""")


if __name__ == "__main__":
    unittest.main()
