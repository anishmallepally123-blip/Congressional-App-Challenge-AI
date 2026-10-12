"""Tests for the page's Markdown renderer (static/markdown.js), run with Node if it's installed."""

import json
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "static", "markdown.js")


def render(*texts):
    """Run renderMarkdown on each text in Node and return the HTML."""
    code = (f"const fs = require('fs'); eval(fs.readFileSync({json.dumps(SCRIPT)}, 'utf8') + "
            "'\\n;globalThis.renderMarkdown = renderMarkdown;');"
            f"process.stdout.write(JSON.stringify({json.dumps(list(texts))}.map(t => renderMarkdown(t))));")
    out = subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


@unittest.skipUnless(shutil.which("node"), "Node.js isn't installed")
class MathTests(unittest.TestCase):
    def test_quadratic_formula_becomes_a_real_fraction_with_a_root(self):
        [html] = render(r"The answer is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.")
        self.assertIn('<span class="math">', html)
        self.assertIn('<span class="frac">', html)
        self.assertIn("±", html)
        self.assertIn('√<span class="sqrt">', html)
        self.assertIn("<sup>2</sup>", html)
        self.assertNotIn("\\frac", html)

    def test_display_math_on_its_own_lines(self):
        html, one_line = render("Use this:\n\n$$\nE = mc^2\n$$\n\nThat's it.", "\\[ a^2 + b^2 = c^2 \\]")
        self.assertIn('<div class="math-block"><span class="math display">', html)
        self.assertIn("<i>E</i> = <i>m</i><i>c</i><sup>2</sup>", html)
        self.assertIn("<p>That's it.</p>", html)
        self.assertIn('<div class="math-block">', one_line)
        self.assertIn("<i>c</i><sup>2</sup>", one_line)

    def test_inline_parentheses_style_and_symbols(self):
        [html] = render(r"Since \(\theta \le 90^\circ\) and \(x \neq 0\), \(\alpha \to \infty\).")
        for symbol in ("θ", "≤", "<sup>°</sup>", "≠", "α", "→", "∞"):
            self.assertIn(symbol, html)

    def test_prices_are_not_math(self):
        [html] = render("It costs $5 and the deluxe one is $10.")
        self.assertNotIn("math", html)
        self.assertIn("$5 and the deluxe one is $10", html)

    def test_math_inside_code_is_left_alone(self):
        [html] = render("In bash, `echo $HOME$PATH` prints both.")
        self.assertNotIn("math", html)

    def test_math_cannot_inject_html(self):
        [a, b] = render(r"$\text{<img src=x onerror=alert(1)>}$", r"$<script>$")
        for html in (a, b):
            self.assertNotIn("<img", html)
            self.assertNotIn("<script", html)

    def test_unfinished_math_while_streaming_does_not_break(self):
        html = render("$$\n\\frac{1}{", "$x^", "\\sqrt[3", "$x^$")
        self.assertEqual(len(html), 4)
        self.assertNotIn("undefined", "".join(html))

    def test_underscores_in_math_are_not_italics(self):
        [html] = render("$a_1 + a_2$ and $b_n$")
        self.assertIn("<sub>1</sub>", html)
        self.assertNotIn("<em>", html)


if __name__ == "__main__":
    unittest.main()
