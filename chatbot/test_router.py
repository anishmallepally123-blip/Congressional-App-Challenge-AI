import unittest

import router

CODING = [
    "write a python script that renames files",
    "build a snake game in python",
    "make a website for my bakery",
    "write a bash script to back up my folder",
    "create a discord bot",
    "fix the bug in my game",
    "write a complete python project",
    "write a script that sorts my photos",
    "make a video game",
    "make a calculator app",
    "fix the error in my code",
    "build a game for my team to play in the browser with javascript",
]
NOT_CODING = [
    "Write a script for my YouTube video about volcanoes",
    "write a script for our school play",
    "Create a script for my podcast intro",
    "write a movie script",
    "help me write a skit script for class",
    "write a full program for the school talent show",
    "make a full workout program for me",
    "Create a complete game plan for our soccer team",
    "Make a board game about history",
    "Write a complete essay on the history of the app store",
    "what tool should I use to cut wood? give me a step by step",
    "how do I reverse a list in Python?",
]


class RouterTest(unittest.TestCase):
    def test_coding_projects_go_to_the_coding_model(self):
        for text in CODING:
            with self.subTest(text=text):
                self.assertTrue(router.is_big_coding_request(text))

    def test_scripts_for_videos_and_plays_stay_with_the_chat_model(self):
        for text in NOT_CODING:
            with self.subTest(text=text):
                self.assertFalse(router.is_big_coding_request(text))

    def test_choose(self):
        ask = lambda text: [{"role": "user", "content": text}]  # noqa: E731
        self.assertEqual(router.choose(ask("build a snake game in python"), "chat", "coder")[0], "coder")
        self.assertEqual(router.choose(ask("write a script for our school play"), "chat", "coder"), ("chat", None))

    def test_follow_up_moves_on_from_code(self):
        chat = [
            {"role": "user", "content": "build a snake game in python"},
            {"role": "assistant", "content": "...", "model": "coder"},
        ]
        self.assertEqual(router.choose(chat + [{"role": "user", "content": "make the snake faster"}], "chat", "coder")[0], "coder")
        self.assertEqual(router.choose(chat + [{"role": "user", "content": "add a loop"}], "chat", "coder")[0], "coder")
        moved_on = chat + [{"role": "user", "content": "now write a script for my YouTube video about it"}]
        self.assertEqual(router.choose(moved_on, "chat", "coder"), ("chat", None))


if __name__ == "__main__":
    unittest.main()
