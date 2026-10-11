"""Tests for starting the app when its usual port is already taken."""

import os
import socket
import unittest

import server


def free_block():
    """A port where it and the next one are both free, to keep the test independent of the machine."""
    for _ in range(50):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        if not server.port_in_use(port) and not server.port_in_use(port + 1):
            return port
    raise unittest.SkipTest("no free ports")


class PortTests(unittest.TestCase):
    def setUp(self):
        self.saved = server.PORT
        os.environ.pop("PORT", None)

    def tearDown(self):
        server.PORT = self.saved

    def test_moves_to_the_next_port_when_another_program_has_it(self):
        port = free_block()
        other = socket.socket()
        other.bind(("127.0.0.1", port))
        other.listen()
        server.PORT = port
        try:
            httpd, used = server.open_server()
            httpd.server_close()
        finally:
            other.close()
        self.assertEqual(used, port + 1)
        self.assertEqual(server.PORT, port + 1)

    def test_keeps_the_usual_port_when_it_is_free(self):
        port = free_block()
        server.PORT = port
        httpd, used = server.open_server()
        httpd.server_close()
        self.assertEqual(used, port)

    def test_a_port_chosen_on_purpose_is_not_moved(self):
        port = free_block()
        other = socket.socket()
        other.bind(("127.0.0.1", port))
        other.listen()
        server.PORT = port
        os.environ["PORT"] = str(port)
        try:
            with self.assertRaises(SystemExit) as e:
                server.open_server()
        finally:
            other.close()
            os.environ.pop("PORT", None)
        self.assertIn("being used by another program", str(e.exception))


if __name__ == "__main__":
    unittest.main()
