"""
Tests for the Folder Organizer. They use a throwaway folder and a fake AI model,
so they never touch real files and don't need Ollama running.

Run them with:  python -m unittest test_organizer.py
"""

import os
import tempfile
import unittest

_data = tempfile.mkdtemp()
os.environ["ORGANIZER_DATA_DIR"] = _data

import organizer  # noqa: E402  (must come after setting the data folder)


def make_files(root, names):
    for name in names:
        with open(os.path.join(root, name), "w") as f:
            f.write(name)


def listing(root):
    found = []
    for folder, _, files in os.walk(root):
        found += [os.path.relpath(os.path.join(folder, f), root).replace(os.sep, "/") for f in files]
    return sorted(found)


class OrganizerTests(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp())
        make_files(self.root, ["IMG_2041.jpg", "essay.docx", "budget.xlsx", "notes.txt", "song.mp3", "mystery"])
        self.real_ask = organizer._ask_model

    def tearDown(self):
        organizer._ask_model = self.real_ask

    def fake_model(self, moves):
        organizer._ask_model = lambda model, prompt: {"summary": "Tidied.", "moves": moves}

    def test_plan_changes_nothing_until_applied(self):
        before = listing(self.root)
        plan = organizer.make_plan(self.root)
        self.assertTrue(plan["moves"])
        self.assertEqual(listing(self.root), before)

    def test_type_plan_apply_and_undo(self):
        before = listing(self.root)
        plan = organizer.make_plan(self.root)
        run = organizer.apply_plan(plan["id"])
        after = listing(self.root)
        self.assertIn("Images/IMG_2041.jpg", after)
        self.assertIn("mystery", after)  # unknown types stay put
        self.assertEqual(len(after), len(before))
        report = organizer.undo_run(run["id"])
        self.assertEqual(report["problems"], [])
        self.assertEqual(listing(self.root), before)
        self.assertFalse(os.path.exists(os.path.join(self.root, "Images")))  # empty folder removed

    def test_unsafe_model_suggestions_are_dropped(self):
        make_files(self.root, ["IMG_2042.jpg"])
        self.fake_model([
            {"from": "essay.docx", "to": "../escaped.docx"},
            {"from": "notes.txt", "to": "/etc/notes.txt"},
            {"from": "not-here.txt", "to": "x/not-here.txt"},
            {"from": "budget.xlsx", "to": "Money/budget"},  # extension added back
            {"from": "IMG_2041.jpg", "to": "Photos/Beach day.jpg", "reason": "photo"},
            {"from": "IMG_2042.jpg", "to": "Photos/beach DAY.jpg"},  # same destination
        ])
        plan = organizer.make_plan(self.root, model="fake")
        tos = {m["from"]: m["to"] for m in plan["moves"]}
        self.assertEqual(tos, {"budget.xlsx": "Money/budget.xlsx", "IMG_2041.jpg": "Photos/Beach day.jpg"})
        self.assertEqual(len(plan["skipped"]), 4)

    def test_never_overwrites(self):
        os.mkdir(os.path.join(self.root, "Docs"))
        make_files(os.path.join(self.root, "Docs"), ["essay.docx"])
        self.fake_model([{"from": "essay.docx", "to": "Docs/essay.docx"}])
        run = organizer.apply_plan(organizer.make_plan(self.root, model="fake")["id"])
        self.assertEqual(run["moves"][0]["to"].replace(os.sep, "/"), "Docs/essay (2).docx")
        with open(os.path.join(self.root, "Docs", "essay.docx")) as f:
            self.assertEqual(f.read(), "essay.docx")  # the existing file is untouched

    def test_only_approved_moves_happen(self):
        plan = organizer.make_plan(self.root)
        run = organizer.apply_plan(plan["id"], approved=["notes.txt"])
        self.assertEqual([m["from"] for m in run["moves"]], ["notes.txt"])
        self.assertIn("IMG_2041.jpg", listing(self.root))

    def test_plan_cannot_be_applied_twice(self):
        plan = organizer.make_plan(self.root)
        organizer.apply_plan(plan["id"])
        with self.assertRaises(organizer.OrganizerError):
            organizer.apply_plan(plan["id"])

    def test_model_failure_falls_back_to_type_plan(self):
        def broken(model, prompt):
            raise ValueError("not json")
        organizer._ask_model = broken
        plan = organizer.make_plan(self.root, model="fake")
        self.assertIsNone(plan["model"])
        self.assertTrue(plan["moves"])
        self.assertIn("sorted by type", plan["note"])

    def test_refuses_home_and_system_folders(self):
        for path in ("~", "/", "/etc", "/usr/share"):
            with self.assertRaises(organizer.OrganizerError):
                organizer.check_folder(path)

    def test_bad_ids_are_rejected(self):
        with self.assertRaises(organizer.OrganizerError):
            organizer.get_plan("../../etc/passwd")



class DuplicateTests(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp())
        files = {
            "essay.docx": "final essay", "essay (1).docx": "final essay", "essay copy.docx": "final essay",
            "photo.jpg": "pixels", "IMG_2041.jpg": "pixels", "notes.txt": "different text",
            "draft.txt": "differ text!!", "empty1.txt": "", "empty2.txt": "",
        }
        for name, text in files.items():
            with open(os.path.join(self.root, name), "w") as f:
                f.write(text)
        # notes.txt and draft.txt are the same size but not the same, so they stay put
        old = os.path.join(self.root, "IMG_2041.jpg")
        os.utime(old, (1_000_000_000, 1_000_000_000))  # the older photo is the one kept

    def test_extra_copies_move_aside_and_undo_puts_them_back(self):
        before = listing(self.root)
        plan = organizer.duplicates_plan(self.root)
        tos = {m["from"]: m["to"] for m in plan["moves"]}
        self.assertEqual(tos, {
            "essay (1).docx": "Duplicates/essay (1).docx",
            "essay copy.docx": "Duplicates/essay copy.docx",
            "photo.jpg": "Duplicates/photo.jpg",
        })
        self.assertIn("Same as essay.docx", plan["moves"][0]["reason"] + plan["moves"][1]["reason"])
        self.assertIn("Found 3 duplicate files", plan["summary"])
        run = organizer.apply_plan(plan["id"])
        self.assertIn("Duplicates/photo.jpg", listing(self.root))
        self.assertIn("IMG_2041.jpg", listing(self.root))
        organizer.undo_run(run["id"])
        self.assertEqual(listing(self.root), before)

    def test_no_duplicates(self):
        for name in ("essay (1).docx", "essay copy.docx", "photo.jpg"):
            os.remove(os.path.join(self.root, name))
        plan = organizer.duplicates_plan(self.root)
        self.assertEqual(plan["moves"], [])
        self.assertEqual(plan["summary"], "No duplicate files found.")


if __name__ == "__main__":
    unittest.main()
