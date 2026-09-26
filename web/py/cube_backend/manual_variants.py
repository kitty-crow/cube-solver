from __future__ import annotations

import json
import sys

from . import backend as _backend
from .centres import centre_correction, centres_after_solution, simplify_moves


_BASE_MANUAL_SOLVER = _backend._solve_manual_3x3
_BASE_SOLVE_SCAN = _backend.solve_scan
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


def _invert_token(token: str) -> str:
    token = str(token).strip()
    if token.endswith("2"):
        return token
    if token.endswith("'"):
        return token[:-1]
    return token + "'"


def _invert_moves(moves) -> list[str]:
    if moves is None:
        tokens = []
    elif isinstance(moves, str):
        tokens = moves.split()
    else:
        tokens = [str(token) for token in moves]
    return [_invert_token(token) for token in reversed([token for token in tokens if token])]


def _normalise_centres(values) -> list[int]:
    raw = list(values or [])
    return [int(raw[index] if index < len(raw) else 0) % 4 for index in range(6)]


def _post_solve_tweak_result(payload: dict) -> dict:
    """Return legal moves from the canonical solved cube to a user-tweaked target."""
    from rubik_solver import Cube, solve

    tweak = payload.get("post_solve_tweak")
    if not isinstance(tweak, dict):
        raise ValueError("Missing post-solve tweak target")
    manual = tweak.get("manual") if isinstance(tweak.get("manual"), dict) else tweak
    state = str(manual.get("state") or "")
    if len(state) != 54:
        raise ValueError("The tweaked target does not contain a complete 3×3 sticker state")

    cube = Cube.from_string(state)
    valid = cube.verify()
    if valid is not True:
        raise ValueError(f"The requested sticker/cubie target is not a legal 3×3 state: {valid}")

    to_solved = solve(cube)
    if to_solved is None:
        to_solved_tokens = []
    elif isinstance(to_solved, str):
        to_solved_tokens = to_solved.split()
    else:
        to_solved_tokens = [str(token) for token in to_solved]
    cubie_target_tokens = _invert_moves(to_solved_tokens)

    desired_centres = _normalise_centres(tweak.get("center_rotations", manual.get("center_rotations")))
    remaining_centres = centres_after_solution(desired_centres, " ".join(cubie_target_tokens))
    try:
        centre_algorithms = centre_correction(remaining_centres)
    except ValueError as error:
        raise ValueError(
            "That combination of cubie placement, sticker orientation and centre rotations cannot be reached "
            "by legal 3×3 moves. Keep the tweak as a draft and add or change another compatible tweak."
        ) from error

    centre_tokens = simplify_moves(" ".join(centre_algorithms))
    moves = simplify_moves(cubie_target_tokens + centre_tokens)
    return {
        "kind": "post-solve-tweak",
        "state": state,
        "center_rotations": desired_centres,
        "cubie_moves": cubie_target_tokens,
        "centre_moves": centre_tokens,
        "moves": moves,
        "move_count": len(moves),
        "cubie_move_count": len(cubie_target_tokens),
        "centre_move_count": len(centre_tokens),
        "remaining_centres_before_correction": remaining_centres,
        "from_state": "canonical solved picture cube",
        "to_state": "user-tweaked legal picture target",
        "exact": bool(manual.get("exact", True)),
        "legal_state_count": int(manual.get("legal_state_count", 1) or 1),
    }


def solve_scan_with_post_solve_tweaks(payload_json: str) -> str:
    payload = json.loads(payload_json)
    if not isinstance(payload.get("post_solve_tweak"), dict):
        return _BASE_SOLVE_SCAN(payload_json)
    try:
        result = _post_solve_tweak_result(payload)
    except Exception as error:
        result = {"kind": "post-solve-tweak-error", "error": str(error)}
    return json.dumps(result, separators=(",", ":"))


_backend._solve_manual_3x3 = solve_manual_with_variants
_backend.solve_scan = solve_scan_with_post_solve_tweaks
_package = sys.modules.get(__package__)
if _package is not None:
    _package.solve_scan = solve_scan_with_post_solve_tweaks
