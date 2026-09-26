from __future__ import annotations

import json
from typing import Iterable

from .centres import centre_correction, centres_after_solution, simplify_moves
from .geometry import FACE_NAMES


def _normalise_tokens(moves: str | Iterable[str] | None) -> list[str]:
    if moves is None:
        return []
    if isinstance(moves, str):
        return [token for token in moves.split() if token]
    return [str(token) for token in moves if str(token)]


def invert_token(token: str) -> str:
    token = str(token).strip()
    if not token:
        return token
    if token.endswith("2"):
        return token
    if token.endswith("'"):
        return token[:-1]
    return token + "'"


def invert_moves(moves: str | Iterable[str] | None) -> list[str]:
    return [invert_token(token) for token in reversed(_normalise_tokens(moves))]


def _normalise_centres(values) -> list[int]:
    raw = list(values or [])
    return [int(raw[index] if index < len(raw) else 0) % 4 for index in range(6)]


def solve_tweaked_target(payload_json: str) -> str:
    """Find legal moves from the canonical solved picture cube to a tweaked target.

    ``manual.state`` is the exact cubie arrangement produced by the browser's
    sticker/cubie constraint solver.  ``center_rotations`` is a six-entry URFDLB
    vector of desired in-plane centre quarter-turns.  The cubie target is solved
    backwards with the normal two-phase solver and then inverted, after which a
    centre-only correction is appended.  If that final centre orientation lies
    outside the physically reachable picture-centre subgroup, the request is
    rejected instead of silently changing another sticker/cubie.
    """
    from rubik_solver import Cube, solve

    payload = json.loads(payload_json) if isinstance(payload_json, str) else dict(payload_json)
    manual = payload.get("manual") if isinstance(payload.get("manual"), dict) else payload
    state = str(manual.get("state") or "")
    if len(state) != 54:
        raise ValueError("The tweaked target does not contain a complete 3×3 sticker state")

    cube = Cube.from_string(state)
    verified = cube.verify()
    if verified is not True:
        raise ValueError(f"The requested sticker/cubie target is not a legal 3×3 state: {verified}")

    to_solved = solve(cube)
    if to_solved is None:
        to_solved_tokens: list[str] = []
    elif isinstance(to_solved, str):
        to_solved_tokens = _normalise_tokens(to_solved)
    else:
        to_solved_tokens = _normalise_tokens(str(token) for token in to_solved)

    cubie_target_tokens = invert_moves(to_solved_tokens)
    desired_centres = _normalise_centres(payload.get("center_rotations", manual.get("center_rotations")))
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
    return json.dumps({
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
        "face_order": list(FACE_NAMES),
    })
