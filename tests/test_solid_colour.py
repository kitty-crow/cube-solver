import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.solid_colour import reconstruct_solid_colour_3x3  # noqa: E402


class SolidColourTests(unittest.TestCase):
    TILE = 8
    COLOURS = {
        "U": (238, 238, 232),
        "R": (205, 38, 42),
        "F": (35, 165, 83),
        "D": (244, 215, 43),
        "L": (239, 113, 28),
        "B": (38, 91, 196),
    }

    def make_raw(self):
        data = bytearray()
        for face_index, face in enumerate("URFDLB"):
            base = self.COLOURS[face]
            for local in range(9):
                # Simulate mild exposure variation between stickers while
                # keeping the six actual colours unchanged.
                shift = ((local * 3 + face_index) % 7) - 3
                rgb = tuple(max(0, min(255, channel + shift)) for channel in base)
                for _ in range(self.TILE * self.TILE):
                    data.extend(rgb)
        return bytes(data)

    def test_solved_cube_is_reconstructed_from_six_colours(self):
        result = reconstruct_solid_colour_3x3(self.make_raw(), self.TILE)
        self.assertEqual(result["state"], "".join(face * 9 for face in "URFDLB"))
        self.assertEqual(result["colour_count"], 6)
        self.assertEqual(result["method"], "six-centre-colours+exact-cubie-constraints")
        self.assertGreater(result["confidence"], 0.70)

    def test_wrong_byte_count_is_rejected(self):
        with self.assertRaises(ValueError):
            reconstruct_solid_colour_3x3(b"bad", self.TILE)


if __name__ == "__main__":
    unittest.main()
