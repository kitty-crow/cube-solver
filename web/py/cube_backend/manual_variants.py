from __future__ import annotations

from . import backend as _backend


_BASE_MANUAL_SOLVER = _backend._solve_manual_3x3
_MAX_ALTERNATIVES = 3


def _without_nested_alternatives(manual: dict) -> dict:
    clean = dict(manual)
    clean.pop("alternatives", None)
    return clean


def _solve_one(raw: bytes, tile_size: int, manual: dict, rank: int) -> dict:
    result = _BASE_MANUAL_SOLVER(raw, tile_size, _without_nested_alternatives(manual))
    result["solution_variant_rank"] = int(rank)
    result["manual_solution_rank"] = int(manual.get("solution_rank", rank) or rank)
    try:
        result["confidence"] = max(0.0, min(1.0, float(manual.get("confidence", result.get("confidence", 0.0)))))
    except (TypeError, ValueError):
        pass
    return result


def solve_manual_with_variants(raw: bytes, tile_size: int, manual: dict) -> dict:
    """Solve the ranked legal manual state and nearby ambiguous alternatives.

    Hard confirmations are shared by every variant. Alternatives differ only in
    still-soft/inferred placements retained by the sticker CSP. A failed lower
    ranked alternative is skipped rather than being allowed to invalidate the
    best state.
    """
    primary = _solve_one(raw, tile_size, manual, 0)
    alternatives = []
    seen = {str(manual.get("state", ""))}
    raw_alternatives = manual.get("alternatives") if isinstance(manual.get("alternatives"), list) else []
    for candidate in raw_alternatives[:_MAX_ALTERNATIVES]:
        if not isinstance(candidate, dict):
            continue
        state = str(candidate.get("state", ""))
        if len(state) != 54 or state in seen:
            continue
        seen.add(state)
        try:
            alternatives.append(_solve_one(raw, tile_size, candidate, len(alternatives) + 1))
        except Exception:
            continue

    primary["alternative_solutions"] = alternatives
    primary["solution_variant_count"] = 1 + len(alternatives)
    primary["has_alternative_solutions"] = bool(alternatives)
    return primary


_backend._solve_manual_3x3 = solve_manual_with_variants
