"""
Tests for the QR code maker (qr.py) and the phone QR code in the app.

The expected fingerprints below were checked by decoding the codes with the
zxing-cpp QR reader, and the rest of the encoder was compared square by square
with the segno library for every version and mask it supports.

Run them with:  python -m unittest test_qr.py
"""

import hashlib
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()  # keep the real ~/.local-ai-chat untouched

import phone  # noqa: E402
import qr  # noqa: E402
import server  # noqa: E402


def fingerprint(rows):
    return hashlib.sha256("".join("1" if d else "0" for row in rows for d in row).encode()).hexdigest()[:16]


class QRTests(unittest.TestCase):
    def test_known_codes(self):
        # (text, squares per side, fingerprint of a code a real QR reader decoded back to the text)
        for text, size, expected in [
            ("hi", 21, "69f439bee9c38226"),
            ("http://192.168.1.23:8000/?code=123456", 29, "447a0efa90785bc2"),
            ("x" * 106, 41, "7c10b09ae528505d"),
        ]:
            rows = qr.matrix(text)
            self.assertEqual(len(rows), size)
            self.assertEqual(fingerprint(rows), expected)

    def test_corner_squares_and_timing_lines(self):
        rows = qr.matrix("http://10.0.0.5:8000/?code=000042")
        n = len(rows)
        for x0, y0 in ((0, 0), (n - 7, 0), (0, n - 7)):
            self.assertTrue(all(rows[y0][x0 + i] and rows[y0 + 6][x0 + i] for i in range(7)))
            self.assertFalse(rows[y0 + 1][x0 + 1])
            self.assertTrue(rows[y0 + 3][x0 + 3])
        self.assertEqual([rows[6][x] for x in range(8, n - 8)], [x % 2 == 0 for x in range(8, n - 8)])

    def test_too_long_text_is_refused(self):
        with self.assertRaises(ValueError):
            qr.matrix("x" * 107)

    def test_svg(self):
        picture = qr.svg("hi")
        self.assertTrue(picture.startswith("<svg") and picture.endswith("</svg>"))
        self.assertIn('viewBox="0 0 29 29"', picture)  # 21 squares plus a 4-square margin on each side


class PhoneQRRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = server.ThreadingHTTPServer(("127.0.0.1", 0), server.ChatHandler)
        threading.Thread(target=cls.app.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.app.server_port}/api/phone/qr"

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()

    def tearDown(self):
        phone._state.update(enabled=False, ip=None, code=None)

    def test_no_qr_while_phone_access_is_off(self):
        with self.assertRaises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(self.url)
        self.assertEqual(err.exception.code, 404)

    def test_qr_holds_the_address_and_code(self):
        phone._state.update(enabled=True, ip="192.168.1.23", code="123456")
        self.assertEqual(phone.status(8000)["pair_url"], "http://192.168.1.23:8000/?code=123456")
        with urllib.request.urlopen(self.url + "?123456") as resp:
            self.assertEqual(resp.headers["Content-Type"], "image/svg+xml")
            self.assertEqual(resp.read().decode(), qr.svg(phone.status(server.PORT)["pair_url"]))


if __name__ == "__main__":
    unittest.main()
