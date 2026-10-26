"""
Tests for Connectors. Run from this folder with:  python -m unittest test_connectors
They use the example Notes connector, so nothing needs downloading.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import connectors  # noqa: E402

NOTES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples", "notes_server.py")


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["NOTES_PATH"] = os.path.join(self.tmp.name, "notes.json")
        self.manager = connectors.Manager(os.path.join(self.tmp.name, "connectors.json"))
        self.manager.builtins = {}  # test MCP connectors on their own

    def tearDown(self):
        self.manager.close_all()
        self.tmp.cleanup()

    def add_notes(self):
        return self.manager.add("Notes", {"command": "python", "args": [NOTES]})

    def test_add_lists_tools_and_saves(self):
        self.assertIsNone(self.add_notes()["error"])
        row = self.manager.status()[0]
        self.assertEqual(row["name"], "Notes")
        self.assertEqual({t["name"] for t in row["tools"]}, {"add_note", "list_notes", "current_time"})
        with open(self.manager.config_path) as f:
            saved = json.load(f)
        self.assertEqual(saved["mcpServers"]["Notes"]["command"], "python")

    def test_tool_round_trip(self):
        self.add_notes()
        specs, index = self.manager.model_tools()
        self.assertIn("Notes__add_note", index)
        self.assertEqual(specs[0]["type"], "function")
        result = self.manager.call("Notes__add_note", {"title": "Milk", "text": "Buy milk"})
        self.assertFalse(result["is_error"])
        self.assertIn("Saved", result["text"])
        self.assertIn("Buy milk", self.manager.call("Notes__list_notes", {})["text"])

    def test_status_gives_each_tool_its_key_and_inputs_for_try_it(self):
        self.add_notes()
        tool = next(t for t in self.manager.status()[0]["tools"] if t["name"] == "add_note")
        self.assertEqual(tool["key"], "Notes__add_note")
        self.assertIn("text", tool["schema"]["properties"])
        result = self.manager.call(tool["key"], {"text": "tried by hand"})
        self.assertFalse(result["is_error"])

    def test_off_tools_are_hidden_from_the_model(self):
        self.add_notes()
        self.manager.set_approval("Notes", "add_note", "off")
        _, index = self.manager.model_tools()
        self.assertNotIn("Notes__add_note", index)
        with self.assertRaises(connectors.ConnectorError):
            self.manager.call("Notes__add_note", {"title": "x", "text": "y"})

    def test_disabled_connector_is_stopped(self):
        self.add_notes()
        self.manager.set_enabled("Notes", False)
        self.assertEqual(self.manager.model_tools(), ([], {}))
        self.assertNotIn("Notes", self.manager.conns)

    def test_broken_connector_reports_error_and_does_not_block_chat(self):
        res = self.manager.add("Broken", {"command": "this-program-does-not-exist-123"})
        self.assertIn("Could not start", res["error"])
        self.assertEqual(self.manager.model_tools(), ([], {}))

    def test_program_that_exits_reports_its_output(self):
        res = self.manager.add("Crash", {"command": "python", "args": ["-c", "import sys; sys.exit('bad key')"]})
        self.assertIn("bad key", res["error"])

    def test_import_claude_desktop_config(self):
        text = json.dumps({"mcpServers": {"notes2": {"command": "python", "args": [NOTES]}}})
        added = self.manager.import_config(text)
        self.assertEqual(added[0]["name"], "notes2")
        self.assertIsNone(added[0]["error"])
        with self.assertRaises(connectors.ConnectorError):
            self.manager.import_config("not json")

    def test_rejects_bad_settings(self):
        with self.assertRaises(connectors.ConnectorError):
            self.manager.add("x", {})
        with self.assertRaises(connectors.ConnectorError):
            self.manager.add("x", {"url": "ftp://nope"})
        with self.assertRaises(connectors.ConnectorError):
            self.manager.add("bad/name", {"command": "python"})

    def test_add_tools_to_payload(self):
        self.add_notes()
        payload = {"messages": [{"role": "system", "content": "Be nice."}]}
        history = [
            {"role": "user", "content": "hi", "extra": 1},
            {"role": "assistant", "content": "", "model": "m", "tool_calls": [
                {"function": {"name": "Notes__current_time", "arguments": {}}, "ui": {"state": "done"}}]},
            {"role": "tool", "tool_name": "Notes__current_time", "content": "Monday"},
        ]
        self.assertEqual(connectors.add_tools(self.manager, payload, history, ["completion", "tools"]), [])
        self.assertIn("tools", payload)
        self.assertIn("Be nice.", payload["messages"][0]["content"])
        self.assertEqual(payload["messages"][1], {"role": "user", "content": "hi"})
        self.assertNotIn("ui", payload["messages"][2]["tool_calls"][0])
        self.assertEqual(payload["messages"][3]["tool_name"], "Notes__current_time")

    def test_model_without_tools_gets_a_notice(self):
        self.add_notes()
        payload = {"messages": [{"role": "system", "content": "Be nice."}]}
        events = connectors.add_tools(self.manager, payload, [], ["completion"])
        self.assertEqual(events[0]["type"], "notice")
        self.assertNotIn("tools", payload)

    def test_tool_calls_event(self):
        self.add_notes()
        event = connectors.tool_calls_event(self.manager, [
            {"function": {"name": "Notes__add_note", "arguments": '{"title": "a", "text": "b"}'}},
            {"function": {"name": "made_up", "arguments": {}}},
        ])
        first, second = event["calls"]
        self.assertEqual((first["connector"], first["tool"], first["approval"]), ("Notes", "add_note", "ask"))
        self.assertEqual(first["arguments"], {"title": "a", "text": "b"})
        self.assertEqual(second["approval"], "missing")


if __name__ == "__main__":
    unittest.main()
