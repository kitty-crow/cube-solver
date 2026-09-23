from __future__ import annotations

import math
from typing import Iterable

from .geometry import (
    CENTER_FACELET, CORNER_FACELET, CORNER_GEOM, EDGE_FACELET, EDGE_GEOM,
    OPPOSITE_SIDE, CornerCandidate, EdgeCandidate, _local_of_facelet, _rc,
    _side_between, FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP,
    CORNER_HOME, EDGE_HOME,
)
from .vision import TileBank


def _neg(v):
    return tuple(-x for x in v)


def _side_toward(face: int, other_face: int) -> str:
    target = FACE_NORMAL[other_face]
    if target == FACE_UP[face]:
        return "N"
    if target == FACE_RIGHT[face]:
        return "E"
    if target == _neg(FACE_UP[face]):
        return "S"
    if target == _neg(FACE_RIGHT[face]):
        return "W"
    raise ValueError(f"Faces {FACE_NAMES[face]} and {FACE_NAMES[other_face]} are not adjacent")


def _cross_face_score(bank: TileBank, placements) -> float:
    """Continuity between stickers belonging to one physical cubie.

    A picture cube can carry artwork continuously around a cube edge. Edges
    have one such seam and corners have three. This evidence is deliberately
    weighted below same-face seams so independent-face artwork remains valid.
    """
    total = 0.0
    count = 0
    for i, a in enumerate(placements):
        for b in placements[i + 1:]:
            try:
                aside = _side_toward(a.target_face, b.target_face)
                bside = _side_toward(b.target_face, a.target_face)
            except ValueError:
                continue
            total += bank.compatibility(a.tile, a.rot, aside, b.tile, b.rot, bside)
            count += 1
    return 0.35 * total if count else 0.0


def _edge_score(bank: TileBank, candidate: EdgeCandidate, center_rots: tuple[int, ...]) -> float:
    score = 0.0
    for p in candidate.placements:
        r, c = _rc(_local_of_facelet(p.target_facelet))
        tile_cell = (r, c)
        centre_cell = (1, 1)
        side = _side_between(tile_cell, centre_cell)
        centre_tile = CENTER_FACELET[p.target_face]
        score += bank.compatibility(p.tile, p.rot, side, centre_tile, center_rots[p.target_face], OPPOSITE_SIDE[side])
    return score + _cross_face_score(bank, candidate.placements)


def _score_edge_matrix(bank: TileBank, center_rots: tuple[int, ...]) -> list[list[list[EdgeCandidate]]]:
    out: list[list[list[EdgeCandidate]]] = [[[] for _ in range(12)] for _ in range(12)]
    for p in range(12):
        for q in range(12):
            out[p][q] = [
                EdgeCandidate(c.current_pos, c.home_pos, c.eo, c.placements, _edge_score(bank, c, center_rots))
                for c in EDGE_GEOM[p][q]
            ]
    return out


def _inversion_increment(mask: int, q: int, n: int) -> int:
    greater_mask = mask & ~((1 << (q + 1)) - 1) & ((1 << n) - 1)
    return greater_mask.bit_count() & 1


def _best_edges(scored: list[list[list[EdgeCandidate]]]) -> dict[int, tuple[float, tuple[EdgeCandidate, ...]]]:
    dp: dict[tuple[int, int, int], tuple[float, tuple[EdgeCandidate, ...]]] = {(0, 0, 0): (0.0, ())}
    for p in range(12):
        nxt: dict[tuple[int, int, int], tuple[float, tuple[EdgeCandidate, ...]]] = {}
        for (mask, flip, parity), (score, path) in dp.items():
            for q in range(12):
                if mask & (1 << q):
                    continue
                inv = _inversion_increment(mask, q, 12)
                for cand in scored[p][q]:
                    key = (mask | (1 << q), flip ^ cand.eo, parity ^ inv)
                    value = (score + cand.score, path + (cand,))
                    old = nxt.get(key)
                    if old is None or value[0] > old[0]:
                        nxt[key] = value
        dp = nxt
    full = (1 << 12) - 1
    result = {}
    for parity in (0, 1):
        value = dp.get((full, 0, parity))
        if value is not None:
            result[parity] = value
    return result


def _score_edge_matrix_rotation_invariant(bank: TileBank) -> list[list[list[EdgeCandidate]]]:
    """Initial edge scores with each centre allowed its best local quarter-turn."""
    out: list[list[list[EdgeCandidate]]] = [[[] for _ in range(12)] for _ in range(12)]
    for p in range(12):
        for q in range(12):
            scored = []
            for cand in EDGE_GEOM[p][q]:
                score = _cross_face_score(bank, cand.placements)
                for placement in cand.placements:
                    r, c = _rc(_local_of_facelet(placement.target_facelet))
                    side = _side_between((r, c), (1, 1))
                    centre_tile = CENTER_FACELET[placement.target_face]
                    score += max(
                        bank.compatibility(
                            placement.tile, placement.rot, side,
                            centre_tile, k, OPPOSITE_SIDE[side],
                        )
                        for k in range(4)
                    )
                scored.append(EdgeCandidate(cand.current_pos, cand.home_pos, cand.eo, cand.placements, score))
            out[p][q] = scored
    return out


def _refine_center_rots(bank: TileBank, assignment: tuple[EdgeCandidate, ...], rots: tuple[int, ...]) -> tuple[int, ...]:
    out = list(rots)
    for face in range(6):
        touching = [c for c in assignment if any(p.target_face == face for p in c.placements)]
        scores = []
        for k in range(4):
            total = 0.0
            for cand in touching:
                for p in cand.placements:
                    if p.target_face != face:
                        continue
                    r, c = _rc(_local_of_facelet(p.target_facelet))
                    side = _side_between((r, c), (1, 1))
                    total += bank.compatibility(p.tile, p.rot, side, CENTER_FACELET[face], k, OPPOSITE_SIDE[side])
            scores.append(total)
        out[face] = max(range(4), key=scores.__getitem__)
    return tuple(out)


def _placed_edges(assignment: tuple[EdgeCandidate, ...]) -> dict[tuple[int, int, int], tuple[int, int]]:
    placed: dict[tuple[int, int, int], tuple[int, int]] = {}
    for cand in assignment:
        for p in cand.placements:
            row, col = _rc(_local_of_facelet(p.target_facelet))
            placed[(p.target_face, row, col)] = (p.tile, p.rot)
    return placed


def _corner_score(bank: TileBank, candidate: CornerCandidate, placed_edges: dict[tuple[int, int, int], tuple[int, int]]) -> float:
    total = _cross_face_score(bank, candidate.placements)
    for p in candidate.placements:
        row, col = _rc(_local_of_facelet(p.target_facelet))
        for dr, dc, side in ((-1, 0, "N"), (0, 1, "E"), (1, 0, "S"), (0, -1, "W")):
            nr, nc = row + dr, col + dc
            neighbour = placed_edges.get((p.target_face, nr, nc))
            if neighbour is None:
                continue
            ntile, nrot = neighbour
            total += bank.compatibility(p.tile, p.rot, side, ntile, nrot, OPPOSITE_SIDE[side])
    return total


def _best_corners(bank: TileBank, edge_assignment: tuple[EdgeCandidate, ...], required_parity: int) -> tuple[float, tuple[CornerCandidate, ...]] | None:
    placed = _placed_edges(edge_assignment)
    scored: list[list[list[CornerCandidate]]] = [[[] for _ in range(8)] for _ in range(8)]
    for p in range(8):
        for q in range(8):
            scored[p][q] = [
                CornerCandidate(c.current_pos, c.home_pos, c.co, c.placements, _corner_score(bank, c, placed))
                for c in CORNER_GEOM[p][q]
            ]

    dp: dict[tuple[int, int, int], tuple[float, tuple[CornerCandidate, ...]]] = {(0, 0, 0): (0.0, ())}
    for p in range(8):
        nxt: dict[tuple[int, int, int], tuple[float, tuple[CornerCandidate, ...]]] = {}
        for (mask, twist, parity), (score, path) in dp.items():
            for q in range(8):
                if mask & (1 << q):
                    continue
                inv = _inversion_increment(mask, q, 8)
                for cand in scored[p][q]:
                    key = (mask | (1 << q), (twist + cand.co) % 3, parity ^ inv)
                    value = (score + cand.score, path + (cand,))
                    old = nxt.get(key)
                    if old is None or value[0] > old[0]:
                        nxt[key] = value
        dp = nxt
    return dp.get(((1 << 8) - 1, 0, required_parity))


def _facelet_string(edges: tuple[EdgeCandidate, ...], corners: tuple[CornerCandidate, ...]) -> str:
    out = ["?"] * 54
    for f in range(6):
        out[CENTER_FACELET[f]] = FACE_NAMES[f]
    for cand in edges:
        for current_slot, p in enumerate(cand.placements):
            out[EDGE_FACELET[cand.current_pos][current_slot]] = FACE_NAMES[p.target_face]
    for cand in corners:
        for current_slot, p in enumerate(cand.placements):
            out[CORNER_FACELET[cand.current_pos][current_slot]] = FACE_NAMES[p.target_face]
    if "?" in out:
        raise ValueError("Internal reconstruction error: incomplete facelet string")
    return "".join(out)


def _confidence(chosen_score: float, alternatives: Iterable[float], borders: int = 72) -> float:
    alts = sorted((x for x in alternatives if math.isfinite(x)), reverse=True)
    if len(alts) < 2:
        return 0.65
    gap = max(0.0, alts[0] - alts[1])
    return max(0.05, min(0.99, 0.55 + gap * 12.0 / max(1, borders)))


def reconstruct(raw: bytes, tile_size: int) -> dict:
    bank = TileBank(raw, tile_size)

    invariant_edges = _best_edges(_score_edge_matrix_rotation_invariant(bank))
    legal = []
    for seed_parity, (_, seed_path) in invariant_edges.items():
        center_rots = _refine_center_rots(bank, seed_path, (0, 0, 0, 0, 0, 0))

        edge_by_parity = _best_edges(_score_edge_matrix(bank, center_rots))
        for parity, (edge_score, edge_path) in edge_by_parity.items():
            corner = _best_corners(bank, edge_path, parity)
            if corner is None:
                continue
            corner_score, corner_path = corner
            legal.append((edge_score + corner_score, parity, edge_path, corner_path, center_rots, seed_parity))

    if not legal:
        raise ValueError("Could not reconstruct a legal cube state. Retake blurry/glared faces and try again.")
    legal.sort(key=lambda x: x[0], reverse=True)
    total_score, parity, edges, corners, center_rots, seed_parity = legal[0]
    state = _facelet_string(edges, corners)

    return {
        "state": state,
        "center_rotations": list(center_rots),
        "score": total_score,
        "confidence": _confidence(total_score, [x[0] for x in legal]),
        "edge_parity": parity,
        "seed_parity": seed_parity,
        "edges": [
            {"current": c.current_pos, "home": c.home_pos, "orientation": c.eo, "score": c.score}
            for c in edges
        ],
        "corners": [
            {"current": c.current_pos, "home": c.home_pos, "orientation": c.co, "score": c.score}
            for c in corners
        ],
    }
