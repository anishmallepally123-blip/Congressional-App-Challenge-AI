"""Checks "📏 Unit converter": it's on the page, and its conversions, rounding, steps and prompt work."""
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
    script = "const U = require(%s);\n" % json.dumps(os.path.join(STATIC, "units.js")) + r"""
const check = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(JSON.stringify(got), "!=", JSON.stringify(want)); process.exit(1); } };
const near = (got, want, tol = 1e-9) => { if (!(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)))) { console.log(got, "is not about", want); process.exit(1); } };
""" + body
    return subprocess.run(["node", "-e", script], capture_output=True, text=True)


class UnitConverterTest(unittest.TestCase):
    def assertNodeOk(self, body):
        result = run_node(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_page_loads_it(self):
        self.assertIn('<script src="units.js" defer></script>', read("index.html"))

    def test_page_code_is_safe(self):
        js = read("units.js")
        self.assertIn("const setDialog = (...nodes) => dialog.replaceChildren(...nodes.filter((n) => n != null));", js)
        self.assertIn('$("personal-link").before(link)', js)
        self.assertIn('class: "sidebar-link plain"', js)
        self.assertIn('"local-ai-units"', js)
        self.assertIn("findModel(currentModel())?.experimental", js)
        self.assertIn("think: false, auto_code: false", js)
        self.assertIn("window.LocalAIUnits = LocalAIUnits", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn('dialog.addEventListener("close", () => { busy?.abort(); });', js)
        # Every class it styles is its own.
        style = js.split("style.textContent = `", 1)[1].split("`;", 1)[0]
        self.assertTrue(all(c.startswith("un-") for c in re.findall(r"\.([a-z][\w-]*)", style)))

    @NEEDS_NODE
    def test_factor_conversions(self):
        self.assertNodeOk(r"""
near(U.convert(1, "mi", "km", "length"), 1.609344);
near(U.convert(1, "mi", "km"), 1.609344);  // the category can be found from the units
near(U.convert(1, "gal", "L", "volume"), 3.785411784);
check(U.formatNumber(U.convert(1, "gal", "L", "volume")), "3.78541");
check(U.formatNumber(U.convert(60, "mph", "km/h", "speed")), "96.5606");
near(U.convert(12, "in", "ft", "length"), 1);
near(U.convert(1, "lb", "oz", "mass"), 16);
near(U.convert(3, "tsp", "tbsp", "volume"), 1);
near(U.convert(2, "h", "min", "time"), 120);
near(U.convert(36, "km/h", "m/s", "speed"), 10);
check([U.convert(NaN, "m", "km"), U.convert(1, "m", "kg"), U.convert(1, "m", "nope", "length"), U.convert("5", "m", "km")].map(Number.isNaN), [true, true, true, true]);
for (const c of U.CATEGORIES) check(U.UNITS[c].pair.every((id) => U.unitOf(c, id)), true);
""")

    @NEEDS_NODE
    def test_temperature(self):
        self.assertNodeOk(r"""
near(U.convert(100, "°C", "°F", "temperature"), 212);
near(U.convert(100, "°C", "K", "temperature"), 373.15);
near(U.convert(212, "°F", "K", "temperature"), 373.15);
check(U.formatNumber(U.convert(-40, "°C", "°F", "temperature")), "-40");
check(U.formatNumber(U.convert(-40, "°F", "°C", "temperature")), "-40");
check(U.formatNumber(U.convert(0, "K", "°F", "temperature")), "-459.67");
check(U.formatNumber(U.convert(32, "°F", "°C", "temperature")), "0");
const s = U.stepsFor(100, "°C", "°F", "temperature");
check([s.kind, s.formula, s.work], ["formula", "°F = °C × 9/5 + 32", "100 × 9/5 + 32 = 212 °F"]);
check(U.stepsFor(373.15, "K", "°C").text, "°C = K − 273.15\n373.15 − 273.15 = 100 °C");
""")

    @NEEDS_NODE
    def test_round_trips(self):
        self.assertNodeOk(r"""
for (const c of U.CATEGORIES) {
  const ids = Object.keys(U.UNITS[c].units);
  for (const a of ids) for (const b of ids) for (const v of [1, 37.5, -12.25, 1234.5]) {
    if (c === "temperature" && v < 0 && a === "K") continue;
    near(U.convert(U.convert(v, a, b, c), b, a, c), v, 1e-9);
  }
}
check(U.convert(7, "cm", "cm", "length"), 7);
""")

    @NEEDS_NODE
    def test_formatting_and_input(self):
        self.assertNodeOk(r"""
check([8.046720000000001, 36.00000000000001, 0.1 + 0.2, 0, -0, 2.5, 0.000001234, -0.00012345678].map((x) => U.formatNumber(x)),
  ["8.04672", "36", "0.3", "0", "0", "2.5", "0.000001234", "-0.000123457"]);
check([1609.344, 86400, 123456789, 1e15, 6.21371192e-7, 1.5e-12].map((x) => U.formatNumber(x)),
  ["1609.34", "86,400", "123,457,000", "1 × 10¹⁵", "6.21371 × 10⁻⁷", "1.5 × 10⁻¹²"]);
check([U.formatNumber(NaN), U.formatNumber(Infinity), U.formatNumber("5"), U.formatNumber(undefined)], ["", "", "", ""]);
check(U.formatNumber(1609.344, 12), "1609.344");
check(U.parseInput(" 2.5 ", "m", "length"), { ok: true, value: 2.5 });
check(U.parseInput("1,000", "m", "length"), { ok: true, value: 1000 });
check([U.parseInput("-40", "°C", "temperature").value, U.parseInput(".5", "m").value, U.parseInput("3e8", "m").value], [-40, 0.5, 3e8]);
check(U.parseInput("", "m", "length").empty, true);
check(U.parseInput("   ", "m", "length").ok, false);
for (const bad of ["abc", "5 miles", "1.2.3", "--4", "Infinity", "1e999"]) check(U.parseInput(bad, "m", "length").ok, false);
check(U.parseInput("-1", "K", "temperature").message.includes("absolute zero"), true);
check(U.parseInput("-300", "°C", "temperature").ok, false);
check(U.parseInput("-460", "°F", "temperature").ok, false);
check(U.parseInput("-273.15", "°C", "temperature").ok, true);
check(U.parseInput("-5", "m", "length").ok, true);
""")

    @NEEDS_NODE
    def test_steps_and_prompt(self):
        self.assertNodeOk(r"""
const s = U.stepsFor(5, "mi", "km", "length");
check(s.text, "5 mi × 1609.344 m/1 mi × 1 km/1000 m = 8.04672 km");
check([s.kind, s.factors.length, s.result], ["chain", 2, { n: "8.04672", unit: "km" }]);
check(U.stepsFor(0.1, "m", "cm").text, "0.1 m × 100 cm/1 m = 10 cm");
check(U.stepsFor(2500, "mm", "m").text, "2500 mm × 1 m/1000 mm = 2.5 m");
check(U.stepsFor(60, "mph", "km/h").text, "60 mph × (0.44704 m/s)/1 mph × (3.6 km/h)/(1 m/s) = 96.5606 km/h");
check(U.stepsFor(5, "m", "m").kind, "same");
check(U.stepsFor(NaN, "m", "km"), null);
const m = U.buildPrompt(5, "mi", "km", "length");
check(m.map((x) => x.role), ["system", "user"]);
check(m[1].content.startsWith("Explain how to convert 5 mi (miles) to km (kilometers).\nThe correct answer is: 5 mi = 8.04672 km\n"), true);
for (const h of ["3 short numbered steps", "Example:", "1609.344 m/1 mi"]) check(m[1].content.includes(h), true);
check(U.buildPrompt(100, "°C", "°F")[1].content.includes("°F = °C × 9/5 + 32; 100 × 9/5 + 32 = 212 °F"), true);
check(/null|undefined|NaN/.test(JSON.stringify(U.buildPrompt(-40, "°F", "K"))), false);
check(U.buildPrompt(1, "m", "kg"), null);
""")


if __name__ == "__main__":
    unittest.main()
