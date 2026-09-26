from __future__ import annotations

import json
import sys
from itertools import product

from . import backend as _backend
from .centres import centre_correction, centres_after_solution, simplify_moves
from .geometry import FACE_NAMES


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
    """Solve the ranked legal manual state and nearby ambiguous alternatives."""
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
    """Invert one face-turn token.

    Kept as a public module helper because older regression tests and any saved
    tooling may import it. The corrected post-solve workflow itself intentionally
    does not invert the solver sequence: it now solves the real cube *to* the
    fixed reference, rather than generating a path in the opposite direction.
    """
    token = str(token).strip()
    if not token:
        return token
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


def _normalise_locked_faces(values, requested: list[int]) -> set[int]:
    locked = set()
    for value in values or []:
        try:
            face = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= face < 6:
            locked.add(face)
    if not locked:
        locked.update(index for index, rotation in enumerate(requested) if rotation % 4)
    return locked


def _quarter_distance(a: int, b: int) -> int:
    delta = (int(a) - int(b)) % 4
    return min(delta, 4 - delta)


def _choose_reachable_centre_corrections(
    requested: list[int], locked_faces: set[int], cubie_solution: list[str]
) -> tuple[list[int], list[str], list[int]]:
    """Keep user-observed centre corrections fixed and infer companions.

    A single quarter-turned picture centre is not itself a reachable centre-only
    state. That does not make the observation wrong. It means at least one other
    centre assumption from the earlier solve is wrong too. Enumerate the tiny
    4^6 centre space, preserve every authoritative face exactly, and choose the
    least-disturbing physically reachable completion for the other faces.
    """
    solution_text = " ".join(cubie_solution)
    best_base = None
    shortlist: list[tuple[list[int], list[int]]] = []

    for candidate_tuple in product(range(4), repeat=6):
        if any(candidate_tuple[face] != requested[face] for face in locked_faces):
            continue
        candidate = list(candidate_tuple)
        remaining = centres_after_solution(candidate, solution_text)
        if sum(int(value) for value in remaining) % 2:
            continue
        changed = [face for face in range(6) if candidate[face] != requested[face]]
        base = (
            len(changed),
            sum(_quarter_distance(candidate[face], requested[face]) for face in changed),
        )
        if best_base is None or base < best_base:
            best_base = base
            shortlist = [(candidate, remaining)]
        elif base == best_base:
            shortlist.append((candidate, remaining))

    best = None
    for candidate, remaining in shortlist:
        try:
            algorithms = centre_correction(remaining)
        except ValueError:
            continue
        tokens = simplify_moves(" ".join(algorithms))
        key = (len(tokens), tuple(candidate))
        if best is None or key < best[0]:
            best = (key, candidate, tokens)

    if best is None:
        locked_names = ", ".join(FACE_NAMES[index] for index in sorted(locked_faces)) or "the selected centre"
        raise ValueError(
            f"The authoritative correction on {locked_names} cannot be reconciled with the other authoritative "
            "centre corrections. The fixed reference has not been changed; re-check another centre on the real cube."
        )

    chosen = list(best[1])
    inferred = [face for face in range(6) if chosen[face] != requested[face]]
    return chosen, list(best[2]), inferred


def _post_solve_tweak_result(payload: dict) -> dict:
    """Correct the observed real cube back to the unchanged wrapped reference."""
    from rubik_solver import Cube, solve

    tweak = payload.get("post_solve_tweak")
    if not isinstance(tweak, dict):
        raise ValueError("Missing post-solve correction state")
    manual = tweak.get("manual") if isinstance(tweak.get("manual"), dict) else tweak
    state = str(manual.get("state") or "")
    if len(state) != 54:
        raise ValueError("The corrected real-cube reconstruction does not contain a complete 3×3 sticker state")

    cube = Cube.from_string(state)
    valid = cube.verify()
    if valid is not True:
        raise ValueError(f"The corrected real-cube reconstruction is not a legal 3×3 state: {valid}")

    to_reference = solve(cube)
    if to_reference is None:
        cubie_tokens: list[str] = []
    elif isinstance(to_reference, str):
        cubie_tokens = [token for token in to_reference.split() if token]
    else:
        cubie_tokens = [str(token) for token in to_reference if str(token)]

    requested_centres = _normalise_centres(
        tweak.get("center_rotations", manual.get("center_rotations"))
    )
    locked_faces = _normalise_locked_faces(tweak.get("locked_center_faces"), requested_centres)
    chosen_centres, centre_tokens, inferred_faces = _choose_reachable_centre_corrections(
        requested_centres, locked_faces, cubie_tokens
    )

    moves = simplify_moves(cubie_tokens + centre_tokens)
    return {
        "kind": "post-solve-tweak",
        "state": state,
        "requested_center_rotations": requested_centres,
        "center_rotations": chosen_centres,
        "authoritative_center_faces": sorted(locked_faces),
        "inferred_center_faces": inferred_faces,
        "inferred_center_rotations": {
            FACE_NAMES[face]: chosen_centres[face] for face in inferred_faces
        },
        "cubie_moves": cubie_tokens,
        "centre_moves": centre_tokens,
        "moves": moves,
        "move_count": len(moves),
        "cubie_move_count": len(cubie_tokens),
        "centre_move_count": len(centre_tokens),
        "from_state": "corrected observed real cube",
        "to_state": "fixed wrapped reference",
        "reference_modified": False,
        "authoritative_observation_preserved": True,
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
