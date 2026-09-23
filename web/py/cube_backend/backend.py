from __future__ import annotations

import base64
import json

from .centres import CUBE_ROTATIONS, centre_correction, centres_after_solution
from .centre_fit import fit_reachable_centres
from .geometry import FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP, EDGE_GEOM, CORNER_GEOM
from .reconstruct import reconstruct
from .vision import set_visual_evidence
from . import generic as _generic
from .surface import face_neighbours as _surface_face_neighbours

_generic.face_neighbours = _surface_face_neighbours

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
    picture_verification = reconstruction.get("picture_verification")
    if isinstance(picture_verification, dict):
        reference_fit = float(picture_verification.get("reference_fit", 0.0) or 0.0)
        verified = bool(picture_verification.get("verified"))
        if reference_fit >= 0.65 and not verified:
            raise ValueError(
                "The cube state is mechanically legal, but the final picture does not match the selected reference closely enough. "
                "Try another reference or retake the ambiguous faces."
            )

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

    centre_fit = fit_reachable_centres(raw, tile_size, reconstruction, solution)
    reconstruction["center_rotations"] = centre_fit["rotations"]

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
        "centre_fit": {
            "score": centre_fit["score"],
            "adjusted_faces": centre_fit["adjusted_faces"],
            "local_best": centre_fit["local_best"],
        },
    }


def _patch_bigcube_semantic_scoring(bigcube) -> None:
    if getattr(bigcube, "_SEMANTIC_SCORING_PATCHED", False):
        return
    original = bigcube._incremental_score

    def scored(bank, candidate, occupancy):
        absolute = sum(
            bank.placement_score(
                placement.source_facelet,
                placement.rot,
                placement.target_facelet,
            )
            for placement in candidate.placements
        )
        return original(bank, candidate, occupancy) + absolute

    bigcube._incremental_score = scored
    bigcube._SEMANTIC_SCORING_PATCHED = True


def _reference_summary(evidence) -> dict | None:
    if not isinstance(evidence, dict):
        return None
    reference = evidence.get("reference_evidence")
    if not isinstance(reference, dict):
        return None
    source = reference.get("reference") if isinstance(reference.get("reference"), dict) else {}
    return {
        "subject": reference.get("subject"),
        "fit": reference.get("fit"),
        "title": source.get("title"),
        "source_url": source.get("source_url"),
        "layout": source.get("layout"),
        "recognition_model": reference.get("recognition_model"),
    }


def solve_scan(payload_json: str) -> str:
    payload = json.loads(payload_json)
    size = int(payload.get("size", 3))
    tile_size = int(payload["tile_size"])
    raw = base64.b64decode(payload["rgb_b64"])
    evidence = payload.get("visual_evidence")

    set_visual_evidence(evidence)
    try:
        if size == 2:
            from .pocket import solve_scan_2x2
            result = solve_scan_2x2(raw, tile_size)
        elif size == 3:
            result = _solve_3x3(raw, tile_size)
        elif size == 4:
            from . import bigcube
            _patch_bigcube_semantic_scoring(bigcube)
            result = bigcube.solve_scan_4x4(raw, tile_size)
        else:
            raise ValueError(f"Unsupported cube size: {size}×{size}×{size}")
    finally:
        set_visual_evidence(None)

    if isinstance(evidence, dict):
        result["visual_ensemble"] = {
            "models": evidence.get("models", {}),
            "capabilities": evidence.get("capabilities", {}),
        }
        summary = _reference_summary(evidence)
        if summary:
            result["semantic_reference"] = summary
    return json.dumps(result, separators=(",", ":"))
