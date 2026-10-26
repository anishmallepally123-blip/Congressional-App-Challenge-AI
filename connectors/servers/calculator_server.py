"""
Calculator connector: exact math and unit conversions for the AI.

    python calculator_server.py

Small models are good with words but often get arithmetic wrong, because they
guess numbers one piece at a time. With this connector they can hand the math to
Python instead. It works offline and never runs anything except arithmetic.
"""

import ast
import math
import operator
import re

from mcp_server import Server, ToolError

server = Server("calculator")

# ---------- Calculating ----------

OPERATORS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
    ast.USub: operator.neg, ast.UAdd: operator.pos,
}
# Angles are in degrees, the way people usually write them in school.
FUNCTIONS = {
    "sqrt": math.sqrt, "abs": abs, "round": round, "floor": math.floor, "ceil": math.ceil,
    "log": math.log, "log10": math.log10, "log2": math.log2, "ln": math.log, "exp": math.exp,
    "sin": lambda d: math.sin(math.radians(d)), "cos": lambda d: math.cos(math.radians(d)),
    "tan": lambda d: math.tan(math.radians(d)), "asin": lambda v: math.degrees(math.asin(v)),
    "acos": lambda v: math.degrees(math.acos(v)), "atan": lambda v: math.degrees(math.atan(v)),
    "factorial": lambda n: math.factorial(int(n)) if n == int(n) and 0 <= n <= 1000 else _too_big("Factorial needs a whole number from 0 to 1000."),
    "min": min, "max": max,
}
CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}
MAX_LENGTH = 300


def _too_big(message):
    raise ToolError(message)


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.Name) and node.id in CONSTANTS:
        return CONSTANTS[node.id]
    if isinstance(node, ast.UnaryOp) and type(node.op) in OPERATORS:
        return OPERATORS[type(node.op)](_eval(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
        left, right = _eval(node.left), _eval(node.right)
        # Keep powers small enough to finish instantly, so 9**9**9 can't freeze the computer.
        if isinstance(node.op, ast.Pow) and (abs(right) > 1000 or (abs(left) > 1e6 and abs(right) > 50)):
            _too_big("That power is too big to work out.")
        return OPERATORS[type(node.op)](left, right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords:
        return FUNCTIONS[node.func.id](*[_eval(a) for a in node.args])
    raise ToolError("Use only numbers, + - * / ^ ( ), and functions like sqrt, round, sin or log.")


def clean_expression(text):
    """Turn everyday math writing into Python: 3 × 4, 2^10, 12 ÷ 4, 1,250 + 3, 15% of 80."""
    text = text.strip().rstrip("=").strip()
    text = text.replace("×", "*").replace("÷", "/").replace("−", "-").replace("^", "**")
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)  # 1,250 -> 1250 (but not round(2.5,1))
    text = re.sub(r"(\d+(?:\.\d+)?)\s*%\s*of\s*", r"\1/100*", text, flags=re.IGNORECASE)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*%(?!\s*[\d(.])", r"(\1/100)", text)  # 18% -> (18/100), but 10 % 3 stays
    return text


def calculate_value(expression):
    expr = clean_expression(expression or "")
    if not expr:
        raise ToolError("Give me something to calculate, like 18 * 4.5.")
    if len(expr) > MAX_LENGTH:
        raise ToolError(f"That's too long. Keep it under {MAX_LENGTH} characters.")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise ToolError(f"I couldn't read \"{expression}\" as math. Write it like (3 + 4) * 2.")
    try:
        return _eval(tree)
    except ZeroDivisionError:
        raise ToolError("That divides by zero, which has no answer.")
    except (ValueError, OverflowError) as e:
        raise ToolError(f"That has no real answer ({e}).")
    except TypeError:
        raise ToolError("A function got the wrong number of numbers, like round(2.567, 2) needs two.")


def show(value):
    """A number as people write it: no 0.30000000000000004, no 12.0, commas in big numbers."""
    if isinstance(value, float):
        if math.isinf(value) or math.isnan(value):
            raise ToolError("The answer is too big to show.")
        if value == int(value) and abs(value) < 1e15:
            value = int(value)
        else:
            text = f"{value:.12g}"
            return text if "e" in text else f"{float(text):,}"
    return f"{value:,}"


@server.tool("Calculate", read_only=True,
             description="Work out a math expression exactly. Use this for ANY arithmetic instead of doing it "
                         "in your head: totals, tips, percentages, averages, powers, roots, trigonometry "
                         "(angles in degrees). Example: (47.83 * 1.18) / 3",
             params={"expression": ("string", "The math to work out, e.g. 2^10 + sqrt(144) or 15% of 80")},
             required=["expression"])
def calculate(expression):
    return f"{expression.strip()} = {show(calculate_value(expression))}"


# ---------- Converting units ----------

# Each unit's size in a base unit (metres, kilograms, litres, seconds, metres per second).
UNITS = {
    "length": {"mm": 0.001, "cm": 0.01, "m": 1, "km": 1000, "in": 0.0254, "ft": 0.3048, "yd": 0.9144, "mi": 1609.344},
    "mass": {"mg": 1e-6, "g": 0.001, "kg": 1, "t": 1000, "oz": 0.028349523125, "lb": 0.45359237, "st": 6.35029318},
    "volume": {"ml": 0.001, "l": 1, "tsp": 0.00492892159375, "tbsp": 0.01478676478125, "floz": 0.0295735295625,
               "cup": 0.2365882365, "pt": 0.473176473, "qt": 0.946352946, "gal": 3.785411784},
    "time": {"s": 1, "min": 60, "h": 3600, "day": 86400, "week": 604800, "year": 31557600},
    "speed": {"m/s": 1, "km/h": 1 / 3.6, "mph": 0.44704, "knot": 0.514444444},
}
ALIASES = {
    "millimeter": "mm", "centimeter": "cm", "meter": "m", "metre": "m", "kilometer": "km", "inch": "in", "inches": "in",
    "foot": "ft", "feet": "ft", "yard": "yd", "mile": "mi", "gram": "g", "kilogram": "kg", "kilo": "kg", "kgs": "kg",
    "milligram": "mg", "ton": "t", "tonne": "t", "ounce": "oz", "pound": "lb", "lbs": "lb", "stone": "st",
    "milliliter": "ml", "millilitre": "ml", "liter": "l", "litre": "l", "teaspoon": "tsp", "tablespoon": "tbsp",
    "fluid ounce": "floz", "fl oz": "floz", "pint": "pt", "quart": "qt", "gallon": "gal", "second": "s", "sec": "s",
    "minute": "min", "hour": "h", "hr": "h", "days": "day", "weeks": "week", "years": "year", "yr": "year",
    "kph": "km/h", "kmh": "km/h", "miles per hour": "mph", "knots": "knot",
    "celsius": "c", "°c": "c", "fahrenheit": "f", "°f": "f", "kelvin": "k",
}
TEMPERATURES = {"c", "f", "k"}


def unit_name(text):
    """Find a unit from how people write it: "Feet", "kilometres", "°F", "lbs"."""
    raw = " ".join((text or "").strip().lower().split())
    for candidate in (raw, raw.rstrip("s"), raw.replace("metres", "metre").replace("meters", "meter")):
        name = ALIASES.get(candidate, candidate)
        if name in TEMPERATURES or any(name in table for table in UNITS.values()):
            return name
    raise ToolError(f"I don't know the unit \"{text}\". Try units like km, mi, kg, lb, l, cup, °C or °F.")


def convert_value(value, from_unit, to_unit):
    a, b = unit_name(from_unit), unit_name(to_unit)
    if a in TEMPERATURES or b in TEMPERATURES:
        if not (a in TEMPERATURES and b in TEMPERATURES):
            raise ToolError("Temperatures can only be converted to other temperatures.")
        kelvin = {"c": value + 273.15, "f": (value - 32) * 5 / 9 + 273.15, "k": value}[a]
        return {"c": kelvin - 273.15, "f": (kelvin - 273.15) * 9 / 5 + 32, "k": kelvin}[b]
    for table in UNITS.values():
        if a in table and b in table:
            return value * table[a] / table[b]
    raise ToolError(f"Can't convert {from_unit} to {to_unit}: they measure different things.")


@server.tool("Convert units", read_only=True,
             description="Convert a measurement exactly between units of length, weight, volume, time, speed "
                         "or temperature, e.g. 5 miles to km, 350 F to C, 2 cups to ml.",
             params={"value": ("number", "The amount to convert"),
                     "from_unit": ("string", "The unit it's in, e.g. mi, lb, cup, F"),
                     "to_unit": ("string", "The unit you want, e.g. km, kg, ml, C")},
             required=["value", "from_unit", "to_unit"])
def convert_units(value, from_unit, to_unit):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ToolError(f"\"{value}\" isn't a number.")
    result = convert_value(value, from_unit, to_unit)
    return f"{show(value)} {from_unit.strip()} = {show(round(result, 6))} {to_unit.strip()}"


if __name__ == "__main__":
    server.run()
