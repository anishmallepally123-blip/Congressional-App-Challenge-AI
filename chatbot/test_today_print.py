"""Checks that the AI is told today's date, and that the Print button is on the page."""
import datetime
import os
import unittest

import server

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class TodayTest(unittest.TestCase):
    def test_date_line(self):
        self.assertEqual(server.today_line(datetime.date(2026, 10, 26)), "Today is Monday, October 26, 2026.")
        self.assertEqual(server.today_line(datetime.date(2027, 1, 5)), "Today is Tuesday, January 5, 2027.")

    def test_defaults_to_today(self):
        self.assertIn(str(datetime.date.today().year), server.today_line())


class PrintTest(unittest.TestCase):
    def test_page_loads_it(self):
        with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
            self.assertIn('<script src="print.js" defer></script>', f.read())

    def test_print_hides_the_app_around_the_chat(self):
        with open(os.path.join(STATIC, "print.js"), encoding="utf-8") as f:
            script = f.read()
        self.assertIn("@media print", script)
        for part in ("#sidebar", "#composer-wrap", ".actions"):
            self.assertIn(part, script)


if __name__ == "__main__":
    unittest.main()
