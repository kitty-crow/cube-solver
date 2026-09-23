import base64
import os
import sys
import unittest
from array import array

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend.vision import TileBank, set_visual_evidence  # noqa: E402


class SemanticReferenceEvidenceTests(unittest.TestCase):
    TILE_SIZE = 2
    TILE_COUNT = 24
    STATES = TILE_COUNT * 4

    def raw(self):
        return bytes(self.TILE_COUNT * self.TILE_SIZE * self.TILE_SIZE * 3)

    def evidence(self, fit=0.9):
        values = array("f", [0.5] * (self.STATES * self.TILE_COUNT))
        wanted_state = 3 * 4 + 2
        values[wanted_state * self.TILE_COUNT + 7] = 1.0
        values[wanted_state * self.TILE_COUNT + 8] = 0.0
        return {
            "version": 1,
            "states": self.STATES,
            "reference_evidence": {
                "version": 1,
                "states": self.STATES,
                "targets": self.TILE_COUNT,
                "fit": fit,
                "absolute_f32_b64": base64.b64encode(values.tobytes()).decode("ascii"),
            },
        }

    def tearDown(self):
        set_visual_evidence(None)

    def test_strong_reference_rewards_matching_absolute_destination(self):
        set_visual_evidence(self.evidence(0.9))
        bank = TileBank(self.raw(), self.TILE_SIZE, self.TILE_COUNT)
        self.assertGreater(bank.placement_score(3, 2, 7), 0.0)
        self.assertLess(bank.placement_score(3, 2, 8), 0.0)
        self.assertAlmostEqual(bank.placement_score(3, 2, 9), 0.0, places=7)

    def test_weak_reference_is_ignored(self):
        set_visual_evidence(self.evidence(0.30))
        bank = TileBank(self.raw(), self.TILE_SIZE, self.TILE_COUNT)
        self.assertAlmostEqual(bank.placement_score(3, 2, 7), 0.0, places=7)
        self.assertAlmostEqual(bank.placement_score(3, 2, 8), 0.0, places=7)

    def test_missing_or_wrong_sized_reference_falls_back_cleanly(self):
        set_visual_evidence({
            "version": 1,
            "states": self.STATES,
            "reference_evidence": {
                "version": 1,
                "states": self.STATES,
                "targets": self.TILE_COUNT - 1,
                "fit": 1.0,
                "absolute_f32_b64": "AAAA",
            },
        })
        bank = TileBank(self.raw(), self.TILE_SIZE, self.TILE_COUNT)
        self.assertEqual(bank.placement_score(0, 0, 0), 0.0)


if __name__ == "__main__":
    unittest.main()
