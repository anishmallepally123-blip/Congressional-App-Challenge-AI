"""Tests for sending pictures to models that can see (the 📷 button)."""

import unittest

import server
import connectors  # server.py puts the connectors folder on the path

PHOTO = "/9j/4AAQSkZJRgABAQAAAQABAAD" + "A" * 100  # the start of a base64 JPEG


class PhotoTests(unittest.TestCase):
    def test_pictures_go_to_ollama_with_the_question(self):
        msg = server.ollama_message({"role": "user", "content": "What is this?", "images": [PHOTO]})
        self.assertEqual(msg, {"role": "user", "content": "What is this?", "images": [PHOTO]})

    def test_messages_without_pictures_are_unchanged(self):
        self.assertEqual(server.ollama_message({"role": "assistant", "content": "Hi", "model": "x"}),
                         {"role": "assistant", "content": "Hi"})

    def test_only_real_pictures_are_kept_and_at_most_two(self):
        self.assertEqual(server.photos_in({"images": [PHOTO, "not base64!", 5, "", PHOTO, PHOTO]}), [PHOTO, PHOTO])
        self.assertEqual(server.photos_in({"images": "oops"}), [])
        self.assertEqual(server.photos_in({"images": ["A" * (server.PHOTO_CHARS + 1)]}), [])
        self.assertEqual(server.photos_in("not a message"), [])

    def test_pictures_survive_when_connectors_tidy_the_messages(self):
        cleaned = connectors.clean_messages([{"role": "user", "content": "Read this", "images": [PHOTO]},
                                             {"role": "assistant", "content": "Sure", "images": [PHOTO]}])
        self.assertEqual(cleaned[0]["images"], [PHOTO])
        self.assertNotIn("images", cleaned[1])  # only the user's own messages carry pictures


if __name__ == "__main__":
    unittest.main()
