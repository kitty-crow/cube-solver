from __future__ import annotations

from collections import deque
import heapq
import math

from .geometry import CORNER_HOME, FACE_INDEX, FACE_NAMES, FACE_NORMAL
from .generic import candidates_for_piece, face_neighbours, facelet_index, position_to_cell
from .vision import TileBank

SIZE = 2
ANCHOR = 6  # DBL, untouched by U/R/F
ACTIVE = (0, 1, 2, 3, 4, 5, 7)
MOVE_TOKENS = ("U", "U2", "U'", "R", "R2", "R'", "F", "F2", "F'")


def _add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def _mul(a, k):
    return tuple(a[i] * k for i in range(3))


def _corner_coord(index: int):
    out = (0, 0, 0)
    for face_name in CORNER_HOME[index]:
        out = _add(out, _mul(FACE_NORMAL[FACE_INDEX[face_name]], SIZE - 1))
    return out


CORNER_COORDS = tuple(_corner_coord(i) for i in range(8))


def _corner_facelets(index: int) -> tuple[int, int, int]:
    position = CORNER_COORDS[index]
    result = []
    for face_name in CORNER_HOME[index]:
        face = FACE_INDEX[face_name]
        row, col = position_to_cell(face, position, SIZE)
        result.append(facelet_index(face, row, col, SIZE))
    return tuple(result)


CORNER_FACELETS = tuple(_corner_facelets(i) for i in range(8))
CANDIDATES = tuple(
    tuple(candidates_for_piece(CORNER_COORDS[current], CORNER_COORDS[home], SIZE) for home in range(8))
    for current in range(8)
)
NEIGHBOURS = face_neighbours(SIZE)


def _anchor_candidate():
    d_face = FACE_INDEX["D"]
    for candidate in CANDIDATES[ANCHOR][ANCHOR]:
        for placement in candidate.placements:
            if placement.source_facelet // (SIZE * SIZE) == d_face and placement.target_face == d_face:
                return candidate
    raise RuntimeError("Could not establish 2x2 orientation anchor")


ANCHOR_CANDIDATE = _anchor_candidate()


def _incremental_score(bank: TileBank, candidate, occupancy) -> float:
    score = sum(
        bank.placement_score(placement.source_facelet, placement.rot, placement.target_facelet)
        for placement in candidate.placements
    )
    for placement in candidate.placements:
        for neighbour, side, opposite in NEIGHBOURS[placement.target_facelet]:
            other = occupancy.get(neighbour)
            if other is None:
                continue
            other_tile, other_rot = other
            score += bank.compatibility(
                placement.source_facelet, placement.rot, side,
                other_tile, other_rot, opposite,
            )
    return score


def _install(candidate, occupancy):
    out = occupancy.copy()
    for placement in candidate.placements:
        if placement.target_facelet in out:
            raise ValueError("2x2 reconstruction attempted to overlap target stickers")
        out[placement.target_facelet] = (placement.source_facelet, placement.rot)
    return out


def _state_from_path(path) -> str:
    out = ["?"] * 24
    for candidate in path:
        for placement in candidate.placements:
            out[placement.source_facelet] = FACE_NAMES[placement.target_face]
    if "?" in out:
        raise ValueError("Incomplete 2x2 reconstruction")
    return "".join(out)


def parse_corners(state: str) -> tuple[tuple[int, ...], tuple[int, ...]]:
    if len(state) != 24:
        raise ValueError("2x2 state must contain 24 facelets")
    cp = []
    co = []
    for current in range(8):
        labels = tuple(state[i] for i in CORNER_FACELETS[current])
        matches = [i for i, faces in enumerate(CORNER_HOME) if set(labels) == set(faces)]
        if len(matches) != 1:
            raise ValueError(f"Invalid 2x2 corner at slot {current}: {labels}")
        cp.append(matches[0])
        try:
            co.append(next(i for i, label in enumerate(labels) if label in ("U", "D")))
        except StopIteration as exc:
            raise ValueError(f"Corner without U/D sticker at slot {current}") from exc
    if len(set(cp)) != 8 or sum(co) % 3:
        raise ValueError("Illegal 2x2 corner permutation/orientation")
    return tuple(cp), tuple(co)


def reconstruct_2x2(raw: bytes, tile_size: int) -> dict:
    bank = TileBank(raw, tile_size, 24)
    anchor_occupancy = _install(ANCHOR_CANDIDATE, {})
    home_order = (5, 7, 2, 4, 1, 3, 0)
    anchor_score = sum(
        bank.placement_score(p.source_facelet, p.rot, p.target_facelet)
        for p in ANCHOR_CANDIDATE.placements
    )
    beam = [(anchor_score, 1 << ANCHOR, (ANCHOR_CANDIDATE,), anchor_occupancy)]
    beam_width = 6000

    for home in home_order:
        generated = []
        serial = 0
        for score, used, path, occupancy in beam:
            for current in range(8):
                if used & (1 << current):
                    continue
                for candidate in CANDIDATES[current][home]:
                    new_score = score + _incremental_score(bank, candidate, occupancy)
                    new_occupancy = _install(candidate, occupancy)
                    generated.append((new_score, serial, used | (1 << current), path + (candidate,), new_occupancy))
                    serial += 1
        if not generated:
            raise ValueError("Could not assemble 2x2 picture")
        best = heapq.nlargest(beam_width, generated, key=lambda item: item[0])
        beam = [(score, used, path, occupancy) for score, _, used, path, occupancy in best]

    legal = []
    for score, _, path, _ in sorted(beam, key=lambda item: item[0], reverse=True):
        state = _state_from_path(path)
        try:
            cp, co = parse_corners(state)
        except ValueError:
            continue
        if cp[ANCHOR] != ANCHOR or co[ANCHOR] != 0:
            continue
        legal.append((score, state, cp, co, path))
        if len(legal) >= 16:
            break
    if not legal:
        raise ValueError("Could not reconstruct a legal 2x2 state. Retake the scan and try again.")

    chosen = legal[0]
    gap = 0.0 if len(legal) < 2 else max(0.0, chosen[0] - legal[1][0])
    confidence = max(0.05, min(0.99, 0.55 + gap * 12.0 / 24.0))
    return {
        "state": chosen[1],
        "cp": list(chosen[2]),
        "co": list(chosen[3]),
        "score": chosen[0],
        "confidence": confidence,
    }


def _solved_state() -> str:
    return "".join(face * 4 for face in FACE_NAMES)


def _rotate_vector(vector, axis, quarters):
    def dot(a, b):
        return sum(a[i] * b[i] for i in range(3))

    def cross(a, b):
        return (
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        )

    out = vector
    for _ in range(quarters % 4):
        c = cross(axis, out)
        d = dot(axis, out)
        out = tuple(c[i] + axis[i] * d for i in range(3))
    return out


def _apply_facelet_move(state: str, token: str) -> str:
    from .generic import apply_facelet_move
    return apply_facelet_move(state, SIZE, token)


def _move_effects():
    solved = _solved_state()
    effects = {}
    for token in MOVE_TOKENS:
        effects[token] = parse_corners(_apply_facelet_move(solved, token))
    return effects


MOVE_EFFECTS = _move_effects()
IDENTITY_CP = tuple(range(8))
IDENTITY_CO = (0,) * 8


def _apply_cp(cp, move_cp):
    return tuple(cp[move_cp[pos]] for pos in range(8))


def _apply_co(co, move_cp, move_co):
    return tuple((co[move_cp[pos]] + move_co[pos]) % 3 for pos in range(8))


def _build_distances():
    perm_dist = {IDENTITY_CP: 0}
    queue = deque([IDENTITY_CP])
    while queue:
        cp = queue.popleft()
        depth = perm_dist[cp]
        for token in MOVE_TOKENS:
            mcp, _ = MOVE_EFFECTS[token]
            nxt = _apply_cp(cp, mcp)
            if nxt not in perm_dist:
                perm_dist[nxt] = depth + 1
                queue.append(nxt)

    ori_dist = {IDENTITY_CO: 0}
    queue = deque([IDENTITY_CO])
    while queue:
        co = queue.popleft()
        depth = ori_dist[co]
        for token in MOVE_TOKENS:
            mcp, mco = MOVE_EFFECTS[token]
            nxt = _apply_co(co, mcp, mco)
            if nxt not in ori_dist:
                ori_dist[nxt] = depth + 1
                queue.append(nxt)
    return perm_dist, ori_dist


_DISTANCES = None


def _distances():
    global _DISTANCES
    if _DISTANCES is None:
        _DISTANCES = _build_distances()
    return _DISTANCES


def solve_2x2(cp: tuple[int, ...], co: tuple[int, ...]) -> list[str]:
    if cp[ANCHOR] != ANCHOR or co[ANCHOR] != 0:
        raise ValueError("2x2 orientation anchor is not fixed")
    perm_dist, ori_dist = _distances()
    if cp not in perm_dist or co not in ori_dist:
        raise ValueError("2x2 state is outside the anchored pocket-cube group")
    if cp == IDENTITY_CP and co == IDENTITY_CO:
        return []

    def heuristic(a, b):
        return max(perm_dist.get(a, 99), ori_dist.get(b, 99))

    path = []
    faces = {token: token[0] for token in MOVE_TOKENS}

    def search(a, b, remaining, previous_face, seen):
        h = heuristic(a, b)
        if h > remaining:
            return False
        if remaining == 0:
            return a == IDENTITY_CP and b == IDENTITY_CO
        key = (a, b)
        if seen.get(key, -1) >= remaining:
            return False
        seen[key] = remaining
        for token in MOVE_TOKENS:
            face = faces[token]
            if face == previous_face:
                continue
            mcp, mco = MOVE_EFFECTS[token]
            na = _apply_cp(a, mcp)
            nb = _apply_co(b, mcp, mco)
            path.append(token)
            if search(na, nb, remaining - 1, face, seen):
                return True
            path.pop()
        return False

    bound = heuristic(cp, co)
    while bound <= 14:
        if search(cp, co, bound, None, {}):
            return list(path)
        bound += 1
    raise RuntimeError("2x2 solver exceeded search bound")


def solve_scan_2x2(raw: bytes, tile_size: int) -> dict:
    reconstruction = reconstruct_2x2(raw, tile_size)
    cp = tuple(reconstruction["cp"])
    co = tuple(reconstruction["co"])
    moves = solve_2x2(cp, co)
    return {
        **reconstruction,
        "moves": moves,
        "solution": " ".join(moves),
        "move_count": len(moves),
        "cubie_move_count": len(moves),
        "centre_move_count": 0,
    }
