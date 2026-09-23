from __future__ import annotations

from itertools import product

from .centres import centres_after_solution
from .geometry import (
    CENTER_FACELET,
    EDGE_GEOM,
    OPPOSITE_SIDE,
    _local_of_facelet,
    _rc,
    _side_between,
)
from .vision import TileBank


def _selected_edges(reconstruction: dict):
    selected = []
    for item in reconstruction.get("edges", []):
        current = int(item["current"])
        home = int(item["home"])
        orientation = int(item["orientation"])
        candidates = [c for c in EDGE_GEOM[current][home] if int(c.eo) == orientation]
        if len(candidates) != 1:
            raise ValueError("Could not recover reconstructed edge geometry for centre fitting")
        selected.append(candidates[0])
    if len(selected) != 12:
        raise ValueError("Centre fitting requires all 12 reconstructed edges")
    return selected


def centre_rotation_scores(raw: bytes, tile_size: int, reconstruction: dict) -> list[list[float]]:
    bank = TileBank(raw, tile_size)
    edges = _selected_edges(reconstruction)
    scores = [[0.0] * 4 for _ in range(6)]

    for face in range(6):
        touching = [c for c in edges if any(p.target_face == face for p in c.placements)]
        for rotation in range(4):
            total = bank.placement_score(CENTER_FACELET[face], rotation, CENTER_FACELET[face])
            for candidate in touching:
                for placement in candidate.placements:
                    if placement.target_face != face:
                        continue
                    row, col = _rc(_local_of_facelet(placement.target_facelet))
                    side = _side_between((row, col), (1, 1))
                    total += bank.compatibility(
                        placement.tile,
                        placement.rot,
                        side,
                        CENTER_FACELET[face],
                        rotation,
                        OPPOSITE_SIDE[side],
                    )
            scores[face][rotation] = total
    return scores


def _remaining_is_reachable(rotations: tuple[int, ...], solution: str) -> bool:
    remaining = centres_after_solution(list(rotations), solution)
    return sum(int(x) for x in remaining) % 2 == 0


def choose_reachable_rotations(scores: list[list[float]], solution: str) -> tuple[list[int], float, list[int]]:
    if len(scores) != 6 or any(len(face) != 4 for face in scores):
        raise ValueError("Centre score matrix must be 6×4")

    local_best = [max(range(4), key=scores[face].__getitem__) for face in range(6)]
    best_rotations = None
    best_score = float("-inf")

    for rotations in product(range(4), repeat=6):
        if not _remaining_is_reachable(rotations, solution):
            continue
        score = sum(scores[face][rotations[face]] for face in range(6))
        if score > best_score:
            best_score = score
            best_rotations = rotations

    if best_rotations is None:
        raise ValueError("No physically reachable centre orientation state exists")

    chosen = list(best_rotations)
    adjustments = [face for face in range(6) if chosen[face] != local_best[face]]
    return chosen, best_score, adjustments


def fit_reachable_centres(raw: bytes, tile_size: int, reconstruction: dict, solution: str) -> dict:
    scores = centre_rotation_scores(raw, tile_size, reconstruction)
    chosen, score, adjustments = choose_reachable_rotations(scores, solution)
    return {
        "rotations": chosen,
        "score": score,
        "adjusted_faces": adjustments,
        "local_best": [max(range(4), key=scores[face].__getitem__) for face in range(6)],
    }
