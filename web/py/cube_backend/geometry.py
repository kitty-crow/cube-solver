from __future__ import annotations

import itertools
from dataclasses import dataclass


# Face numbering follows URFDLB throughout.
FACE_NAMES = ("U", "R", "F", "D", "L", "B")
FACE_INDEX = {name: i for i, name in enumerate(FACE_NAMES)}

# World coordinates: x=right, y=up, z=front.
FACE_NORMAL = (
    (0, 1, 0),   # U
    (1, 0, 0),   # R
    (0, 0, 1),   # F
    (0, -1, 0),  # D
    (-1, 0, 0),  # L
    (0, 0, -1),  # B
)
FACE_RIGHT = (
    (1, 0, 0),   # U
    (0, 0, -1),  # R
    (1, 0, 0),   # F
    (1, 0, 0),   # D
    (0, 0, 1),   # L
    (-1, 0, 0),  # B
)
FACE_UP = (
    (0, 0, -1),  # U
    (0, 1, 0),   # R
    (0, 1, 0),   # F
    (0, 0, 1),   # D
    (0, 1, 0),   # L
    (0, 1, 0),   # B
)

# Kociemba facelet positions, zero based in a 54-character URFDLB string.
def _U(x: int) -> int: return x - 1
def _R(x: int) -> int: return 8 + x
def _F(x: int) -> int: return 17 + x
def _D(x: int) -> int: return 26 + x
def _L(x: int) -> int: return 35 + x
def _B(x: int) -> int: return 44 + x

CENTER_FACELET = (4, 13, 22, 31, 40, 49)
CORNER_FACELET = (
    (_U(9), _R(1), _F(3)), (_U(7), _F(1), _L(3)),
    (_U(1), _L(1), _B(3)), (_U(3), _B(1), _R(3)),
    (_D(3), _F(9), _R(7)), (_D(1), _L(9), _F(7)),
    (_D(7), _B(9), _L(7)), (_D(9), _R(9), _B(7)),
)
EDGE_FACELET = (
    (_U(6), _R(2)), (_U(8), _F(2)), (_U(4), _L(2)), (_U(2), _B(2)),
    (_D(6), _R(8)), (_D(2), _F(8)), (_D(4), _L(8)), (_D(8), _B(8)),
    (_F(6), _R(4)), (_F(4), _L(6)), (_B(6), _L(4)), (_B(4), _R(6)),
)
CORNER_HOME = (
    ("U", "R", "F"), ("U", "F", "L"), ("U", "L", "B"), ("U", "B", "R"),
    ("D", "F", "R"), ("D", "L", "F"), ("D", "B", "L"), ("D", "R", "B"),
)
EDGE_HOME = (
    ("U", "R"), ("U", "F"), ("U", "L"), ("U", "B"),
    ("D", "R"), ("D", "F"), ("D", "L"), ("D", "B"),
    ("F", "R"), ("F", "L"), ("B", "L"), ("B", "R"),
)

SIDES = ("N", "E", "S", "W")
OPPOSITE_SIDE = {"N": "S", "S": "N", "E": "W", "W": "E"}


def _face_of_facelet(idx: int) -> int:
    return idx // 9


def _local_of_facelet(idx: int) -> int:
    return idx % 9


def _rc(local_idx: int) -> tuple[int, int]:
    return divmod(local_idx, 3)


def _side_between(a: tuple[int, int], b: tuple[int, int]) -> str:
    dr, dc = b[0] - a[0], b[1] - a[1]
    if (dr, dc) == (-1, 0): return "N"
    if (dr, dc) == (0, 1): return "E"
    if (dr, dc) == (1, 0): return "S"
    if (dr, dc) == (0, -1): return "W"
    raise ValueError(f"Cells are not adjacent: {a}, {b}")


def _cross(a: tuple[int, int, int], b: tuple[int, int, int]) -> tuple[int, int, int]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _neg(a: tuple[int, int, int]) -> tuple[int, int, int]:
    return (-a[0], -a[1], -a[2])


def _mat_vec(m: tuple[tuple[int, int, int], ...], v: tuple[int, int, int]) -> tuple[int, int, int]:
    return (
        _dot(m[0], v),
        _dot(m[1], v),
        _dot(m[2], v),
    )


def _rotation_for_mapping(mapping: dict[int, int]) -> tuple[tuple[int, int, int], ...] | None:
    """Return the unique proper axis rotation satisfying source-face -> target-face."""
    items = list(mapping.items())
    if len(items) < 2:
        return None
    s1, t1 = items[0]
    s2, t2 = items[1]
    a1, a2 = FACE_NORMAL[s1], FACE_NORMAL[s2]
    b1, b2 = FACE_NORMAL[t1], FACE_NORMAL[t2]
    if _dot(a1, a2) != 0 or _dot(b1, b2) != 0:
        return None
    a3, b3 = _cross(a1, a2), _cross(b1, b2)
    # R = B A^T. Rows are dot-products of target basis rows with source basis.
    # With signed axis vectors this stays integral.
    A = (a1, a2, a3)
    B = (b1, b2, b3)
    # Build matrices with vectors as columns, then B * A^T.
    m = tuple(
        tuple(sum(B[k][i] * A[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )
    for sf, tf in mapping.items():
        if _mat_vec(m, FACE_NORMAL[sf]) != FACE_NORMAL[tf]:
            return None
    return m


def _tile_rotation(source_face: int, target_face: int, rot3: tuple[tuple[int, int, int], ...]) -> int:
    """Clockwise quarter-turns needed to draw a current sticker in target-face orientation."""
    mapped_up = _mat_vec(rot3, FACE_UP[source_face])
    up = FACE_UP[target_face]
    right = FACE_RIGHT[target_face]
    if mapped_up == up: return 0
    if mapped_up == right: return 1
    if mapped_up == _neg(up): return 2
    if mapped_up == _neg(right): return 3
    raise ValueError("Sticker up vector did not map into target face basis")


@dataclass(frozen=True)
class Placement:
    tile: int
    rot: int
    target_facelet: int
    target_face: int


@dataclass(frozen=True)
class EdgeCandidate:
    current_pos: int
    home_pos: int
    eo: int
    placements: tuple[Placement, Placement]
    score: float = 0.0


@dataclass(frozen=True)
class CornerCandidate:
    current_pos: int
    home_pos: int
    co: int
    placements: tuple[Placement, Placement, Placement]
    score: float = 0.0



def _edge_candidates_geometry() -> list[list[list[EdgeCandidate]]]:
    all_candidates: list[list[list[EdgeCandidate]]] = [[[] for _ in range(12)] for _ in range(12)]
    for current in range(12):
        current_faces = tuple(_face_of_facelet(i) for i in EDGE_FACELET[current])
        for home in range(12):
            home_faces = tuple(FACE_INDEX[c] for c in EDGE_HOME[home])
            for eo in (0, 1):
                mapped = home_faces if eo == 0 else (home_faces[1], home_faces[0])
                face_map = {current_faces[0]: mapped[0], current_faces[1]: mapped[1]}
                rot3 = _rotation_for_mapping(face_map)
                if rot3 is None:
                    continue
                placements = []
                for j in range(2):
                    tf = mapped[j]
                    target_slot = home_faces.index(tf)
                    target_facelet = EDGE_FACELET[home][target_slot]
                    placements.append(Placement(
                        tile=EDGE_FACELET[current][j],
                        rot=_tile_rotation(current_faces[j], tf, rot3),
                        target_facelet=target_facelet,
                        target_face=tf,
                    ))
                all_candidates[current][home].append(EdgeCandidate(current, home, eo, tuple(placements)))
    return all_candidates


def _corner_candidates_geometry() -> list[list[list[CornerCandidate]]]:
    all_candidates: list[list[list[CornerCandidate]]] = [[[] for _ in range(8)] for _ in range(8)]
    for current in range(8):
        current_faces = tuple(_face_of_facelet(i) for i in CORNER_FACELET[current])
        for home in range(8):
            home_faces = tuple(FACE_INDEX[c] for c in CORNER_HOME[home])
            for perm in itertools.permutations(home_faces):
                face_map = {current_faces[j]: perm[j] for j in range(3)}
                rot3 = _rotation_for_mapping(face_map)
                if rot3 is None:
                    continue
                # _rotation_for_mapping verifies the third face too; reflection permutations are rejected.
                placements = []
                for j in range(3):
                    tf = perm[j]
                    target_slot = home_faces.index(tf)
                    target_facelet = CORNER_FACELET[home][target_slot]
                    placements.append(Placement(
                        tile=CORNER_FACELET[current][j],
                        rot=_tile_rotation(current_faces[j], tf, rot3),
                        target_facelet=target_facelet,
                        target_face=tf,
                    ))
                co = next(j for j, tf in enumerate(perm) if FACE_NAMES[tf] in ("U", "D"))
                cand = CornerCandidate(current, home, co, tuple(placements))
                if all(existing.co != co for existing in all_candidates[current][home]):
                    all_candidates[current][home].append(cand)
    return all_candidates


EDGE_GEOM = _edge_candidates_geometry()
CORNER_GEOM = _corner_candidates_geometry()
