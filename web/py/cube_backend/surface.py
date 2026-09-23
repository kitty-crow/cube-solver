from __future__ import annotations

from functools import lru_cache

from .geometry import FACE_NORMAL, FACE_RIGHT, FACE_UP
from .generic import NORMAL_TO_FACE, facelet_index, facelet_position, position_to_cell

SIDES = ("N", "E", "S", "W")
OPPOSITE = {"N": "S", "E": "W", "S": "N", "W": "E"}


def _neg(v):
    return tuple(-x for x in v)


def _side_vector(face: int, side: str):
    if side == "N":
        return FACE_UP[face]
    if side == "E":
        return FACE_RIGHT[face]
    if side == "S":
        return _neg(FACE_UP[face])
    if side == "W":
        return _neg(FACE_RIGHT[face])
    raise ValueError(side)


def _side_for_outward(face: int, vector) -> str:
    for side in SIDES:
        if _side_vector(face, side) == vector:
            return side
    raise ValueError(f"Vector {vector} is not tangent to face {face}")


@lru_cache(maxsize=None)
def face_neighbours(size: int) -> dict[int, tuple[tuple[int, str, str], ...]]:
    """Four neighbours of every sticker on the unfolded physical cube surface.

    Interior adjacency remains on one face. At a face boundary the missing
    neighbour is the sticker touching it across the physical cube edge. Face
    corners therefore have two same-face and two cross-face neighbours.
    """
    out: dict[int, list[tuple[int, str, str]]] = {i: [] for i in range(6 * size * size)}
    for face in range(6):
        for row in range(size):
            for col in range(size):
                idx = facelet_index(face, row, col, size)
                position = facelet_position(face, row, col, size)
                boundaries = {
                    "N": row == 0,
                    "E": col == size - 1,
                    "S": row == size - 1,
                    "W": col == 0,
                }
                same_face = {
                    "N": (row - 1, col),
                    "E": (row, col + 1),
                    "S": (row + 1, col),
                    "W": (row, col - 1),
                }
                for side in SIDES:
                    if not boundaries[side]:
                        nr, nc = same_face[side]
                        out[idx].append((facelet_index(face, nr, nc, size), side, OPPOSITE[side]))
                        continue

                    adjacent_face = NORMAL_TO_FACE[_side_vector(face, side)]
                    nr, nc = position_to_cell(adjacent_face, position, size)
                    neighbour = facelet_index(adjacent_face, nr, nc, size)
                    adjacent_side = _side_for_outward(adjacent_face, FACE_NORMAL[face])
                    out[idx].append((neighbour, side, adjacent_side))

    return {key: tuple(value) for key, value in out.items()}
