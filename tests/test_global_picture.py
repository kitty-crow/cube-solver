import base64
import os
import sys
import unittest
from array import array

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.geometry import EDGE_GEOM, EdgeCandidate  # noqa: E402
from cube_backend.reconstruct import _best_edges  # noqa: E402
from cube_backend.vision import TileBank  # noqa: E402


def encoded_f32(values):
    data = array("f", values)
    if sys.byteorder != "little":
        data.byteswap()
    return base64.b64encode(data.tobytes()).decode("ascii")


def reference_evidence(rows, fit=0.95):
    flat = [value for row in rows for value in row]
    return {
        "reference_evidence": {
            "version": 1,
            "states": len(rows),
            "targets": len(rows[0]),
            "absolute_f32_b64": encoded_f32(flat),
            "fit": fit,
        }
    }


class ReferenceCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.tile_size = 8
        self.tile_count = 2
        self.raw = bytes([120] * self.tile_count * self.tile_size * self.tile_size * 3)

    def test_uniform_high_similarity_is_not_treated_as_position_evidence(self):
        rows = [[0.98, 0.98] for _ in range(self.tile_count * 4)]
        bank = TileBank(
            self.raw,
            self.tile_size,
            tile_count=self.tile_count,
            evidence=reference_evidence(rows),
        )
        self.assertAlmostEqual(bank.placement_score(0, 0, 0), 0.0, places=7)
        self.assertAlmostEqual(bank.placement_score(0, 0, 1), 0.0, places=7)

    def test_distinct_reference_position_gets_positive_and_negative_evidence(self):
        rows = [[0.50, 0.50] for _ in range(self.tile_count * 4)]
        rows[0] = [0.96, 0.48]
        bank = TileBank(
            self.raw,
            self.tile_size,
            tile_count=self.tile_count,
            evidence=reference_evidence(rows),
        )
        self.assertGreater(bank.placement_score(0, 0, 0), 0.0)
        self.assertLess(bank.placement_score(0, 0, 1), 0.0)
        self.assertGreater(bank.placement_percentile(0, 0, 0), bank.placement_percentile(0, 0, 1))


class GlobalHypothesisTests(unittest.TestCase):
    def test_edge_dp_keeps_multiple_legal_hypotheses(self):
        scored = [[[] for _ in range(12)] for _ in range(12)]
        for current in range(12):
            for home in range(12):
                scored[current][home] = [
                    EdgeCandidate(
                        candidate.current_pos,
                        candidate.home_pos,
                        candidate.eo,
                        candidate.placements,
                        0.0,
                    )
                    for candidate in EDGE_GEOM[current][home]
                ]
        result = _best_edges(scored, keep=3)
        self.assertEqual(len(result[0]), 3)
        self.assertEqual(len(result[1]), 3)
        for parity, values in result.items():
            for _, path in values:
                self.assertEqual(len(path), 12)
                self.assertEqual(sum(candidate.eo for candidate in path) % 2, 0)
                self.assertIn(parity, (0, 1))


if __name__ == "__main__":
    unittest.main()
