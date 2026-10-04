"""
Tests for Shared Files. They build small Word, PowerPoint, Excel and PDF files in a
throwaway folder, so they don't need real documents or Ollama.

Run them with:  python -m unittest test_shared_files.py
"""

import os
import tempfile
import unittest
import zipfile
import zlib

os.environ.setdefault("ORGANIZER_DATA_DIR", tempfile.mkdtemp())

import organizer  # noqa: E402
import shared_files  # noqa: E402


def write_zip(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)


def write_pdf(path, text):
    stream = zlib.compress(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1"))
    with open(path, "wb") as f:
        f.write(b"%%PDF-1.4\n4 0 obj << /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream))
        f.write(stream + b"\nendstream\nendobj\n%%EOF\n")


def make_sample(root):
    write_zip(os.path.join(root, "Untitled 3.docx"), {
        "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>The New Deal</w:t></w:r></w:p>"
                             "<w:p><w:r><w:t>Roosevelt&apos;s programs created jobs during the Great Depression.</w:t>"
                             "</w:r></w:p></w:body></w:document>",
    })
    write_zip(os.path.join(root, "bio slides.pptx"), {
        "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Photosynthesis</a:t></a:r></a:p></p:sld>",
        "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Chlorophyll absorbs light</a:t></a:r></a:p></p:sld>",
    })
    write_zip(os.path.join(root, "budget.xlsx"), {
        "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Cost</t></si><si><t>Robotics kit</t></si></sst>",
        "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
                                    '<row><c t="s"><v>2</v></c><c><v>149.99</v></c></row></sheetData></worksheet>',
    })
    write_pdf(os.path.join(root, "science fair.pdf"), "Science fair project due November 12")
    os.mkdir(os.path.join(root, "Club"))
    with open(os.path.join(root, "Club", "meeting notes.txt"), "w") as f:
        f.write("Chess club meets Thursday in room 204.")
    with open(os.path.join(root, "passwords.txt"), "w") as f:
        f.write("bank: hunter2")
    with open(os.path.join(root, "photo.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff not text")


class SharedFilesTests(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp())
        make_sample(self.root)

    def tearDown(self):
        for f in shared_files.shared_folders():
            shared_files.unshare(f)

    def test_reads_office_pdf_and_text(self):
        text = lambda name: shared_files.extract_text(os.path.join(self.root, name))  # noqa: E731
        self.assertIn("Roosevelt's programs", text("Untitled 3.docx"))
        self.assertIn("Chlorophyll", text("bio slides.pptx"))
        self.assertIn("Robotics kit | 149.99", text("budget.xlsx"))
        self.assertIn("due November 12", text("science fair.pdf"))
        self.assertEqual(text("photo.jpg"), "")

    def test_private_files_are_never_read(self):
        self.assertEqual(shared_files.extract_text(os.path.join(self.root, "passwords.txt")), "")
        shared_files.share(self.root)
        self.assertEqual(shared_files.status()[0]["private"], 1)
        context, _ = shared_files.context_for([{"role": "user", "content": "what is my bank password hunter2"}])
        self.assertNotIn("hunter2", context)

    def test_nothing_is_used_until_shared(self):
        self.assertEqual(shared_files.context_for([{"role": "user", "content": "New Deal"}]), ("", []))
        self.assertEqual(shared_files.search("New Deal"), [])

    def test_search_finds_the_right_file(self):
        shared_files.share(self.root)
        self.assertTrue(shared_files.search("when is the science fair project due")[0]["file"].endswith("science fair.pdf"))
        self.assertTrue(shared_files.search("essay about Roosevelt")[0]["file"].endswith("Untitled 3.docx"))
        self.assertTrue(shared_files.search("chess club room")[0]["file"].endswith("Club/meeting notes.txt"))

    def test_context_names_its_sources(self):
        shared_files.share(self.root)
        context, sources = shared_files.context_for([{"role": "user", "content": "How much was the robotics kit?"}])
        self.assertIn("149.99", context)
        self.assertTrue(sources[0].endswith("budget.xlsx"))

    def test_reading_never_changes_files(self):
        before = {f: os.stat(os.path.join(d, f)).st_mtime for d, _, fs in os.walk(self.root) for f in fs}
        shared_files.share(self.root)
        shared_files.context_for([{"role": "user", "content": "anything"}])
        after = {f: os.stat(os.path.join(d, f)).st_mtime for d, _, fs in os.walk(self.root) for f in fs}
        self.assertEqual(before, after)

    def test_new_files_are_picked_up_and_unshare_forgets(self):
        shared_files.share(self.root)
        with open(os.path.join(self.root, "new.txt"), "w") as f:
            f.write("Volcano model needs baking soda")
        shared_files.refresh(max_age=0)
        self.assertTrue(shared_files.search("volcano baking soda"))
        shared_files.unshare(self.root)
        self.assertEqual(shared_files.search("volcano baking soda"), [])

    def test_system_folders_cannot_be_shared(self):
        with self.assertRaises(organizer.OrganizerError):
            shared_files.share("~")

    def test_organizer_sees_contents_only_when_shared(self):
        prompts = []
        real = organizer._ask_model
        organizer._ask_model = lambda model, prompt: prompts.append(prompt) or {"moves": []}
        try:
            organizer.make_plan(self.root, model="fake")
            self.assertNotIn("Roosevelt", prompts[-1])
            shared_files.share(self.root)
            organizer.make_plan(self.root, model="fake")
            self.assertIn("Roosevelt", prompts[-1])
            self.assertNotIn("hunter2", prompts[-1])
        finally:
            organizer._ask_model = real


if __name__ == "__main__":
    unittest.main()
