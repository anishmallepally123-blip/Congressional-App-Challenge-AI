"""Checks "📄 Resume builder": it's on the page and its prompt, parsing, text and HTML helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class ResumeTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="resume.js" defer></script>', read("index.html"))

    def test_no_null_text(self):
        js = read("resume.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertIn("local-ai-resume", js)
        self.assertIn("Stays on this computer", js)

    def run_node(self, body):
        script = "const R = require(%s);\n" % json.dumps(os.path.join(STATIC, "resume.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
""" + body
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_prompt(self):
        self.run_node(r"""
const m = R.buildPrompt(R.EXAMPLE);
check(m.map((x) => x.role), ["system", "user"]);
const sys = m[0].content;
check(["OBJECTIVE:", "JOB 1:", "JOB 2:", "ONLY the facts", "action verb", "under 20 words", "2 experiences"].map((s) => sys.includes(s)), [true, true, true, true, true, true, true]);
const user = m[1].content;
check(user.includes("JOB 1: Cashier at Fresh Market Grocery (Jun 2025 – Present)"), true);
check(user.includes("What I did: I helped middle school kids"), true);
check(user.includes("Skills: Customer service, Spanish (fluent)"), true);
check(user.includes("School: Lincoln High School, class of 2027"), true);
// Contact details are not needed for bullets, so they are not sent.
check([user.includes("example.com"), user.includes("555")], [false, false]);
// Empty rows are left out; one job means no JOB 2 in the format.
const one = R.buildPrompt({ ...R.blankData(), jobs: [{ title: "", place: "", dates: "", did: "" }, { title: "Lifeguard", place: "", dates: "", did: "Watched swimmers." }] });
check([one[0].content.includes("JOB 2:"), one[0].content.includes("1 experience,"), one[1].content.includes("JOB 1: Lifeguard\nWhat I did: Watched swimmers.")], [false, true, true]);
check(R.usedJobs(null), []);
""")

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_parse(self):
        self.run_node(r"""
const plain = "OBJECTIVE: Hard-working student seeking a part-time retail job.\nJOB 1:\n- Served customers at the register.\n- Restocked shelves.\nJOB 2:\n- Tutored middle school students in math.\n- Created fraction worksheets.";
check(R.parseResume(plain, 2), { objective: "Hard-working student seeking a part-time retail job.",
  bullets: [["Served customers at the register.", "Restocked shelves."], ["Tutored middle school students in math.", "Created fraction worksheets."]] });

// Markdown, numbering, "Experience 1" with a title after it, objective on the next line, chatty intro.
const messy = "Sure! Here is your resume.\n\n**Objective:**\n\"Friendly student eager to help.\"\n\n### Experience 1: Cashier at Fresh Market\n1. **Served** customers\n2) Trained new cashiers\n\n**Job #2 -**\n* Helped kids with math\n";
check(R.parseResume(messy, 2), { objective: "Friendly student eager to help.", bullets: [["Served customers", "Trained new cashiers"], ["Helped kids with math"]] });

// A missing job falls back to the student's own words, split into sentences.
const jobs = [{ did: "x" }, { did: "i walked dogs for neighbors. Fed cats too!  \nCleaned up after them" }];
check(R.parseResume("OBJECTIVE: Hi.\nJOB 1:\n- Did a thing", 2, jobs).bullets,
  [["Did a thing"], ["I walked dogs for neighbors.", "Fed cats too!", "Cleaned up after them"]]);
// Bullets with no JOB heading go to job 1; extra jobs and too many bullets are dropped.
check(R.parseResume("- A\n- B\nJOB 3:\n- C", 1).bullets, [["A", "B"]]);
check(R.parseResume("JOB 1:\n- 1\n- 2\n- 3\n- 4\n- 5", 1).bullets[0].length, 4);
check(R.parseResume("", 1, []), { objective: "", bullets: [[]] });
check(R.parseResume(null, 0), { objective: "", bullets: [] });
check(R.sentences(""), []);
""")

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_as_text(self):
        self.run_node(r"""
const result = { objective: "Reliable student.", bullets: [["Served customers.", "Restocked shelves."], ["Tutored math."]] };
check(R.asText(R.EXAMPLE, result), [
  "Maya Rodriguez", "maya.rodriguez@example.com · (555) 214-7788 · Springfield, IL", "",
  "OBJECTIVE", "Reliable student.", "",
  "EDUCATION", "Lincoln High School · Class of 2027 · GPA 3.7", "",
  "EXPERIENCE", "Cashier — Fresh Market Grocery · Jun 2025 – Present", "- Served customers.", "- Restocked shelves.", "",
  "Volunteer Tutor — Springfield Public Library · Sep 2024 – May 2025", "- Tutored math.", "",
  "SKILLS", "Customer service, Spanish (fluent), Google Docs and Sheets, Teamwork", "",
  "AWARDS & ACTIVITIES", "- Honor Roll (2023–2025)", "- Varsity Cross Country, team captain", "- Math Club member"].join("\n"));
// Optional parts left out leave no gaps or "undefined".
const small = R.asText({ name: "Sam", email: "s@x.org", jobs: [{ title: "Babysitter", did: "x" }] }, { objective: "", bullets: [["Watched kids."]] });
check(small, "Sam\ns@x.org\n\nEXPERIENCE\nBabysitter\n- Watched kids.");
check(/undefined|null|NaN/.test(small + R.asText({}, null)), false);
""")

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_html_escaping(self):
        self.run_node(r"""
const bad = "<img src=x onerror=alert(1)>";
const data = { name: bad, email: "a&b@x.org", phone: '"quoted"', city: "O'Fallon", school: "<b>School</b>", gradYear: "2027", gpa: "",
  jobs: [{ title: "<script>alert(1)</script>", place: "Joe's & Co", dates: "<i>now</i>", did: "x" }], skills: "<u>HTML</u>, CSS", awards: "<marquee>Win</marquee>" };
const html = R.resumeHtml(data, { objective: bad, bullets: [["Built <a href=x>things</a> & more"]] });
check(["<img", "<script", "<b>School", "<i>now", "<u>", "<marquee", "<a "].some((t) => html.includes(t)), false);
check(html.includes("&lt;img src=x onerror=alert(1)&gt;"), true);
check(html.includes("Joe&#39;s &amp; Co"), true);
check(html.includes("&quot;quoted&quot;"), true);
check(html.includes("Built &lt;a href=x&gt;things&lt;/a&gt; &amp; more"), true);
const page = R.printPage(data, { objective: "", bullets: [[]] });
check(page.includes("<title>&lt;img"), true);
check(page.includes("@page"), true);
// Empty data still makes a sheet without "undefined".
check(/undefined|null|NaN/.test(R.resumeHtml({}, null)), false);
check(R.resumeHtml({}, null).includes("Your Name"), true);
""")


if __name__ == "__main__":
    unittest.main()
