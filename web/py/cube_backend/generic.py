from __future__ import annotations

import itertools
from dataclasses import dataclass

from .geometry import FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP, OPPOSITE_SIDE

Vector = tuple[int, int, int]
Matrix = tuple[Vector, Vector, Vector]


def _dot(a: Vector, b: Vector) -> int:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vector, b: Vector) -> Vector:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _add(a: Vector, b: Vector) -> Vector:
    return a[0] + b[0], a[1] + b[1], a[2] + b[2]


def _mul(a: Vector, k: int) -> Vector:
    return a[0] * k, a[1] * k, a[2] * k


def mat_vec(m: Matrix, v: Vector) -> Vector:
    return _dot(m[0], v), _dot(m[1], v), _dot(m[2], v)


def _det(m: Matrix) -> int:
    return _dot(m[0], _cross(m[1], m[2]))


def cube_rotations() -> tuple[Matrix, ...]:
    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1, 1), repeat=3):
            rows = []
            for i in range(3):
                row = [0, 0, 0]
                row[perm[i]] = signs[i]
                rows.append(tuple(row))
            matrix = tuple(rows)
            if _det(matrix) == 1:
                out.append(matrix)
    return tuple(out)


ROTATIONS = cube_rotations()
NORMAL_TO_FACE = {normal: i for i, normal in enumerate(FACE_NORMAL)}
SIDES = ("N", "E", "S", "W")


def facelet_position(face: int, row: int, col: int, size: int) -> Vector:
    limit = size - 1
    colv = -limit + 2 * col
    rowv = limit - 2 * row
    return _add(
        _mul(FACE_NORMAL[face], limit),
        _add(_mul(FACE_RIGHT[face], colv), _mul(FACE_UP[face], rowv)),
    )


def position_to_cell(face: int, position: Vector, size: int) -> tuple[int, int]:
    limit = size - 1
    col = (_dot(position, FACE_RIGHT[face]) + limit) // 2
    row = (limit - _dot(position, FACE_UP[face])) // 2
    return int(row), int(col)


def facelet_index(face: int, row: int, col: int, size: int) -> int:
    return face * size * size + row * size + col


def facelet_parts(index: int, size: int) -> tuple[int, int, int]:
    face_area = size * size
    face, local = divmod(index, face_area)
    row, col = divmod(local, size)
    return face, row, col


def boundary_count(position: Vector, size: int) -> int:
    limit = size - 1
    return sum(abs(v) == limit for v in position)


def pieces(size: int) -> dict[Vector, tuple[int, ...]]:
    out: dict[Vector, list[int]] = {}
    for face in range(6):
        for row in range(size):
            for col in range(size):
                idx = facelet_index(face, row, col, size)
                pos = facelet_position(face, row, col, size)
                out.setdefault(pos, []).append(idx)
    return {key: tuple(value) for key, value in out.items()}


def tile_rotation(source_face: int, target_face: int, matrix: Matrix) -> int:
    mapped_up = mat_vec(matrix, FACE_UP[source_face])
    up = FACE_UP[target_face]
    right = FACE_RIGHT[target_face]
    neg_up = tuple(-x for x in up)
    neg_right = tuple(-x for x in right)
    if mapped_up == up:
        return 0
    if mapped_up == right:
        return 1
    if mapped_up == neg_up:
        return 2
    if mapped_up == neg_right:
        return 3
    raise ValueError("Mapped sticker orientation is not in target face basis")


@dataclass(frozen=True)
class GenericPlacement:
    source_facelet: int
    target_facelet: int
    target_face: int
    rot: int


@dataclass(frozen=True)
class GenericCandidate:
    current_position: Vector
    home_position: Vector
    placements: tuple[GenericPlacement, ...]


def candidates_for_piece(current_position: Vector, home_position: Vector, size: int) -> tuple[GenericCandidate, ...]:
    current_piece = pieces(size)[current_position]
    seen = set()
    out = []
    for matrix in ROTATIONS:
        if mat_vec(matrix, current_position) != home_position:
            continue
        placements = []
        for source_facelet in current_piece:
            source_face, _, _ = facelet_parts(source_facelet, size)
            target_normal = mat_vec(matrix, FACE_NORMAL[source_face])
            target_face = NORMAL_TO_FACE[target_normal]
            row, col = position_to_cell(target_face, home_position, size)
            target_facelet = facelet_index(target_face, row, col, size)
            placements.append(GenericPlacement(
                source_facelet=source_facelet,
                target_facelet=target_facelet,
                target_face=target_face,
                rot=tile_rotation(source_face, target_face, matrix),
            ))
        placements.sort(key=lambda p: p.source_facelet)
        key = tuple((p.source_facelet, p.target_facelet, p.target_face, p.rot) for p in placements)
        if key in seen:
            continue
        seen.add(key)
        out.append(GenericCandidate(current_position, home_position, tuple(placements)))
    return tuple(out)


def face_neighbours(size: int) -> dict[int, tuple[tuple[int, str, str], ...]]:
    out: dict[int, list[tuple[int, str, str]]] = {i: [] for i in range(6 * size * size)}
    for face in range(6):
        for row in range(size):
            for col in range(size):
                idx = facelet_index(face, row, col, size)
                if row > 0:
                    out[idx].append((facelet_index(face, row - 1, col, size), "N", "S"))
                if col + 1 < size:
                    out[idx].append((facelet_index(face, row, col + 1, size), "E", "W"))
                if row + 1 < size:
                    out[idx].append((facelet_index(face, row + 1, col, size), "S", "N"))
                if col > 0:
                    out[idx].append((facelet_index(face, row, col - 1, size), "W", "E"))
    return {key: tuple(value) for key, value in out.items()}


def rotate_vector(vector: Vector, axis: Vector, quarters: int) -> Vector:
    out = vector
    for _ in range(quarters % 4):
        out = _add(_cross(axis, out), _mul(axis, _dot(axis, out)))
    return out


def apply_facelet_move(state: str, size: int, token: str) -> str:
    face = FACE_INDEX[token[0]]
    amount = 2 if token.endswith("2") else (-1 if token.endswith("'") else 1)
    quarters = (-amount) % 4
    axis = FACE_NORMAL[face]
    limit = size - 1
    out = ["?"] * len(state)
    for idx, value in enumerate(state):
        source_face, row, col = facelet_parts(idx, size)
        position = facelet_position(source_face, row, col, size)
        normal = FACE_NORMAL[source_face]
        if _dot(position, axis) == limit:
            position = rotate_vector(position, axis, quarters)
            normal = rotate_vector(normal, axis, quarters)
        target_face = NORMAL_TO_FACE[normal]
        target_row, target_col = position_to_cell(target_face, position, size)
        out[facelet_index(target_face, target_row, target_col, size)] = value
    if "?" in out:
        raise ValueError("Move geometry produced incomplete facelet state")
    return "".join(out)
