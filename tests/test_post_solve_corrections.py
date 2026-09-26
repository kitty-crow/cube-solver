import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.centres import centre_correction, centres_after_solution  # noqa: E402
from cube_backend.manual_variants import (  # noqa: E402
    _choose_reachable_centre_corrections,
    _post_solve_tweak_result,
)


SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


class PostSolveCorrectionTests(unittest.TestCase):
    def test_single_authoritative_quarter_turn_is_preserved_and_compensated(self):
        requested = [0, 0, 1, 0, 0, 0]  # F centre needs +90° correction.
        chosen, tokens, inferred = _choose_reachable_centre_corrections(
            requested, {2}, []
        )

        self.assertEqual(chosen[2], 1)
        self.assertTrue(inferred)
        self.assertNotEqual(chosen, requested)
        remaining = centres_after_solution(chosen, "")
        # Must be a centre state the legal correction machinery can actually reach.
        centre_correction(remaining)
        self.assertTrue(tokens)

    def test_post_solve_moves_go_from_real_cube_to_fixed_reference(self):
        payload = {
            "post_solve_tweak": {
                "manual": {
                    "state": SOLVED,
                    "exact": True,
                    "legal_state_count": 1,
                },
                "center_rotations": [0, 0, 1, 0, 0, 0],
                "locked_center_faces": [2],
                "authoritative": True,
            }
        }
        result = _post_solve_tweak_result(payload)

        self.assertEqual(result["from_state"], "corrected observed real cube")
        self.assertEqual(result["to_state"], "fixed wrapped reference")
        self.assertFalse(result["reference_modified"])
        self.assertTrue(result["authoritative_observation_preserved"])
        self.assertEqual(result["requested_center_rotations"][2], 1)
        self.assertEqual(result["center_rotations"][2], 1)
        self.assertTrue(result["inferred_center_faces"])
        self.assertTrue(result["moves"])

    def test_no_correction_needs_no_moves(self):
        payload = {
            "post_solve_tweak": {
                "manual": {
                    "state": SOLVED,
                    "exact": True,
                    "legal_state_count": 1,
                },
                "center_rotations": [0, 0, 0, 0, 0, 0],
                "locked_center_faces": [],
            }
        }
        result = _post_solve_tweak_result(payload)
        self.assertEqual(result["moves"], [])
        self.assertEqual(result["inferred_center_faces"], [])


if __name__ == "__main__":
    unittest.main()
