"""Checks "🐞 Explain an error": it's on the page and its language guess, error-location, prompt and parsing helpers work."""
import json
import os
import shutil
import subprocess
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class ErrorHelpTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="errorhelp.js" defer></script>', read("index.html"))

    def test_no_null_text_or_html(self):
        js = read("errorhelp.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertNotIn("dialog.replaceChildren(head", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('"local-ai-error-explain"', js)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_pure_helpers(self):
        script = "const E = require(%s);\n" % json.dumps(os.path.join(STATIC, "errorhelp.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
check([E.MAX_ERROR, E.MAX_CODE], [4000, 8000]);

const py = E.EXAMPLE.error;
const js = "Uncaught TypeError: Cannot read properties of undefined (reading 'length')\n    at countWords (app.js:12:5)\n    at HTMLButtonElement.<anonymous> (http://localhost:5500/js/main.js:30:3)";
const node = "/home/me/app.js:3\nconsole.log(nme);\n            ^\n\nReferenceError: nme is not defined\n    at Object.<anonymous> (/home/me/app.js:3:13)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)";
const java = 'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3\n\tat Main.main(Main.java:5)';
const javac = "Main.java:7: error: cannot find symbol\n        System.out.println(totl);\n                           ^";
const cpp = "main.cpp:12:5: error: 'cout' was not declared in this scope\n   12 |     cout << x;\n      |     ^~~~";
const msvc = "C:\\proj\\main.cpp(9): error C2065: 'y': undeclared identifier";

// Language from the error's shape, then from the code.
check([py, js, node, java, javac, cpp, msvc].map((e) => E.detectLanguage(e, "")), ["python", "javascript", "javascript", "java", "java", "cpp", "cpp"]);
check(E.detectLanguage("", "#include <iostream>\nint main() {}"), "cpp");
check(E.detectLanguage("", "public class Main {}"), "java");
check(E.detectLanguage("", "const x = 1;"), "javascript");
check(E.detectLanguage("", "def f():\n    pass"), "python");
check(E.detectLanguage("NameError: name 'x' is not defined", ""), "python");
check(E.detectLanguage("hmm", ""), "unknown");
check(E.detectLanguage(null, undefined), "unknown");

// Where it happened, for all four languages.
check(E.extractLocation(py, "python"), { line: 4, file: "grades.py", type: "IndexError", message: "list index out of range" });
const nested = 'Traceback (most recent call last):\n  File "main.py", line 10, in <module>\n    go()\n  File "/home/me/helpers.py", line 7, in go\n    return 1 / 0\nZeroDivisionError: division by zero';
check(E.extractLocation(nested, "python"), { line: 7, file: "helpers.py", type: "ZeroDivisionError", message: "division by zero" });
check(E.extractLocation('  File "x.py", line 2\n    if x = 3:\n         ^\nSyntaxError: invalid syntax', "python"), { line: 2, file: "x.py", type: "SyntaxError", message: "invalid syntax" });
check(E.extractLocation(js, "javascript"), { line: 12, file: "app.js", type: "TypeError", message: "Cannot read properties of undefined (reading 'length')" });
check(E.extractLocation(node, "javascript"), { line: 3, file: "app.js", type: "ReferenceError", message: "nme is not defined" });
check(E.extractLocation(java, "java"), { line: 5, file: "Main.java", type: "ArrayIndexOutOfBoundsException", message: "Index 3 out of bounds for length 3" });
check(E.extractLocation(javac, "java"), { line: 7, file: "Main.java", type: "Compile error", message: "cannot find symbol" });
check(E.extractLocation(cpp, "cpp"), { line: 12, file: "main.cpp", type: "Compiler error", message: "'cout' was not declared in this scope" });
check(E.extractLocation(msvc, "cpp"), { line: 9, file: "main.cpp", type: "Compiler error", message: "'y': undeclared identifier" });
check(E.extractLocation("main.cpp:(.text+0x5): undefined reference to `foo()'", "cpp").type, "Linker error");
// Unknown language tries them all; nothing found is empty, never "undefined".
check(E.extractLocation(java, "unknown").line, 5);
check(E.extractLocation("TypeError: x is not iterable", "unknown"), { line: null, file: "", type: "TypeError", message: "x is not iterable" });
check(E.extractLocation("it broke", "python"), { line: null, file: "", type: "", message: "" });
check(E.extractLocation(null, "javascript"), { line: null, file: "", type: "", message: "" });

check(E.locationLabel(E.extractLocation(py, "python")), "IndexError on line 4");
check(E.locationLabel(E.extractLocation(py, "python"), " · "), "IndexError · line 4");
check(E.locationLabel({ line: 3, type: "" }), "Error on line 3");
check(E.locationLabel({ line: null, type: "" }), "");

// The code around the error line.
check(E.codeContext(E.EXAMPLE.code, 4, 2).map((r) => [r.n, r.hit]), [[2, false], [3, false], [4, true], [5, false]]);
check(E.codeContext(E.EXAMPLE.code, 4, 2)[2].text, "    total += scores[i]");
check(E.codeContext("a\nb\nc", 1, 2).map((r) => r.n), [1, 2, 3]);
check(E.codeContext("a\nb", 9, 2), []);
check(E.codeContext("", 1, 2), []);
check(E.codeContext("a", null, 2), []);

// Prompt.
const loc = E.extractLocation(py, "python");
const m = E.buildPrompt(py, E.EXAMPLE.code, "python", loc);
check(m.map((x) => x.role), ["system", "user"]);
check(["WHAT IT MEANS:", "WHY IT HAPPENED:", "HOW TO FIX:", "TIP:", "```"].map((h) => m[0].content.includes(h)), [true, true, true, true, true]);
check([m[1].content.includes("Language: Python"), m[1].content.includes("IndexError on line 4 in grades.py"), m[1].content.includes("4:     total += scores[i]")], [true, true, true]);
const bare = E.buildPrompt("oops", "", "unknown", E.extractLocation("oops", "unknown"))[1].content;
check([bare.includes("Language"), bare.includes("only the error"), /undefined|null|NaN/.test(bare)], [false, true, false]);
check(E.buildPrompt("x".repeat(9000), "y".repeat(20000), "python", loc)[1].content.length < 4000 + 8000 * 2, true);

// Parsing the answer.
const plain = "WHAT IT MEANS: You asked for a spot past the end of the list.\nWHY IT HAPPENED: On line 4, i reaches 3 but the last spot is 2.\nHOW TO FIX: Loop over exactly the list's length.\n```\nfor i in range(len(scores)):\n```\nTIP: Lists start counting at 0.";
const r = E.parseExplain(plain);
check(r, { meaning: "You asked for a spot past the end of the list.", why: "On line 4, i reaches 3 but the last spot is 2.",
  fix: "Loop over exactly the list's length.", fixCode: "for i in range(len(scores)):", tip: "Lists start counting at 0." });
check(E.parsedOk(r), true);
check(E.asText(r, loc), "IndexError on line 4: list index out of range\n\nWhat it means: You asked for a spot past the end of the list.\n\nWhy it happened: On line 4, i reaches 3 but the last spot is 2.\n\nHow to fix: Loop over exactly the list's length.\n```\nfor i in range(len(scores)):\n```\n\nTip: Lists start counting at 0.");

// Markdown, headings on their own line, a language tag on the fence, code in another section.
const messy = "Sure!\n\n**What it means:**\nThe list ran out.\n\n## Why it happened\nThe loop goes one too far:\n```python\nfor i in range(len(scores) + 1):\n```\n\n### **How to fix:**\n\n```python\n    for i in range(len(scores)):\n```\n**Tip:** *Print len() when unsure.*";
check(E.parseExplain(messy), { meaning: "The list ran out.", why: "The loop goes one too far:", fix: "", fixCode: "    for i in range(len(scores)):", tip: "Print len() when unsure." });
// Missing sections and a reply cut off inside the code block.
const cut = E.parseExplain("WHAT IT MEANS: Bad index.\nHOW TO FIX:\n```\nx = a[0]");
check(cut, { meaning: "Bad index.", why: "", fix: "", fixCode: "x = a[0]", tip: "" });
check(E.asText(cut, { line: null, type: "", message: "" }), "What it means: Bad index.\n\nHow to fix:\n```\nx = a[0]\n```");
// Nothing in the format: raw fallback.
check(E.parsedOk(E.parseExplain("Your list is too short.\n```\nprint(1)\n```")), false);
check(E.parsedOk(E.parseExplain("")), false);
"""
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
