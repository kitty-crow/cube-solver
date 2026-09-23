from __future__ import annotations

import base64
import json

from .centres import CUBE_ROTATIONS, centre_correction, centres_after_solution
from .geometry import FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP, EDGE_GEOM, CORNER_GEOM
from .reconstruct import reconstruct

_SOLVER_READY = False


def warm_solver() -> str:
    global _SOLVER_READY
    if _SOLVER_READY:
        return "ready"
    from rubik_solver import init_solver
    init_solver()
    _SOLVER_READY = True
    return "ready"


def _solve_3x3(raw: bytes, tile_size: int) -> dict:
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
        raise RuntimeError("Two-phase solver could not find a solution")
    if not isinstance(solution, str):
        solution = " ".join(str(x) for x in solution)
    solution = solution.strip()

    check = Cube.from_string(reconstruction["state"])
    if solution:
        check.move(solution)
    if not check.is_solved():
        raise RuntimeError("Solver returned a sequence that did not solve the reconstructed state")

    remaining_centres = centres_after_solution(reconstruction["center_rotations"], solution)
    centre_algs = centre_correction(remaining_centres)
    centre_moves = " ".join(centre_algs).strip()
    full_solution = " ".join(x for x in (solution, centre_moves) if x).strip()

    return {
        **reconstruction,
        "solution": solution,
        "centre_solution": centre_moves,
        "moves": full_solution.split() if full_solution else [],
        "move_count": len(full_solution.split()) if full_solution else 0,
        "cubie_move_count": len(solution.split()) if solution else 0,
        "centre_move_count": len(centre_moves.split()) if centre_moves else 0,
        "remaining_centres_before_correction": remaining_centres,
    }


def solve_scan(payload_json: str) -> str:
    payload = json.loads(payload_json)
    size = int(payload.get("size", 3))
    tile_size = int(payload["tile_size"])
    raw = base64.b64decode(payload["rgb_b64"])

    if size == 2:
        from .pocket import solve_scan_2x2
        result = solve_scan_2x2(raw, tile_size)
    elif size == 3:
        result = _solve_3x3(raw, tile_size)
    elif size == 4:
        from .bigcube import solve_scan_4x4
        result = solve_scan_4x4(raw, tile_size)
    else:
        raise ValueError(f"Unsupported cube size: {size}×{size}×{size}")

    return json.dumps(result, separators=(",", ":"))
