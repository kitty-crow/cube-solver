import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.centres import CENTRE_GENERATORS, centre_correction, simplify_moves  # noqa: E402


class MoveQualityTests(unittest.TestCase):
    def test_simplify_collapses_adjacent_face_turns(self):
        self.assertEqual(simplify_moves("R R R' U U2 U' F2 F2"), ["R", "U2"])

    def test_centre_correction_uses_reachable_generators(self):
        target = (1, 0, 3, 0, 0, 0)
        algorithms = centre_correction(target)
        state = [0] * 6
        by_algorithm = {algorithm: effect for effect, algorithm in CENTRE_GENERATORS}
        for algorithm in algorithms:
            effect = by_algorithm[algorithm]
            state = [(a + b) % 4 for a, b in zip(state, effect)]
        self.assertEqual(tuple(state), target)
        self.assertLessEqual(sum(len(algorithm.split()) for algorithm in algorithms), 28)


if __name__ == "__main__":
    unittest.main()
