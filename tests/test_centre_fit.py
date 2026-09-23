import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.centre_fit import choose_reachable_rotations  # noqa: E402
from cube_backend.centres import CENTRE_GENERATORS  # noqa: E402


class CentreReachabilityTests(unittest.TestCase):
    def test_generator_group_is_exactly_even_orientation_sum(self):
        start = (0, 0, 0, 0, 0, 0)
        reachable = {start}
        queue = [start]
        head = 0
        while head < len(queue):
            state = queue[head]
            head += 1
            for effect, _ in CENTRE_GENERATORS:
                nxt = tuple((a + b) % 4 for a, b in zip(state, effect))
                if nxt not in reachable:
                    reachable.add(nxt)
                    queue.append(nxt)

        expected = {
            (a, b, c, d, e, f)
            for a in range(4)
            for b in range(4)
            for c in range(4)
            for d in range(4)
            for e in range(4)
            for f in range(4)
            if (a + b + c + d + e + f) % 2 == 0
        }
        self.assertEqual(reachable, expected)

    def test_impossible_local_best_falls_back_to_best_reachable_combination(self):
        scores = [[0.0, 0.0, 0.0, 0.0] for _ in range(6)]
        scores[0] = [0.0, 10.0, 0.0, 0.0]
        rotations, score, adjusted = choose_reachable_rotations(scores, "")

        self.assertEqual(rotations[0], 1)
        self.assertEqual(sum(rotations) % 2, 0)
        self.assertEqual(score, 10.0)
        self.assertTrue(adjusted)

    def test_reachable_local_best_is_preserved(self):
        target = [1, 3, 2, 0, 0, 0]
        scores = []
        for wanted in target:
            face = [0.0] * 4
            face[wanted] = 5.0
            scores.append(face)

        rotations, score, adjusted = choose_reachable_rotations(scores, "")
        self.assertEqual(rotations, target)
        self.assertEqual(score, 30.0)
        self.assertEqual(adjusted, [])


if __name__ == "__main__":
    unittest.main()
