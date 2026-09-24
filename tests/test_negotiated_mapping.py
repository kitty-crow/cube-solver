import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

import cube_backend  # noqa: E402


class NegotiatedMappingTests(unittest.TestCase):
    def test_shorter_solution_wins_when_mapping_quality_is_close(self):
        candidates = [
            {"move_count": 10, "confidence": 0.90, "score": 1.0},
            {"move_count": 18, "confidence": 0.94, "score": 1.1},
        ]
        chosen = cube_backend._select_minmax(candidates)
        self.assertEqual(chosen["move_count"], 10)

    def test_much_stronger_mapping_can_beat_one_move_difference(self):
        candidates = [
            {"move_count": 10, "confidence": 0.62, "score": 1.0},
            {"move_count": 11, "confidence": 0.96, "score": 1.1},
        ]
        chosen = cube_backend._select_minmax(candidates)
        self.assertEqual(chosen["move_count"], 11)

    def test_reference_agreement_contributes_to_mapping_quality(self):
        weak = {
            "confidence": 0.70,
            "picture_verification": {"agreement": 0.40, "strong_fraction": 0.20},
        }
        strong = {
            "confidence": 0.70,
            "picture_verification": {"agreement": 0.92, "strong_fraction": 0.80},
        }
        self.assertGreater(cube_backend._mapping_quality(strong), cube_backend._mapping_quality(weak))

    def test_confidence_floors_reach_zero(self):
        floors = cube_backend._confidence_floors(0.83)
        self.assertEqual(floors[-1], 0.0)
        self.assertTrue(all(a >= b for a, b in zip(floors, floors[1:])))


if __name__ == "__main__":
    unittest.main()
