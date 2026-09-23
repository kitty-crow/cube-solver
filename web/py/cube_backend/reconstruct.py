from __future__ import annotations

import math
from typing import Iterable

from .geometry import (
    CENTER_FACELET, CORNER_FACELET, CORNER_GEOM, EDGE_FACELET, EDGE_GEOM,
    OPPOSITE_SIDE, CornerCandidate, EdgeCandidate, _local_of_facelet, _rc,
    _side_between, FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP,
    CORNER_HOME, EDGE_HOME,
)
from .surface import face_neighbours
from .vision import TileBank


def _neg(v):
    return tuple(-x for x in v)


def _side_toward(face: int, other_face: int) -> str:
    target = FACE_NORMAL[other_face]
    if target == FACE_UP[face]: return "N"
    if target == FACE_RIGHT[face]: return "E"
    if target == _neg(FACE_UP[face]): return "S"
    if target == _neg(FACE_RIGHT[face]): return "W"
    raise ValueError(f"Faces {FACE_NAMES[face]} and {FACE_NAMES[other_face]} are not adjacent")


def _cross_face_score(bank: TileBank, placements) -> float:
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


def _absolute_score(bank: TileBank, placements) -> float:
    return sum(bank.placement_score(p.tile, p.rot, p.target_facelet) for p in placements)


def _edge_score(bank: TileBank, candidate: EdgeCandidate, center_rots: tuple[int, ...]) -> float:
    score = _absolute_score(bank, candidate.placements)
    for p in candidate.placements:
        r, c = _rc(_local_of_facelet(p.target_facelet))
        side = _side_between((r, c), (1, 1))
        centre_tile = CENTER_FACELET[p.target_face]
        score += bank.compatibility(p.tile, p.rot, side, centre_tile, center_rots[p.target_face], OPPOSITE_SIDE[side])
    return score + _cross_face_score(bank, candidate.placements)


def _score_edge_matrix(bank: TileBank, center_rots: tuple[int, ...]) -> list[list[list[EdgeCandidate]]]:
    out: list[list[list[EdgeCandidate]]] = [[[] for _ in range(12)] for _ in range(12)]
    for p in range(12):
        for q in range(12):
            out[p][q] = [EdgeCandidate(c.current_pos, c.home_pos, c.eo, c.placements, _edge_score(bank, c, center_rots)) for c in EDGE_GEOM[p][q]]
    return out


def _inversion_increment(mask: int, q: int, n: int) -> int:
    greater_mask = mask & ~((1 << (q + 1)) - 1) & ((1 << n) - 1)
    return greater_mask.bit_count() & 1


def _trim_bucket(bucket, keep: int):
    bucket.sort(key=lambda item: item[0], reverse=True)
    del bucket[keep:]


def _best_edges(scored: list[list[list[EdgeCandidate]]], keep: int = 1) -> dict[int, list[tuple[float, tuple[EdgeCandidate, ...]]]]:
    keep = max(1, int(keep))
    dp: dict[tuple[int, int, int], list[tuple[float, tuple[EdgeCandidate, ...]]]] = {(0, 0, 0): [(0.0, ())]}
    for p in range(12):
        nxt: dict[tuple[int, int, int], list[tuple[float, tuple[EdgeCandidate, ...]]]] = {}
        for (mask, flip, parity), values in dp.items():
            for score, path in values:
                for q in range(12):
                    if mask & (1 << q):
                        continue
                    inv = _inversion_increment(mask, q, 12)
                    for cand in scored[p][q]:
                        key = (mask | (1 << q), flip ^ cand.eo, parity ^ inv)
                        bucket = nxt.setdefault(key, [])
                        bucket.append((score + cand.score, path + (cand,)))
                        if len(bucket) > keep * 3:
                            _trim_bucket(bucket, keep)
        for bucket in nxt.values():
            if len(bucket) > keep:
                _trim_bucket(bucket, keep)
        dp = nxt
    full = (1 << 12) - 1
    result = {}
    for parity in (0, 1):
        values = dp.get((full, 0, parity))
        if values:
            values.sort(key=lambda item: item[0], reverse=True)
            result[parity] = values[:keep]
    return result


def _score_edge_matrix_rotation_invariant(bank: TileBank) -> list[list[list[EdgeCandidate]]]:
    out: list[list[list[EdgeCandidate]]] = [[[] for _ in range(12)] for _ in range(12)]
    for p in range(12):
        for q in range(12):
            scored = []
            for cand in EDGE_GEOM[p][q]:
                score = _cross_face_score(bank, cand.placements) + _absolute_score(bank, cand.placements)
                for placement in cand.placements:
                    r, c = _rc(_local_of_facelet(placement.target_facelet))
                    side = _side_between((r, c), (1, 1))
                    centre_tile = CENTER_FACELET[placement.target_face]
                    score += max(bank.compatibility(placement.tile, placement.rot, side, centre_tile, k, OPPOSITE_SIDE[side]) for k in range(4))
                scored.append(EdgeCandidate(cand.current_pos, cand.home_pos, cand.eo, cand.placements, score))
            out[p][q] = scored
    return out


def _refine_center_rots(bank: TileBank, assignment: tuple[EdgeCandidate, ...], rots: tuple[int, ...]) -> tuple[int, ...]:
    out = list(rots)
    for face in range(6):
        touching = [c for c in assignment if any(p.target_face == face for p in c.placements)]
        scores = []
        for k in range(4):
            total = bank.placement_score(CENTER_FACELET[face], k, CENTER_FACELET[face])
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
    placed = {}
    for cand in assignment:
        for p in cand.placements:
            row, col = _rc(_local_of_facelet(p.target_facelet))
            placed[(p.target_face, row, col)] = (p.tile, p.rot)
    return placed


def _corner_score(bank: TileBank, candidate: CornerCandidate, placed_edges: dict[tuple[int, int, int], tuple[int, int]]) -> float:
    total = _cross_face_score(bank, candidate.placements) + _absolute_score(bank, candidate.placements)
    for p in candidate.placements:
        row, col = _rc(_local_of_facelet(p.target_facelet))
        for dr, dc, side in ((-1, 0, "N"), (0, 1, "E"), (1, 0, "S"), (0, -1, "W")):
            neighbour = placed_edges.get((p.target_face, row + dr, col + dc))
            if neighbour is None:
                continue
            ntile, nrot = neighbour
            total += bank.compatibility(p.tile, p.rot, side, ntile, nrot, OPPOSITE_SIDE[side])
    return total


def _best_corners(bank: TileBank, edge_assignment: tuple[EdgeCandidate, ...], required_parity: int, keep: int = 1) -> list[tuple[float, tuple[CornerCandidate, ...]]]:
    """Keep several legal corner assignments so source evidence can decide globally."""
    keep = max(1, int(keep))
    placed = _placed_edges(edge_assignment)
    scored = [[[] for _ in range(8)] for _ in range(8)]
    for p in range(8):
        for q in range(8):
            scored[p][q] = [CornerCandidate(c.current_pos, c.home_pos, c.co, c.placements, _corner_score(bank, c, placed)) for c in CORNER_GEOM[p][q]]
    dp: dict[tuple[int, int, int], list[tuple[float, tuple[CornerCandidate, ...]]]] = {(0, 0, 0): [(0.0, ())]}
    for p in range(8):
        nxt: dict[tuple[int, int, int], list[tuple[float, tuple[CornerCandidate, ...]]]] = {}
        for (mask, twist, parity), values in dp.items():
            for score, path in values:
                for q in range(8):
                    if mask & (1 << q):
                        continue
                    inv = _inversion_increment(mask, q, 8)
                    for cand in scored[p][q]:
                        key = (mask | (1 << q), (twist + cand.co) % 3, parity ^ inv)
                        bucket = nxt.setdefault(key, [])
                        bucket.append((score + cand.score, path + (cand,)))
                        if len(bucket) > keep * 3:
                            _trim_bucket(bucket, keep)
        for bucket in nxt.values():
            if len(bucket) > keep:
                _trim_bucket(bucket, keep)
        dp = nxt
    values = dp.get(((1 << 8) - 1, 0, required_parity), [])
    values.sort(key=lambda item: item[0], reverse=True)
    return values[:keep]


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


def _target_placements(edges, corners, center_rots):
    placed = {CENTER_FACELET[face]: (CENTER_FACELET[face], center_rots[face]) for face in range(6)}
    for candidate in edges:
        for placement in candidate.placements:
            placed[placement.target_facelet] = (placement.tile, placement.rot)
    for candidate in corners:
        for placement in candidate.placements:
            placed[placement.target_facelet] = (placement.tile, placement.rot)
    if len(placed) != 54:
        raise ValueError("Internal reconstruction error: incomplete picture placement")
    return placed


def _global_picture_score(bank: TileBank, edges, corners, center_rots) -> float:
    """Score the actual target picture first, with seams as secondary evidence."""
    placed = _target_placements(edges, corners, center_rots)
    source_weight = 4.8 if bank.has_reference else 1.0
    seam_weight = 0.42 if bank.has_reference else 1.0
    source_total = sum(bank.placement_score(tile, rot, target) for target, (tile, rot) in placed.items())
    seam_total = 0.0
    neighbours = face_neighbours(3)
    for target, (tile, rot) in placed.items():
        for neighbour, side, neighbour_side in neighbours[target]:
            if neighbour <= target:
                continue
            ntile, nrot = placed[neighbour]
            seam_total += bank.compatibility(tile, rot, side, ntile, nrot, neighbour_side)
    return source_weight * source_total + seam_weight * seam_total


def _reference_verification(bank: TileBank, edges, corners, center_rots):
    if not bank.has_reference:
        return None
    placed = _target_placements(edges, corners, center_rots)
    agreements = []
    strong = 0
    for target, (tile, rot) in placed.items():
        row = bank.placement_percentile(tile, rot, target)
        col = bank.target_percentile(tile, rot, target)
        if row is None or col is None:
            continue
        agreement = math.sqrt(max(0.0, row * col))
        agreements.append(agreement)
        if row >= 0.80 and col >= 0.80:
            strong += 1
    if not agreements:
        return None
    agreement = sum(agreements) / len(agreements)
    strong_fraction = strong / len(agreements)
    verified = agreement >= 0.67 and strong_fraction >= 0.34
    return {
        "agreement": agreement,
        "strong_fraction": strong_fraction,
        "verified": verified,
        "reference_fit": bank.reference_fit,
        "reference_distinctiveness": bank.reference_distinctiveness,
    }


def _confidence(chosen_score: float, alternatives: Iterable[float], verification=None, borders: int = 108) -> float:
    alts = sorted((x for x in alternatives if math.isfinite(x)), reverse=True)
    gap_confidence = 0.65
    if len(alts) >= 2:
        gap = max(0.0, alts[0] - alts[1])
        gap_confidence = max(0.05, min(0.99, 0.55 + gap * 8.0 / max(1, borders)))
    if isinstance(verification, dict):
        picture = 0.68 * float(verification.get("agreement", 0.0)) + 0.32 * float(verification.get("strong_fraction", 0.0))
        return max(0.05, min(0.99, 0.28 * gap_confidence + 0.72 * picture))
    return gap_confidence


def _serialize_candidate(item, bank: TileBank, all_scores) -> dict:
    total_score, parity, edges, corners, center_rots, seed_parity, phase_score, state = item
    verification = _reference_verification(bank, edges, corners, center_rots)
    result = {
        "state": state,
        "center_rotations": list(center_rots),
        "score": total_score,
        "phase_score": phase_score,
        "confidence": _confidence(total_score, all_scores, verification),
        "edge_parity": parity,
        "seed_parity": seed_parity,
        "edges": [{"current": c.current_pos, "home": c.home_pos, "orientation": c.eo, "score": c.score} for c in edges],
        "corners": [{"current": c.current_pos, "home": c.home_pos, "orientation": c.co, "score": c.score} for c in corners],
    }
    if verification is not None:
        result["picture_verification"] = verification
    return result


def reconstruct(raw: bytes, tile_size: int) -> dict:
    bank = TileBank(raw, tile_size)
    seed_keep = 4 if bank.has_reference else 2
    edge_keep = 12 if bank.has_reference else 4
    corner_keep = 6 if bank.has_reference else 2
    invariant_edges = _best_edges(_score_edge_matrix_rotation_invariant(bank), keep=seed_keep)
    seen = {}
    for seed_parity, seed_values in invariant_edges.items():
        for _, seed_path in seed_values:
            center_rots = _refine_center_rots(bank, seed_path, (0, 0, 0, 0, 0, 0))
            edge_by_parity = _best_edges(_score_edge_matrix(bank, center_rots), keep=edge_keep)
            for parity, edge_values in edge_by_parity.items():
                for edge_score, edge_path in edge_values:
                    corners = _best_corners(bank, edge_path, parity, keep=corner_keep)
                    for corner_score, corner_path in corners:
                        state = _facelet_string(edge_path, corner_path)
                        global_score = _global_picture_score(bank, edge_path, corner_path, center_rots)
                        key = (state, center_rots)
                        item = (global_score, parity, edge_path, corner_path, center_rots, seed_parity, edge_score + corner_score, state)
                        old = seen.get(key)
                        if old is None or global_score > old[0]:
                            seen[key] = item
    legal = sorted(seen.values(), key=lambda x: x[0], reverse=True)
    if not legal:
        raise ValueError("Could not reconstruct a legal cube state. Retake blurry/glared faces and try again.")

    all_scores = [x[0] for x in legal]
    result = _serialize_candidate(legal[0], bank, all_scores)
    result["hypotheses_considered"] = len(legal)
    # The backend can use move complexity as a tie-breaker among visually close
    # legal reconstructions instead of blindly solving only the first one.
    result["alternatives"] = [
        _serialize_candidate(item, bank, all_scores)
        for item in legal[1:8]
    ]
    return result
