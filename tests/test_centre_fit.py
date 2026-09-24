import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.backend import (  # noqa: E402
    _manual_reconstruction_for_centre_fit,
    _manual_result_metadata,
    _nearest_reachable_center_rotations,
)
from cube_backend.centre_fit import choose_reachable_rotations  # noqa: E402
from cube_backend.centres import CENTRE_GENERATORS, centre_correction, centres_after_solution  # noqa: E402
from cube_backend.geometry import EDGE_GEOM  # noqa: E402


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

    def test_manual_impossible_centre_guess_is_projected_not_rejected(self):
        preferred = [1, 0, 0, 0, 0, 0]
        chosen = _nearest_reachable_center_rotations(preferred, "")
        remaining = centres_after_solution(chosen, "")

        self.assertEqual(sum(remaining) % 2, 0)
        # This is the exact operation that previously threw on the user's
        # otherwise legal, high-confidence identified scramble.
        centre_correction(remaining)
        self.assertLessEqual(
            sum(min((a - b) % 4, (b - a) % 4) for a, b in zip(chosen, preferred)),
            1,
        )

    def test_manual_edge_placements_recover_centre_fit_geometry(self):
        placements = {}
        for current in range(12):
            candidate = next(c for c in EDGE_GEOM[current][current] if int(c.eo) == 0)
            for placement in candidate.placements:
                placements[str(placement.tile)] = {
                    "target": int(placement.target_facelet),
                    "rotation": int(placement.rot),
                }

        reconstruction = _manual_reconstruction_for_centre_fit({
            "state": "".join(face * 9 for face in "URFDLB"),
            "placements": placements,
        })
        self.assertIsNotNone(reconstruction)
        self.assertEqual(len(reconstruction["edges"]), 12)
        self.assertTrue(all(item["current"] == item["home"] for item in reconstruction["edges"]))
        self.assertTrue(all(item["orientation"] == 0 for item in reconstruction["edges"]))

    def test_probable_manual_confidence_is_not_promoted_to_unique(self):
        metadata = _manual_result_metadata({
            "exact": False,
            "resolution_kind": "probable",
            "confidence": 0.94,
            "legal_state_count": 37,
            "confirmed": {"1": {"target": 10, "rotation": 0}},
            "ambiguous": {"3": {"target": 12, "rotation": 1}},
        })
        self.assertFalse(metadata["exact"])
        self.assertAlmostEqual(metadata["confidence"], 0.94)
        self.assertEqual(metadata["legal_state_count"], 37)
        self.assertEqual(metadata["resolution_kind"], "probable")
        self.assertEqual(metadata["confirmed_count"], 1)
        self.assertEqual(metadata["ambiguous_count"], 1)


if __name__ == "__main__":
    unittest.main()
