import os
import sys
import types
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.centres import centre_correction, centres_after_solution  # noqa: E402
from cube_backend.manual_variants import (  # noqa: E402
    _choose_reachable_centre_corrections,
    _post_solve_tweak_result,
)


SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


class _FakeCube:
    @classmethod
    def from_string(cls, state):
        instance = cls()
        instance.state = state
        return instance

    def verify(self):
        return True


def _fake_rubik_solver(moves=None):
    return types.SimpleNamespace(
        Cube=_FakeCube,
        solve=lambda _cube: [] if moves is None else list(moves),
    )


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
        with patch.dict(sys.modules, {"rubik_solver": _fake_rubik_solver()}):
            result = _post_solve_tweak_result(payload)

        self.assertEqual(result["from_state"], "corrected observed real cube")
        self.assertEqual(result["to_state"], "fixed wrapped reference")
        self.assertFalse(result["reference_modified"])
        self.assertTrue(result["authoritative_observation_preserved"])
        self.assertEqual(result["requested_center_rotations"][2], 1)
        self.assertEqual(result["center_rotations"][2], 1)
        self.assertTrue(result["inferred_center_faces"])
        self.assertTrue(result["moves"])

    def test_backend_does_not_invert_cubie_correction_path(self):
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
        with patch.dict(sys.modules, {"rubik_solver": _fake_rubik_solver(["R", "U'"])}):
            result = _post_solve_tweak_result(payload)

        self.assertEqual(result["cubie_moves"], ["R", "U'"])
        self.assertEqual(result["moves"][:2], ["R", "U'"])
        self.assertEqual(result["from_state"], "corrected observed real cube")
        self.assertEqual(result["to_state"], "fixed wrapped reference")

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
        with patch.dict(sys.modules, {"rubik_solver": _fake_rubik_solver()}):
            result = _post_solve_tweak_result(payload)
        self.assertEqual(result["moves"], [])
        self.assertEqual(result["inferred_center_faces"], [])


if __name__ == "__main__":
    unittest.main()
