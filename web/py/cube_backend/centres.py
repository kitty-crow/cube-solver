from __future__ import annotations

from typing import Iterable

from .geometry import (
    FACE_INDEX, FACE_NAMES, FACE_NORMAL, _cross, _dot, _mat_vec, _neg,
)

# Centre correction ---------------------------------------------------------
_BASE_CENTRE_180 = "U L R U2 L' R' U L R U2 L' R'"
_BASE_CENTRE_PAIR = "F B' L R' U D' F' U' D L' R F' B U"  # U +90, F -90


def _det3(m: tuple[tuple[int, int, int], ...]) -> int:
    return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    )


def _all_cube_rotations() -> list[tuple[tuple[int, int, int], ...]]:
    result = []
    axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    signed_axes = axes + tuple(_neg(a) for a in axes)
    for x in signed_axes:
        for y in signed_axes:
            if _dot(x, y) != 0:
                continue
            z = _cross(x, y)
            # columns x,y,z
            m = tuple((x[i], y[i], z[i]) for i in range(3))
            if _det3(m) == 1 and m not in result:
                result.append(m)
    return result


CUBE_ROTATIONS = _all_cube_rotations()


def _mapped_face(rot: tuple[tuple[int, int, int], ...], face: int) -> int:
    normal = _mat_vec(rot, FACE_NORMAL[face])
    return FACE_NORMAL.index(normal)


def _rename_algorithm(algorithm: str, rot: tuple[tuple[int, int, int], ...]) -> str:
    # rot maps original faces -> the view in which the base algorithm is described.
    inverse_name: dict[str, str] = {}
    for original in range(6):
        viewed = _mapped_face(rot, original)
        inverse_name[FACE_NAMES[viewed]] = FACE_NAMES[original]
    out = []
    for token in algorithm.split():
        out.append(inverse_name[token[0]] + token[1:])
    return " ".join(out)


def _centre_generators() -> list[tuple[tuple[int, ...], str]]:
    generators: list[tuple[tuple[int, ...], str]] = []
    # Any single centre may be rotated 180 degrees.
    for face in range(6):
        rot = next(r for r in CUBE_ROTATIONS if _mapped_face(r, face) == FACE_INDEX["U"])
        effect = [0] * 6
        effect[face] = 2
        generators.append((tuple(effect), _rename_algorithm(_BASE_CENTRE_180, rot)))

    # Any ordered adjacent pair can receive (+90, -90).
    for a in range(6):
        for b in range(6):
            if a == b or _dot(FACE_NORMAL[a], FACE_NORMAL[b]) != 0:
                continue
            rot = next((r for r in CUBE_ROTATIONS
                        if _mapped_face(r, a) == FACE_INDEX["U"] and _mapped_face(r, b) == FACE_INDEX["F"]), None)
            if rot is None:
                continue
            effect = [0] * 6
            effect[a] = 1
            effect[b] = 3
            generators.append((tuple(effect), _rename_algorithm(_BASE_CENTRE_PAIR, rot)))
    return generators


CENTRE_GENERATORS = _centre_generators()


def _add_orientation(a: tuple[int, ...], b: tuple[int, ...]) -> tuple[int, ...]:
    return tuple((x + y) % 4 for x, y in zip(a, b))


def centre_correction(target: Iterable[int]) -> list[str]:
    target_t = tuple(int(x) % 4 for x in target)
    if target_t == (0, 0, 0, 0, 0, 0):
        return []
    start = (0, 0, 0, 0, 0, 0)
    queue = [start]
    prev: dict[tuple[int, ...], tuple[tuple[int, ...], int] | None] = {start: None}
    head = 0
    while head < len(queue):
        state = queue[head]
        head += 1
        for gi, (effect, _) in enumerate(CENTRE_GENERATORS):
            nxt = _add_orientation(state, effect)
            if nxt in prev:
                continue
            prev[nxt] = (state, gi)
            if nxt == target_t:
                queue = []
                head = 0
                break
            queue.append(nxt)
        if target_t in prev:
            break
    if target_t not in prev:
        # This indicates a physically impossible centre orientation state, normally caused by a bad reconstruction.
        raise ValueError("Reconstructed centre orientations are not reachable on a 3x3 picture cube")
    path = []
    cur = target_t
    while cur != start:
        pstate, gi = prev[cur]  # type: ignore[misc]
        path.append(CENTRE_GENERATORS[gi][1])
        cur = pstate
    path.reverse()
    return path


def _move_quarters(token: str) -> int:
    if token.endswith("2"):
        return 2
    if token.endswith("'"):
        return -1
    return 1


def centres_after_solution(center_need: list[int], solution: str) -> list[int]:
    need = [x % 4 for x in center_need]
    for token in solution.split():
        face = token[0]
        if face not in FACE_INDEX:
            continue
        # Clockwise face turn rotates the physical centre clockwise, reducing the correction still needed.
        need[FACE_INDEX[face]] = (need[FACE_INDEX[face]] - _move_quarters(token)) % 4
    return need
