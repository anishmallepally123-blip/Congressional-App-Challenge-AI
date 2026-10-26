"""
Tests for hardware.py: reading graphics cards from each system's tools. The tools'
output is faked, so these run anywhere.

Run them with:  python -m unittest test_hardware.py
"""

import unittest

import hardware

GB = 1024 ** 3


class FakeRun:
    def __init__(self, output):
        self.output, self.commands = output, []

    def __call__(self, cmd, timeout=5):
        self.commands.append(cmd)
        return self.output


class WindowsGpuTests(unittest.TestCase):
    def setUp(self):
        self.real_run = hardware._run

    def tearDown(self):
        hardware._run = self.real_run

    def gpus(self, output):
        hardware._run = fake = FakeRun(output)
        found = hardware._windows_gpus()
        self.script = fake.commands[0][-1]
        return found

    def test_reads_cards_and_their_memory(self):
        found = self.gpus(f"AMD Radeon RX 6600|{8 * GB}\r\nIntel(R) UHD Graphics 630|{1 * GB}\r\n")
        self.assertEqual(found, [{"name": "AMD Radeon RX 6600", "vram_gb": 8.0},
                                 {"name": "Intel(R) UHD Graphics 630", "vram_gb": 1.0}])
        self.assertTrue(hardware._usable_by_ollama(found[0]))
        self.assertFalse(hardware._usable_by_ollama(found[1]))

    def test_unknown_memory_is_zero_not_a_crash(self):
        self.assertEqual(self.gpus("Microsoft Basic Display Adapter|\r\n|\r\n"),
                         [{"name": "Microsoft Basic Display Adapter", "vram_gb": 0}])

    def test_script_falls_back_to_older_memory_entries(self):
        # Older and many AMD drivers have only MemorySize, sometimes as raw bytes. Without
        # this the card showed 0 GB, so the AI was set up as if there were no graphics card.
        self.gpus("")
        self.assertIn("CurrentControlSet", self.script)
        self.assertIn("'HardwareInformation.qwMemorySize'", self.script)
        self.assertIn("'HardwareInformation.MemorySize'", self.script)
        self.assertIn("[BitConverter]::ToUInt32", self.script)
        self.assertEqual(self.script.count("{"), self.script.count("}"))


class NvidiaTests(unittest.TestCase):
    def setUp(self):
        self.real_run = hardware._run

    def tearDown(self):
        hardware._run = self.real_run

    def test_reads_name_and_memory(self):
        hardware._run = FakeRun("NVIDIA GeForce RTX 4060, 8188\nbad line\n")
        self.assertEqual(hardware._nvidia_gpus(), [{"name": "NVIDIA GeForce RTX 4060", "vram_gb": 8.0}])


if __name__ == "__main__":
    unittest.main()
