import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend import bigcube
from cube_backend.geometry import CORNER_HOME, FACE_INDEX, FACE_NAMES
from cube_backend.generic import (
    apply_facelet_move,
    facelet_index,
    legal_candidates_for_piece,
    position_to_cell,
)
from cube_backend.pocket import solve_2x2


def apply_alg(state, size, moves):
    for move in moves:
        state = apply_facelet_move(state, size, move)
    return state


def parse_4x4_corners(state):
    cp = []
    co = []
    for current_index, position in enumerate(bigcube.CORNER_COORDS):
        labels = []
        for face_name in CORNER_HOME[current_index]:
            face = FACE_INDEX[face_name]
            row, col = position_to_cell(face, position, 4)
            labels.append(state[facelet_index(face, row, col, 4)])
        matches = [i for i, faces in enumerate(CORNER_HOME) if set(labels) == set(faces)]
        if len(matches) != 1:
            raise AssertionError((current_index, labels))
        cp.append(matches[0])
        co.append(next(i for i, label in enumerate(labels) if label in ("U", "D")))
    return tuple(cp), tuple(co)


class GenericOrientationTests(unittest.TestCase):
    def test_4x4_piece_orientation_counts(self):
        centre = bigcube.CENTRES[0]
        wing = bigcube.WINGS[0]
        corner = bigcube.CORNERS[0]
        self.assertEqual(len(legal_candidates_for_piece(centre, centre, 4)), 1)
        self.assertEqual(len(legal_candidates_for_piece(wing, wing, 4)), 1)
        self.assertEqual(len(legal_candidates_for_piece(corner, corner, 4)), 3)

    def test_piece_class_commutators_are_pure(self):
        identity = {position: position for position in bigcube.POSITIONS}

        wing_state = bigcube._apply_mapping_moves(identity, bigcube.WING_BASE)
        self.assertEqual(sum(wing_state[p] != p for p in bigcube.WINGS), 3)
        self.assertTrue(all(wing_state[p] == p for p in bigcube.CENTRES))
        self.assertTrue(all(wing_state[p] == p for p in bigcube.CORNERS))

        centre_state = bigcube._apply_mapping_moves(identity, bigcube.CENTRE_BASE)
        self.assertEqual(sum(centre_state[p] != p for p in bigcube.CENTRES), 3)
        self.assertTrue(all(centre_state[p] == p for p in bigcube.WINGS))
        self.assertTrue(all(centre_state[p] == p for p in bigcube.CORNERS))

    def test_wing_parity_toggles_only_wing_parity_and_leaves_corners(self):
        identity = {position: position for position in bigcube.POSITIONS}
        state = bigcube._apply_mapping_moves(identity, bigcube.WING_PARITY)
        self.assertEqual(bigcube._permutation_parity(state, bigcube.WINGS), 1)
        self.assertEqual(bigcube._permutation_parity(state, bigcube.CENTRES), 0)
        self.assertTrue(all(state[p] == p for p in bigcube.CORNERS))


class FourByFourSolverTests(unittest.TestCase):
    def _solve_scramble(self, scramble):
        solved_colours = "".join(face * 16 for face in FACE_NAMES)
        colour_state = apply_alg(solved_colours, 4, scramble)
        cp, co = parse_4x4_corners(colour_state)
        self.assertEqual(cp[6], 6, "test scramble must preserve the DBL anchor")
        self.assertEqual(co[6], 0, "test scramble must preserve the DBL anchor orientation")

        mapping = {position: position for position in bigcube.POSITIONS}
        mapping = bigcube._apply_mapping_moves(mapping, scramble)
        reconstruction = {
            "state": colour_state,
            "cp": list(cp),
            "co": list(co),
            "mapping": [[list(position), list(mapping[position])] for position in bigcube.POSITIONS],
            "score": 0.0,
            "confidence": 1.0,
        }
        result = bigcube.solve_reconstruction_4x4(reconstruction)

        exact_solved = "".join(chr(0x100 + i) for i in range(96))
        exact_scrambled = apply_alg(exact_solved, 4, scramble)
        exact_finished = apply_alg(exact_scrambled, 4, result["moves"])
        self.assertEqual(exact_finished, exact_solved)
        self.assertGreaterEqual(result["move_count"], 0)

    def test_exact_picture_solve_with_wide_moves(self):
        self._solve_scramble(("Rw", "U", "Fw", "R'", "Uw2", "F", "Rw'", "U2", "Fw'", "R2"))

    def test_exact_picture_solve_with_wing_parity(self):
        # A single inner-slice component gives the wing permutation odd parity;
        # the full solver must repair it without losing the exact centre picture.
        self._solve_scramble(("Rw", "R'", "U", "F", "Rw", "U'", "F2", "Uw", "R2"))


class PocketSolverTests(unittest.TestCase):
    def test_solved_2x2_needs_no_moves(self):
        self.assertEqual(solve_2x2(tuple(range(8)), (0,) * 8), [])


if __name__ == "__main__":
    unittest.main()
