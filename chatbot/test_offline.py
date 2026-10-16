"""Checks the offline badge: it's on the page and never tells phones the AI still works."""
import os
import unittest

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


class OfflineBadgeTest(unittest.TestCase):
    def test_page_loads_it(self):
        self.assertIn('<script src="offline.js" defer></script>', read("index.html"))

    def test_listens_for_both_directions(self):
        script = read("offline.js")
        self.assertIn('addEventListener("offline"', script)
        self.assertIn('addEventListener("online"', script)

    def test_hidden_on_phones(self):
        # A phone with no network can't reach the computer, so "AI still works" would be wrong there.
        self.assertIn("body.on-phone #offline-pill { display: none; }", read("offline.js"))


if __name__ == "__main__":
    unittest.main()
