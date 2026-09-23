import base64
import os
import sys
import unittest
from array import array

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

# Importing the package initialises the wrapped-neighbour routing used by the
# lazy 2x2/4x4 reconstructors.
import cube_backend  # noqa: F401,E402
from cube_backend.surface import face_neighbours  # noqa: E402
from cube_backend.vision import TileBank  # noqa: E402


class WrappedSurfaceTests(unittest.TestCase):
    def test_every_facelet_has_four_surface_neighbours(self):
        for size in (2, 3, 4):
            neighbours = face_neighbours(size)
            self.assertEqual(len(neighbours), 6 * size * size)
            self.assertTrue(all(len(entries) == 4 for entries in neighbours.values()))

    def test_surface_neighbours_are_reciprocal(self):
        for size in (2, 3, 4):
            neighbours = face_neighbours(size)
            for source, entries in neighbours.items():
                for target, source_side, target_side in entries:
                    self.assertIn((source, target_side, source_side), neighbours[target])


class EnsembleEvidenceTests(unittest.TestCase):
    def test_external_evidence_breaks_deterministic_tie(self):
        tile_size = 12
        tile_count = 2
        raw = bytes([96, 128, 160] * (tile_count * tile_size * tile_size))
        baseline = TileBank(raw, tile_size, tile_count)
        base = baseline.compatibility(0, 0, "E", 1, 0, "W")

        states = tile_count * 4
        values = array("f", [0.5] * (4 * states * states))
        side_index = {"N": 0, "E": 1, "S": 2, "W": 3}
        astate = 0
        bstate = 4
        values[side_index["E"] * states * states + astate * states + bstate] = 1.0
        values[side_index["W"] * states * states + bstate * states + astate] = 1.0
        evidence = {
            "version": 1,
            "states": states,
            "seam_f32_b64": base64.b64encode(values.tobytes()).decode("ascii"),
        }
        enriched = TileBank(raw, tile_size, tile_count, evidence=evidence)
        learned = enriched.compatibility(0, 0, "E", 1, 0, "W")
        self.assertAlmostEqual(learned - base, 0.1, places=5)

    def test_invalid_evidence_falls_back_cleanly(self):
        tile_size = 12
        raw = bytes([64, 64, 64] * (2 * tile_size * tile_size))
        a = TileBank(raw, tile_size, 2)
        b = TileBank(raw, tile_size, 2, evidence={"version": 1, "states": 999, "seam_f32_b64": "bad"})
        self.assertEqual(a.compatibility(0, 0, "N", 1, 0, "S"), b.compatibility(0, 0, "N", 1, 0, "S"))


if __name__ == "__main__":
    unittest.main()
