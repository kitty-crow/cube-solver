from __future__ import annotations

import base64
import json

from .centres import CUBE_ROTATIONS, centre_correction, centres_after_solution
from .reconstruct import reconstruct
from .geometry import FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP, EDGE_GEOM, CORNER_GEOM

_SOLVER_READY = False


def warm_solver() -> str:
    global _SOLVER_READY
    if _SOLVER_READY:
        return "ready"
    from rubik_solver import init_solver
    init_solver()
    _SOLVER_READY = True
    return "ready"


def solve_scan(payload_json: str) -> str:
    payload = json.loads(payload_json)
    tile_size = int(payload["tile_size"])
    raw = base64.b64decode(payload["rgb_b64"])
    reconstruction = reconstruct(raw, tile_size)

    from rubik_solver import Cube, solve
    if not _SOLVER_READY:
        warm_solver()

    cube = Cube.from_string(reconstruction["state"])
    valid = cube.verify()
    if valid is not True:
        raise ValueError(f"Reconstructed cube is not legal: {valid}")

    solution = solve(cube)
    if solution is None:
        raise RuntimeError("Two-phase solver could not find a solution within its configured depth")
    if not isinstance(solution, str):
        solution = " ".join(str(x) for x in solution)
    solution = solution.strip()

    # Verify that the solver actually returns the cube to the solved cubie state.
    check = Cube.from_string(reconstruction["state"])
    if solution:
        check.move(solution)
    if not check.is_solved():
        raise RuntimeError("Solver returned a sequence that did not solve the reconstructed state")

    remaining_centres = centres_after_solution(reconstruction["center_rotations"], solution)
    centre_algs = centre_correction(remaining_centres)
    centre_moves = " ".join(centre_algs).strip()
    full_solution = " ".join(x for x in (solution, centre_moves) if x).strip()

    result = {
        **reconstruction,
        "solution": solution,
        "centre_solution": centre_moves,
        "moves": full_solution.split() if full_solution else [],
        "cubie_move_count": len(solution.split()) if solution else 0,
        "centre_move_count": len(centre_moves.split()) if centre_moves else 0,
        "remaining_centres_before_correction": remaining_centres,
    }
    return json.dumps(result, separators=(",", ":"))
