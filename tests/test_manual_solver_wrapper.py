import unittest

import cube_backend


class ManualSolverWrapperTests(unittest.TestCase):
    def test_wrapper_preserves_three_argument_backend_contract_and_probability(self):
        original = cube_backend._original_manual_solver
        seen = {}

        def fake_solver(raw, tile_size, manual):
            seen["raw"] = raw
            seen["tile_size"] = tile_size
            seen["manual"] = manual
            return {"confidence": 0.0, "selection_reason": "backend"}

        manual = {
            "resolution_kind": "probable",
            "confidence": 0.94,
            "legal_state_count": 2,
            "ambiguous": {"7": [1, 2, 3]},
        }
        try:
            cube_backend._original_manual_solver = fake_solver
            result = cube_backend._solve_manual_with_reported_confidence(b"rgb", 31, manual)
        finally:
            cube_backend._original_manual_solver = original

        self.assertEqual(seen, {"raw": b"rgb", "tile_size": 31, "manual": manual})
        self.assertFalse(result["manual_identification_exact"])
        self.assertEqual(result["manual_identification_resolution_kind"], "probable")
        self.assertAlmostEqual(result["confidence"], 0.94)
        self.assertEqual(result["legal_state_count"], 2)
        self.assertEqual(result["manual_ambiguous_stickers"], 1)

    def test_unique_result_is_reported_as_exact(self):
        original = cube_backend._original_manual_solver
        try:
            cube_backend._original_manual_solver = lambda raw, tile_size, manual: {}
            result = cube_backend._solve_manual_with_reported_confidence(
                b"rgb", 31, {"resolution_kind": "unique", "confidence": 0.71}
            )
        finally:
            cube_backend._original_manual_solver = original

        self.assertTrue(result["manual_identification_exact"])
        self.assertEqual(result["confidence"], 1.0)


if __name__ == "__main__":
    unittest.main()
