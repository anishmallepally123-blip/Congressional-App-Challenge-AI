"""
Tests for pairing a phone with the code shown on the computer (phone.py).
They don't open any network ports.

Run them with:  python -m unittest test_phone.py
"""

import os
import tempfile
import unittest

os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()  # keep the real ~/.local-ai-chat untouched

import phone  # noqa: E402


class PairingTest(unittest.TestCase):
    def setUp(self):
        phone._state.update(enabled=True, code="123456", tokens=[], wrong=0)

    def test_right_code_gives_a_token_that_works(self):
        token = phone.pair("123456")
        self.assertTrue(token)
        self.assertTrue(phone.is_paired(f"other=1; phone={token}"))

    def test_wrong_code_is_refused(self):
        self.assertIsNone(phone.pair("654321"))

    def test_wide_digits_and_spaces_from_phone_keyboards_still_match(self):
        self.assertTrue(phone.pair("１２３４５６"))
        self.assertTrue(phone.pair(" 123 456 "))

    def test_accents_or_emoji_are_refused_without_crashing(self):
        self.assertIsNone(phone.pair("é12345"))
        self.assertIsNone(phone.pair("📱"))

    def test_odd_cookie_is_refused_without_crashing(self):
        phone.pair("123456")
        self.assertFalse(phone.is_paired("phone=é"))
        self.assertFalse(phone.is_paired("phone=ðŸ“±"))

    def test_too_many_wrong_codes_changes_the_code(self):
        for _ in range(phone.MAX_WRONG_CODES):
            phone.pair("000000")
        self.assertEqual(phone._state["wrong"], 0)
        if phone._state["code"] != "123456":  # a new random code (1 in a million it's the same)
            self.assertIsNone(phone.pair("123456"))


if __name__ == "__main__":
    unittest.main()
