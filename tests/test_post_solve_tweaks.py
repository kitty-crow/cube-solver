import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.manual_variants import _invert_moves, _normalise_centres  # noqa: E402


class PostSolveTweakTests(unittest.TestCase):
    def test_invert_moves_reverses_sequence_and_quarter_turns(self):
        self.assertEqual(
            _invert_moves("R U2 F' L"),
            ["L'", "F", "U2", "R'"],
        )

    def test_center_rotations_are_quarter_turn_normalised(self):
        self.assertEqual(_normalise_centres([5, -1, 2]), [1, 3, 2, 0, 0, 0])


if __name__ == "__main__":
    unittest.main()
