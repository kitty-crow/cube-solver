from __future__ import annotations

import base64
import json
from itertools import product

from .centres import CUBE_ROTATIONS, centre_correction, centres_after_solution, simplify_moves
from .centre_fit import fit_reachable_centres
from .geometry import FACE_INDEX, FACE_NAMES, FACE_NORMAL, FACE_RIGHT, FACE_UP, EDGE_GEOM, CORNER_GEOM
from .reconstruct import reconstruct
from .vision import set_visual_evidence
from . import generic as _generic
from .surface import face_neighbours as _surface_face_neighbours

_generic.face_neighbours = _surface_face_neighbours

_SOLVER_READY = False
_PROGRESS_CALLBACK = None


def set_progress_callback(callback=None) -> None:
    global _PROGRESS_CALLBACK
    _PROGRESS_CALLBACK = callback


def _emit_progress(detail: str, progress: float) -> None:
    callback = _PROGRESS_CALLBACK
    if callback is None:
        return
    try:
        callback(str(detail), float(progress))
    except Exception:
        pass


def warm_solver() -> str:
    global _SOLVER_READY
    if _SOLVER_READY:
        return "ready"
    from rubik_solver import init_solver
    init_solver()
    _SOLVER_READY = True
    return "ready"


def _picture_quality(reconstruction: dict) -> float | None:
    verification = reconstruction.get("picture_verification")
    if not isinstance(verification, dict):
        return None
    agreement = float(verification.get("agreement", 0.0) or 0.0)
    strong = float(verification.get("strong_fraction", 0.0) or 0.0)
    return 0.72 * agreement + 0.28 * strong


def _solve_reconstruction_candidate(raw: bytes, tile_size: int, reconstruction: dict) -> dict:
    from rubik_solver import Cube, solve

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
    reconstruction = {**reconstruction, "center_rotations": centre_fit["rotations"]}
    remaining_centres = centres_after_solution(reconstruction["center_rotations"], solution)
    centre_algs = centre_correction(remaining_centres)
    centre_tokens = simplify_moves(" ".join(centre_algs))
    full_tokens = simplify_moves(solution.split() + centre_tokens)

    return {
        **reconstruction,
        "solution": solution,
        "centre_solution": " ".join(centre_tokens),
        "moves": full_tokens,
        "move_count": len(full_tokens),
        "cubie_move_count": len(solution.split()) if solution else 0,
        "centre_move_count": len(centre_tokens),
        "remaining_centres_before_correction": remaining_centres,
        "centre_fit": {
            "score": centre_fit["score"],
            "adjusted_faces": centre_fit["adjusted_faces"],
            "local_best": centre_fit["local_best"],
        },
        "picture_quality": _picture_quality(reconstruction),
    }


def _manual_identification(evidence) -> dict | None:
    if not isinstance(evidence, dict):
        return None
    reference = evidence.get("reference_evidence")
    if not isinstance(reference, dict):
        return None
    source = reference.get("reference")
    if not isinstance(source, dict):
        return None
    manual = source.get("manual_identification")
    if not isinstance(manual, dict) or not bool(manual.get("resolved")):
        return None
    state = manual.get("state")
    if not isinstance(state, str) or len(state) != 54:
        return None
    return manual


def _manual_reconstruction_for_centre_fit(manual: dict) -> dict | None:
    """Recover edge geometry from the sticker CSP's resolved placements.

    Centre fitting only needs the twelve resolved edge cubies. The CSP stores
    the exact target facelet and quarter-turn for every photographed sticker,
    so this conversion is deterministic and does not reopen fuzzy assignment.
    """
    raw_placements = manual.get("placements")
    if not isinstance(raw_placements, dict):
        return None

    placements: dict[int, tuple[int, int]] = {}
    for raw_tile, value in raw_placements.items():
        if not isinstance(value, dict):
            continue
        try:
            tile = int(raw_tile)
            target = int(value["target"])
            rotation = int(value.get("rotation", 0)) % 4
        except (KeyError, TypeError, ValueError):
            continue
        placements[tile] = (target, rotation)

    edges = []
    for current in range(12):
        matches = []
        for home in range(12):
            for candidate in EDGE_GEOM[current][home]:
                if all(
                    placements.get(placement.tile)
                    == (int(placement.target_facelet), int(placement.rot) % 4)
                    for placement in candidate.placements
                ):
                    matches.append(candidate)
        if len(matches) != 1:
            return None
        candidate = matches[0]
        edges.append({
            "current": int(candidate.current_pos),
            "home": int(candidate.home_pos),
            "orientation": int(candidate.eo),
        })

    return {"state": str(manual.get("state", "")), "edges": edges}


def _quarter_turn_distance(a: int, b: int) -> int:
    delta = (int(a) - int(b)) % 4
    return min(delta, 4 - delta)


def _preferred_center_rotations(manual: dict) -> list[int]:
    rotations = manual.get("center_rotations")
    if not isinstance(rotations, list) or len(rotations) != 6:
        return [0] * 6
    return [int(value) % 4 for value in rotations]


def _nearest_reachable_center_rotations(preferred, solution: str) -> list[int]:
    """Project a noisy centre-orientation guess onto the physical 3×3 group.

    A centre-image alignment is evidence, not a licence to reject an otherwise
    legal and strongly identified cube. Search all 4^6 centre orientations and
    retain the closest one whose post-solution centre state is actually
    reachable by the picture-centre algorithms.
    """
    wanted = [int(value) % 4 for value in list(preferred)[:6]]
    wanted += [0] * (6 - len(wanted))
    best = None
    best_key = None
    for candidate in product(range(4), repeat=6):
        remaining = centres_after_solution(list(candidate), solution)
        if sum(int(value) for value in remaining) % 2:
            continue
        distance = sum(_quarter_turn_distance(candidate[i], wanted[i]) for i in range(6))
        changed = sum(candidate[i] != wanted[i] for i in range(6))
        key = (distance, changed, candidate)
        if best_key is None or key < best_key:
            best_key = key
            best = candidate
    if best is None:
        raise RuntimeError("Could not construct a physically reachable centre orientation")
    return list(best)


def _fit_manual_center_rotations(raw: bytes, tile_size: int, manual: dict, solution: str) -> dict:
    preferred = _preferred_center_rotations(manual)
    reconstruction = _manual_reconstruction_for_centre_fit(manual)
    if reconstruction is not None:
        try:
            fitted = fit_reachable_centres(raw, tile_size, reconstruction, solution)
            rotations = [int(value) % 4 for value in fitted["rotations"]]
            return {
                "rotations": rotations,
                "score": fitted.get("score"),
                "adjusted_faces": list(fitted.get("adjusted_faces", [])),
                "local_best": list(fitted.get("local_best", preferred)),
                "source": "scan-and-reference-fit",
            }
        except Exception:
            # The identified cubie state remains authoritative. Older saved jobs
            # may not contain enough placement metadata for the richer fit.
            pass

    rotations = _nearest_reachable_center_rotations(preferred, solution)
    return {
        "rotations": rotations,
        "score": None,
        "adjusted_faces": [i for i in range(6) if rotations[i] != preferred[i]],
        "local_best": preferred,
        "source": "nearest-physical-orientation",
    }


def _manual_result_metadata(manual: dict) -> dict:
    exact = bool(manual.get("exact", manual.get("resolution_kind") == "unique"))
    default_confidence = 1.0 if exact else 0.0
    try:
        confidence = max(0.0, min(1.0, float(manual.get("confidence", default_confidence))))
    except (TypeError, ValueError):
        confidence = default_confidence
    try:
        legal_state_count = max(1, int(manual.get("legal_state_count", 1)))
    except (TypeError, ValueError):
        legal_state_count = 1
    confirmed = manual.get("confirmed") if isinstance(manual.get("confirmed"), dict) else {}
    ambiguous = manual.get("ambiguous") if isinstance(manual.get("ambiguous"), dict) else {}
    inferred = max(0, 48 - len(confirmed) - len(ambiguous))
    return {
        "exact": exact,
        "confidence": confidence,
        "legal_state_count": legal_state_count,
        "resolution_kind": str(manual.get("resolution_kind") or ("unique" if exact else "probable")),
        "confirmed_count": len(confirmed),
        "ambiguous_count": len(ambiguous),
        "inferred_count": inferred,
    }


def _solve_manual_3x3(raw: bytes, tile_size: int, manual: dict) -> dict:
    """Solve the legal cubie state selected by the interactive constraint solver.

    Hard user assignments and the cubie CSP determine the scramble. Centre
    identities remain hard anchors, while their quarter-turn orientations are
    fitted to the nearest physically reachable picture-centre state rather than
    being allowed to invalidate an otherwise legal high-confidence scramble.
    """
    from rubik_solver import Cube, solve

    if not _SOLVER_READY:
        warm_solver()

    state = str(manual["state"])
    cube = Cube.from_string(state)
    valid = cube.verify()
    if valid is not True:
        raise ValueError(f"Identified cube is not legal: {valid}")

    metadata = _manual_result_metadata(manual)
    confidence_label = f"{round(metadata['confidence'] * 100)}%" if not metadata["exact"] else "unique"
    _emit_progress(f"Solving the identified legal cube state ({confidence_label})…", 0.972)
    solution = solve(cube)
    if solution is None:
        raise RuntimeError("Two-phase solver could not solve the identified state")
    if not isinstance(solution, str):
        solution = " ".join(str(x) for x in solution)
    solution = solution.strip()

    check = Cube.from_string(state)
    if solution:
        check.move(solution)
    if not check.is_solved():
        raise RuntimeError("Solver returned a sequence that did not solve the identified state")

    centre_fit = _fit_manual_center_rotations(raw, tile_size, manual, solution)
    center_rotations = list(centre_fit["rotations"])
    remaining_centres = centres_after_solution(center_rotations, solution)
    centre_algs = centre_correction(remaining_centres)
    centre_tokens = simplify_moves(" ".join(centre_algs))
    full_tokens = simplify_moves(solution.split() + centre_tokens)

    if metadata["exact"]:
        selection_reason = "unique legal scramble from hard user confirmations plus exact cube-constraint propagation"
    else:
        selection_reason = (
            "highest-confidence legal scramble from hard confirmations, ambiguous hints, image evidence, "
            "cubie adjacency/orientation and exact cube constraints"
        )

    return {
        "state": state,
        "center_rotations": center_rotations,
        "solution": solution,
        "centre_solution": " ".join(centre_tokens),
        "moves": full_tokens,
        "move_count": len(full_tokens),
        "cubie_move_count": len(solution.split()) if solution else 0,
        "centre_move_count": len(centre_tokens),
        "remaining_centres_before_correction": remaining_centres,
        "centre_fit": centre_fit,
        "confidence": metadata["confidence"],
        "manual_identification": True,
        "manual_identification_exact": metadata["exact"],
        "manual_resolution_kind": metadata["resolution_kind"],
        "manual_confirmed_stickers": metadata["confirmed_count"],
        "manual_ambiguous_stickers": metadata["ambiguous_count"],
        "manual_inferred_stickers": metadata["inferred_count"],
        "legal_state_count": metadata["legal_state_count"],
        "selection_reason": selection_reason,
        "centre_anchor_policy": "centre identities are fixed by reference alignment; centre rotations are projected onto the physically reachable picture-cube group",
    }


def _solve_3x3(raw: bytes, tile_size: int) -> dict:
    reconstruction = reconstruct(raw, tile_size)
    alternatives = reconstruction.pop("alternatives", [])

    if not _SOLVER_READY:
        warm_solver()

    candidates = [reconstruction] + list(alternatives[:7])
    solved = []
    for index, candidate in enumerate(candidates):
        try:
            solved_candidate = _solve_reconstruction_candidate(raw, tile_size, candidate)
            solved_candidate["hypothesis_index"] = index
            solved.append(solved_candidate)
        except Exception:
            continue

    if not solved:
        raise RuntimeError("No visually plausible legal reconstruction produced a valid solution")

    with_reference = any(isinstance(item.get("picture_verification"), dict) for item in solved)
    if with_reference:
        best_picture = max(float(item.get("picture_quality") or 0.0) for item in solved)
        near = [
            item for item in solved
            if float(item.get("picture_quality") or 0.0) >= best_picture - 0.035
        ]
        selected = min(
            near,
            key=lambda item: (
                int(item.get("move_count", 10_000)),
                int(item.get("cubie_move_count", 10_000)),
                -float(item.get("score", 0.0)),
            ),
        )
        if not any(bool((item.get("picture_verification") or {}).get("verified")) for item in solved):
            raise ValueError(
                "The mechanically legal hypotheses still do not reproduce the selected source image closely enough. "
                "Try a different source reference or retake the most reflective face."
            )
        selected["selection_reason"] = "source match first; shorter move sequence used only among visually near-equal legal hypotheses"
    else:
        selected = solved[0]
        selected["selection_reason"] = "continuity-only reconstruction"

    selected["hypotheses_solved"] = len(solved)
    selected["hypothesis_move_counts"] = [int(item.get("move_count", 0)) for item in solved]
    return selected


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
    previews = source.get("solved_face_previews")
    if not isinstance(previews, list) or len(previews) != 6:
        previews = []
    face_order = source.get("face_order")
    if not isinstance(face_order, list) or len(face_order) != 6:
        face_order = list(FACE_NAMES)
    manual = source.get("manual_identification") if isinstance(source.get("manual_identification"), dict) else None
    return {
        "subject": reference.get("subject"),
        "fit": reference.get("fit"),
        "raw_fit": reference.get("raw_fit"),
        "distinctiveness": reference.get("distinctiveness"),
        "glare_fraction": reference.get("glare_fraction"),
        "title": source.get("title"),
        "source_url": source.get("source_url"),
        "layout": source.get("layout"),
        "recognition_model": reference.get("recognition_model"),
        "solved_picture_target": bool(source.get("solved_picture_target")),
        "solved_face_previews": previews,
        "face_order": face_order,
        "projection_kind": source.get("projection_kind"),
        "surface_partition": source.get("surface_partition"),
        "source_overlap_allowed": bool(source.get("source_overlap_allowed", False)),
        "source_overlap_fraction": float(source.get("source_overlap_fraction", 0.0) or 0.0),
        "face_domain_clipped_fraction": float(source.get("face_domain_clipped_fraction", 0.0) or 0.0),
        "centre_alignment": source.get("centre_alignment"),
        "manual_identification_resolved": bool(manual and manual.get("resolved")),
        "manual_identification_exact": bool(manual and manual.get("exact")),
        "manual_identification_confidence": float(manual.get("confidence", 0.0) or 0.0) if manual else None,
        "manual_confirmed_stickers": len(manual.get("confirmed", {})) if manual else 0,
    }


def solve_scan(payload_json: str) -> str:
    payload = json.loads(payload_json)
    size = int(payload.get("size", 3))
    tile_size = int(payload["tile_size"])
    raw = base64.b64decode(payload["rgb_b64"])
    evidence = payload.get("visual_evidence")

    _emit_progress("Preparing legal reconstruction search…", 0.941)
    set_visual_evidence(evidence)
    try:
        if size == 2:
            _emit_progress("Reconstructing legal 2×2 state…", 0.955)
            from .pocket import solve_scan_2x2
            result = solve_scan_2x2(raw, tile_size)
        elif size == 3:
            manual = _manual_identification(evidence)
            if manual is not None:
                confidence = float(manual.get("confidence", 1.0) or 0.0)
                exact = bool(manual.get("exact"))
                label = "unique" if exact else f"{round(confidence * 100)}% confidence"
                _emit_progress(f"Using the identified legal cube state ({label})…", 0.955)
                result = _solve_manual_3x3(raw, tile_size, manual)
            else:
                result = _solve_3x3(raw, tile_size)
        elif size == 4:
            _emit_progress("Reconstructing centres and wings…", 0.955)
            from . import bigcube
            _patch_bigcube_semantic_scoring(bigcube)
            result = bigcube.solve_scan_4x4(raw, tile_size)
        else:
            raise ValueError(f"Unsupported cube size: {size}×{size}×{size}")
    finally:
        set_visual_evidence(None)

    _emit_progress("Packaging verified solution…", 0.991)
    if isinstance(evidence, dict):
        result["visual_ensemble"] = {
            "models": evidence.get("models", {}),
            "capabilities": evidence.get("capabilities", {}),
        }
        summary = _reference_summary(evidence)
        if summary:
            result["semantic_reference"] = summary
            result["solved_picture_target"] = "selected wrapped reference"
            result["solved_picture_face_order"] = summary.get("face_order")
    return json.dumps(result, separators=(",", ":"))
