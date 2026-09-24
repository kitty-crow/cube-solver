import math

from . import backend as _backend
from . import reconstruct as _reconstruct_module


_CENTRE_FACELETS = frozenset(_reconstruct_module.CENTER_FACELET)


def _centre_anchor_confidence(target_facelet: int, tile: int):
    """Return the hard confidence for a centre mapping, or None for non-centres.

    Centre ownership is user-anchored ground truth. A centre tile may only map to
    its own face centre and that assignment always has confidence 1.0. Rotation
    remains visual evidence, but centre identity never participates in ambiguity
    relaxation or hypothesis negotiation.
    """
    target_is_centre = target_facelet in _CENTRE_FACELETS
    tile_is_centre = tile in _CENTRE_FACELETS
    if not target_is_centre and not tile_is_centre:
        return None
    if target_facelet != tile:
        raise RuntimeError(
            f"Centre-anchor invariant violated: centre tile {tile} cannot map to {target_facelet}"
        )
    return 1.0


def _hard_centre_reference_verification(bank, edges, corners, center_rots):
    if not bank.has_reference:
        return None
    placed = _reconstruct_module._target_placements(edges, corners, center_rots)
    agreements = []
    strong = 0
    centre_count = 0
    for target, (tile, rot) in placed.items():
        centre_confidence = _centre_anchor_confidence(target, tile)
        if centre_confidence is not None:
            agreements.append(centre_confidence)
            strong += 1
            centre_count += 1
            continue

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
        "centre_anchor_confidence": 1.0,
        "centre_anchor_count": centre_count,
        "centre_ambiguity_allowed": False,
        "centre_confidence_relaxed": False,
    }


# Make the hard centre invariant part of every serialized reconstruction candidate.
# The worker already fixes centre ownership in its assignment matrix; this mirrors
# that rule in the Python verifier so malformed or weak evidence cannot soften it.
_reconstruct_module._reference_verification = _hard_centre_reference_verification


def _reconstruct_wide(raw: bytes, tile_size: int, search_level: int = 0) -> dict:
    """Reference-first reconstruction with progressively wider legal beams."""
    bank = _reconstruct_module.TileBank(raw, tile_size)
    level = max(0, min(2, int(search_level)))
    if bank.has_reference:
        beams = ((4, 12, 6, 32), (6, 20, 9, 64), (8, 28, 12, 96))
    else:
        beams = ((2, 4, 2, 12), (3, 8, 4, 24), (4, 12, 6, 32))
    seed_keep, edge_keep, corner_keep, result_keep = beams[level]
    invariant = _reconstruct_module._best_edges(
        _reconstruct_module._score_edge_matrix_rotation_invariant(bank), keep=seed_keep
    )
    seen = {}
    for seed_parity, seed_values in invariant.items():
        for _, seed_path in seed_values:
            centre_rots = _reconstruct_module._refine_center_rots(bank, seed_path, (0, 0, 0, 0, 0, 0))
            edge_by_parity = _reconstruct_module._best_edges(
                _reconstruct_module._score_edge_matrix(bank, centre_rots), keep=edge_keep
            )
            for parity, edge_values in edge_by_parity.items():
                for edge_score, edge_path in edge_values:
                    for corner_score, corner_path in _reconstruct_module._best_corners(
                        bank, edge_path, parity, keep=corner_keep
                    ):
                        state = _reconstruct_module._facelet_string(edge_path, corner_path)
                        score = _reconstruct_module._global_picture_score(bank, edge_path, corner_path, centre_rots)
                        key = (state, centre_rots)
                        item = (score, parity, edge_path, corner_path, centre_rots, seed_parity, edge_score + corner_score, state)
                        old = seen.get(key)
                        if old is None or score > old[0]:
                            seen[key] = item
    legal = sorted(seen.values(), key=lambda item: item[0], reverse=True)
    if not legal:
        raise ValueError("Could not reconstruct a legal cube state")
    scores = [item[0] for item in legal]
    result = _reconstruct_module._serialize_candidate(legal[0], bank, scores)
    result["hypotheses_considered"] = len(legal)
    result["search_level"] = level
    result["alternatives"] = [
        _reconstruct_module._serialize_candidate(item, bank, scores)
        for item in legal[1:result_keep]
    ]
    return result


def _mapping_quality(item: dict) -> float:
    confidence = max(0.0, min(1.0, float(item.get("confidence", 0.0) or 0.0)))
    verification = item.get("picture_verification")
    if not isinstance(verification, dict):
        return confidence
    agreement = max(0.0, min(1.0, float(verification.get("agreement", 0.0) or 0.0)))
    strong = max(0.0, min(1.0, float(verification.get("strong_fraction", 0.0) or 0.0)))
    return max(0.0, min(1.0, 0.35 * confidence + 0.65 * (0.72 * agreement + 0.28 * strong)))


def _confidence_floors(best: float) -> list[float]:
    floors = []
    for delta in (0.045, 0.10, 0.18, 0.28, 0.42, 1.0):
        floor = max(0.0, best - delta)
        if not floors or abs(floor - floors[-1]) > 1e-9:
            floors.append(floor)
    return floors


def _select_minmax(solved: list[dict]) -> dict:
    min_moves = min(int(item.get("move_count", 10_000)) for item in solved)
    max_moves = max(int(item.get("move_count", 10_000)) for item in solved)
    span = max(12.0, float(max_moves - min_moves), max(6.0, min_moves * 0.60))
    for item in solved:
        moves = int(item.get("move_count", 10_000))
        mapping = _mapping_quality(item)
        move_quality = max(0.0, min(1.0, 1.0 - (moves - min_moves) / span))
        item["mapping_quality"] = mapping
        item["move_quality"] = move_quality
        item["minmax_score"] = min(mapping, move_quality)
        item["compromise_score"] = 0.52 * move_quality + 0.48 * mapping
    return max(solved, key=lambda item: (
        float(item.get("minmax_score", 0.0)),
        float(item.get("compromise_score", 0.0)),
        -int(item.get("move_count", 10_000)),
        float(item.get("mapping_quality", 0.0)),
        float(item.get("score", 0.0)),
    ))


def _solve_3x3_negotiated(raw: bytes, tile_size: int) -> dict:
    if not _backend._SOLVER_READY:
        _backend.warm_solver()
    solved = []
    attempted = set()
    negotiation = []
    considered = 0
    reached_floor = 1.0

    for level in range(3):
        reconstruction = _reconstruct_wide(raw, tile_size, level)
        alternatives = reconstruction.pop("alternatives", [])
        candidates = [reconstruction] + alternatives
        considered += int(reconstruction.get("hypotheses_considered", len(candidates)))
        candidates.sort(key=lambda item: (_mapping_quality(item), float(item.get("score", 0.0))), reverse=True)
        best = _mapping_quality(candidates[0]) if candidates else 0.0
        solved_before = len(solved)

        for floor in _confidence_floors(best):
            reached_floor = min(reached_floor, floor)
            eligible = [item for item in candidates if _mapping_quality(item) + 1e-12 >= floor]
            for candidate in eligible:
                state = candidate.get("state")
                if not state or state in attempted:
                    continue
                if len(solved) - solved_before >= 18:
                    break
                attempted.add(state)
                try:
                    item = _backend._solve_reconstruction_candidate(raw, tile_size, candidate)
                    item["hypothesis_index"] = len(attempted) - 1
                    item["search_level"] = level
                    item["confidence_floor"] = floor
                    solved.append(item)
                except Exception:
                    continue
            negotiation.append({
                "search_level": level,
                "confidence_floor": floor,
                "eligible": len(eligible),
                "attempted_total": len(attempted),
                "solved_total": len(solved),
            })
            if solved and floor <= max(0.0, best - 0.18) and len(solved) >= min(6, len(candidates)):
                break
        if solved:
            break

    if not solved:
        raise RuntimeError("No legal tile mapping produced a valid solution after relaxing image confidence")

    selected = _select_minmax(solved)
    selected["selection_reason"] = (
        "hard centre anchors at confidence 1.0; progressively relaxed non-centre tile-mapping confidence; "
        "mechanically valid solutions negotiated by min-max mapping confidence and move count"
    )
    selected["confidence_floor_reached"] = reached_floor
    selected["hypotheses_attempted"] = len(attempted)
    selected["hypotheses_solved"] = len(solved)
    selected["hypotheses_considered"] = considered
    selected["hypothesis_move_counts"] = [int(item.get("move_count", 0)) for item in solved]
    selected["hypothesis_mapping_qualities"] = [float(_mapping_quality(item)) for item in solved]
    selected["negotiation"] = negotiation
    selected["centre_anchor_policy"] = "centre sticker is canonical, confidence 1.0, never reassigned, never relaxed"
    selected["centre_anchor_confidence"] = 1.0
    selected["centre_confidence_relaxed"] = False
    selected["centre_ambiguity_allowed"] = False
    return selected


_backend.reconstruct = _reconstruct_wide
_backend._solve_3x3 = _solve_3x3_negotiated

reconstruct = _reconstruct_wide
solve_scan = _backend.solve_scan
warm_solver = _backend.warm_solver

__all__ = ["reconstruct", "solve_scan", "warm_solver"]
