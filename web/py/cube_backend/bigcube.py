from __future__ import annotations

from collections import deque
from functools import lru_cache
import heapq
import math

from .geometry import CORNER_HOME, FACE_INDEX, FACE_NAMES, FACE_NORMAL
from .generic import (
    IDENTITY,
    face_neighbours,
    facelet_parts,
    legal_candidates_for_piece,
    move_position,
    pieces,
)
from .pocket import ANCHOR, solve_2x2
from .vision import TileBank

SIZE = 4
LIMIT = SIZE - 1
NEIGHBOURS = face_neighbours(SIZE)
PIECES = pieces(SIZE)
POSITIONS = tuple(sorted(PIECES))
POSITION_INDEX = {position: i for i, position in enumerate(POSITIONS)}
CENTRES = tuple(position for position in POSITIONS if len(PIECES[position]) == 1)
WINGS = tuple(position for position in POSITIONS if len(PIECES[position]) == 2)
CORNERS = tuple(position for position in POSITIONS if len(PIECES[position]) == 3)


def _add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def _mul(a, k):
    return tuple(a[i] * k for i in range(3))


def _corner_coord(index: int):
    out = (0, 0, 0)
    for face_name in CORNER_HOME[index]:
        out = _add(out, _mul(FACE_NORMAL[FACE_INDEX[face_name]], LIMIT))
    return out


CORNER_COORDS = tuple(_corner_coord(i) for i in range(8))
CORNER_INDEX = {position: i for i, position in enumerate(CORNER_COORDS)}
ANCHOR_POSITION = CORNER_COORDS[ANCHOR]

# Pure piece-class commutators. Wide moves are two-layer WCA moves.
# Centre cycle: (U[2,2] -> F[2,1] -> F[2,2]) in zero-based 4x4 cells.
CENTRE_BASE = (
    "Rw", "R'", "U", "Lw'", "L", "U'",
    "Rw'", "R", "U", "Lw", "L'", "U'",
)
CENTRE_SUPPORT = ((1, 3, 1), (-1, -1, 3), (1, -1, 3))

# [R U R' U', r], with r represented as Rw R'. It cycles only three wings.
WING_BASE = ("R", "U", "R'", "U'", "Rw", "R'", "U", "R", "U'", "Rw'")
WING_SUPPORT = ((1, 3, -3), (1, 3, 3), (3, 3, 1))

# r2-method wing parity. It swaps two wings, leaves corners fixed, and may
# disturb centres, which is why centres are solved after wings.
WING_PARITY = (
    "R", "Rw'", "U2", "Rw", "R'", "U2",
    "R", "Rw'", "U2", "Rw", "R'", "F2",
    "Rw", "R'", "F2", "Rw", "R'", "F2",
    "Rw2", "R2", "F2", "R", "Rw'", "U2",
)

SETUP_GENERATORS = tuple(face + wide for face in FACE_NAMES for wide in ("", "w"))


def _inverse_token(token: str) -> str:
    if token.endswith("2"):
        return token
    if token.endswith("'"):
        return token[:-1]
    return token + "'"


def _inverse_moves(moves):
    return tuple(_inverse_token(token) for token in reversed(tuple(moves)))


def _move_core_amount(token: str):
    if token.endswith("2"):
        return token[:-1], 2
    if token.endswith("'"):
        return token[:-1], 3
    return token, 1


def _simplify_moves(moves):
    stack: list[tuple[str, int]] = []
    for token in moves:
        core, amount = _move_core_amount(token)
        if stack and stack[-1][0] == core:
            amount = (stack[-1][1] + amount) % 4
            stack.pop()
            if amount:
                stack.append((core, amount))
        else:
            stack.append((core, amount))
    out = []
    for core, amount in stack:
        if amount == 1:
            out.append(core)
        elif amount == 2:
            out.append(core + "2")
        elif amount == 3:
            out.append(core + "'")
    return out


def _permutation_parity(mapping, positions) -> int:
    index = {position: i for i, position in enumerate(positions)}
    perm = [index[mapping[position]] for position in positions]
    parity = 0
    for i in range(len(perm)):
        for j in range(i + 1, len(perm)):
            if perm[i] > perm[j]:
                parity ^= 1
    return parity


def _apply_mapping_move(mapping, token: str):
    return {move_position(position, SIZE, token): home for position, home in mapping.items()}


def _apply_mapping_moves(mapping, moves):
    out = mapping
    for token in moves:
        out = _apply_mapping_move(out, token)
    return out


def _incremental_score(bank: TileBank, candidate, occupancy) -> float:
    score = 0.0
    for placement in candidate.placements:
        for neighbour, side, opposite in NEIGHBOURS[placement.target_facelet]:
            other = occupancy.get(neighbour)
            if other is None:
                continue
            other_tile, other_rot = other
            score += bank.compatibility(
                placement.source_facelet,
                placement.rot,
                side,
                other_tile,
                other_rot,
                opposite,
            )
    return score


def _install(candidate, occupancy):
    out = occupancy.copy()
    for placement in candidate.placements:
        if placement.target_facelet in out:
            raise ValueError("4x4 reconstruction overlapped a target sticker")
        out[placement.target_facelet] = (placement.source_facelet, placement.rot)
    return out


def _anchor_candidate():
    candidates = legal_candidates_for_piece(ANCHOR_POSITION, ANCHOR_POSITION, SIZE)
    for candidate in candidates:
        if candidate.matrix == IDENTITY:
            return candidate
    raise RuntimeError("Could not establish 4x4 orientation anchor")


ANCHOR_CANDIDATE = _anchor_candidate()


def _home_order():
    remaining = set(POSITIONS)
    remaining.remove(ANCHOR_POSITION)
    occupied = set(PIECES[ANCHOR_POSITION])
    order = []
    while remaining:
        def connections(position):
            count = 0
            for facelet in PIECES[position]:
                count += sum(1 for neighbour, _, _ in NEIGHBOURS[facelet] if neighbour in occupied)
            return count

        home = max(remaining, key=lambda position: (connections(position), len(PIECES[position]), position))
        order.append(home)
        occupied.update(PIECES[home])
        remaining.remove(home)
    return tuple(order)


HOME_ORDER = _home_order()


def _corner_state(path):
    by_current = {candidate.current_position: candidate for candidate in path if len(candidate.placements) == 3}
    cp = []
    co = []
    for current_index, current_position in enumerate(CORNER_COORDS):
        candidate = by_current[current_position]
        cp.append(CORNER_INDEX[candidate.home_position])
        by_source_face = {
            facelet_parts(placement.source_facelet, SIZE)[0]: placement.target_face
            for placement in candidate.placements
        }
        labels = [by_source_face[FACE_INDEX[face_name]] for face_name in CORNER_HOME[current_index]]
        try:
            twist = next(i for i, face in enumerate(labels) if FACE_NAMES[face] in ("U", "D"))
        except StopIteration as exc:
            raise ValueError("Invalid reconstructed corner orientation") from exc
        co.append(twist)
    return tuple(cp), tuple(co)


def _mapping_from_path(path):
    return {candidate.current_position: candidate.home_position for candidate in path}


def _state_from_path(path):
    out = ["?"] * (6 * SIZE * SIZE)
    for candidate in path:
        for placement in candidate.placements:
            out[placement.source_facelet] = FACE_NAMES[placement.target_face]
    if "?" in out:
        raise ValueError("Incomplete 4x4 reconstruction")
    return "".join(out)


def _legal_path(path) -> bool:
    mapping = _mapping_from_path(path)
    cp, co = _corner_state(path)
    if cp[ANCHOR] != ANCHOR or co[ANCHOR] != 0:
        return False
    if len(set(cp)) != 8 or sum(co) % 3:
        return False
    return _permutation_parity(mapping, CENTRES) == _permutation_parity(mapping, CORNERS)


def reconstruct_4x4(raw: bytes, tile_size: int) -> dict:
    bank = TileBank(raw, tile_size, 96)
    anchor_occupancy = _install(ANCHOR_CANDIDATE, {})
    anchor_bit = 1 << POSITION_INDEX[ANCHOR_POSITION]
    beam = [(0.0, anchor_bit, (ANCHOR_CANDIDATE,), anchor_occupancy)]
    beam_width = 512
    local_keep = 10

    for home in HOME_ORDER:
        piece_size = len(PIECES[home])
        generated = []
        serial = 0
        for score, used, path, occupancy in beam:
            local = []
            for current in POSITIONS:
                bit = 1 << POSITION_INDEX[current]
                if used & bit or len(PIECES[current]) != piece_size:
                    continue
                for candidate in legal_candidates_for_piece(current, home, SIZE):
                    increment = _incremental_score(bank, candidate, occupancy)
                    local.append((increment, candidate, bit))
            for increment, candidate, bit in heapq.nlargest(local_keep, local, key=lambda item: item[0]):
                generated.append((
                    score + increment,
                    serial,
                    used | bit,
                    path + (candidate,),
                    _install(candidate, occupancy),
                ))
                serial += 1
        if not generated:
            raise ValueError("Could not assemble the 4x4 picture")
        best = heapq.nlargest(beam_width, generated, key=lambda item: item[0])
        beam = [(score, used, path, occupancy) for score, _, used, path, occupancy in best]

    legal = []
    for score, _, path, _ in sorted(beam, key=lambda item: item[0], reverse=True):
        if not _legal_path(path):
            continue
        cp, co = _corner_state(path)
        legal.append((score, path, cp, co))
        if len(legal) >= 16:
            break
    if not legal:
        raise ValueError("Could not reconstruct a legal 4x4 state. Retake the scan and try again.")

    score, path, cp, co = legal[0]
    gap = 0.0 if len(legal) < 2 else max(0.0, score - legal[1][0])
    confidence = max(0.05, min(0.99, 0.55 + gap * 12.0 / 144.0))
    mapping = _mapping_from_path(path)
    return {
        "state": _state_from_path(path),
        "cp": list(cp),
        "co": list(co),
        "mapping": [[list(position), list(mapping[position])] for position in POSITIONS],
        "score": score,
        "confidence": confidence,
    }


@lru_cache(maxsize=None)
def _setup_map(kind: str):
    if kind == "wing":
        support = WING_SUPPORT
    elif kind == "centre":
        support = CENTRE_SUPPORT
    else:
        raise ValueError(kind)
    start = tuple(support)
    queue = deque([start])
    setup = {start: ()}
    while queue:
        triple = queue.popleft()
        prefix = setup[triple]
        for token in SETUP_GENERATORS:
            nxt = tuple(move_position(position, SIZE, token) for position in triple)
            if nxt not in setup:
                setup[nxt] = prefix + (token,)
                queue.append(nxt)
    return setup


def _cycle_algorithm(kind: str, desired):
    if kind == "wing":
        base = WING_BASE
    elif kind == "centre":
        base = CENTRE_BASE
    else:
        raise ValueError(kind)
    setup = _setup_map(kind).get(tuple(desired))
    if setup is None:
        raise RuntimeError(f"No {kind} 3-cycle conjugate for {desired}")
    # If S maps the base support to the requested ordered triple, S^-1 B S
    # has exactly the requested position cycle under our left-to-right notation.
    return _inverse_moves(setup) + base + setup


def _solve_even_permutation(mapping, positions, kind: str):
    out = mapping
    moves = []
    while True:
        unsolved = [position for position in positions if out[position] != position]
        if not unsolved:
            return out, moves
        if len(unsolved) == 2:
            raise ValueError(f"Odd {kind} permutation remained after parity handling")
        target = unsolved[0]
        source = next(position for position in unsolved if out[position] == target)
        third = next(position for position in unsolved if position not in (target, source))
        cycle = (source, target, third)
        algorithm = _cycle_algorithm(kind, cycle)
        out = _apply_mapping_moves(out, algorithm)
        moves.extend(algorithm)


def _mapping_from_json(data):
    return {tuple(current): tuple(home) for current, home in data}


def solve_reconstruction_4x4(reconstruction: dict) -> dict:
    mapping = _mapping_from_json(reconstruction["mapping"])
    moves = []

    # 1. Corners. U/R/F do not move the DBL anchor, matching the 2x2 solver.
    corner_moves = solve_2x2(tuple(reconstruction["cp"]), tuple(reconstruction["co"]))
    mapping = _apply_mapping_moves(mapping, corner_moves)
    moves.extend(corner_moves)
    if any(mapping[position] != position for position in CORNERS):
        raise RuntimeError("4x4 corner phase did not solve the corner permutation")

    # 2. Exact wings. Odd wing parity is independent on an even-layer cube;
    # the parity sequence fixes that before pure wing 3-cycles are used.
    if _permutation_parity(mapping, WINGS):
        mapping = _apply_mapping_moves(mapping, WING_PARITY)
        moves.extend(WING_PARITY)
    if _permutation_parity(mapping, WINGS):
        raise RuntimeError("4x4 wing parity algorithm did not toggle wing parity")
    mapping, wing_moves = _solve_even_permutation(mapping, WINGS, "wing")
    moves.extend(wing_moves)

    # 3. Exact centres. With corners solved, centre permutation is even. The
    # centre commutator leaves both corners and wings untouched.
    if _permutation_parity(mapping, CENTRES):
        raise RuntimeError("Illegal 4x4 centre parity after corner/wing phases")
    mapping, centre_moves = _solve_even_permutation(mapping, CENTRES, "centre")
    moves.extend(centre_moves)

    if any(mapping[position] != position for position in POSITIONS):
        raise RuntimeError("4x4 exact-piece solver finished with unsolved pieces")

    moves = _simplify_moves(moves)
    return {
        **reconstruction,
        "moves": moves,
        "solution": " ".join(moves),
        "move_count": len(moves),
        "cubie_move_count": len(corner_moves),
        "wing_move_count": len(wing_moves),
        "centre_move_count": len(centre_moves),
    }


def solve_scan_4x4(raw: bytes, tile_size: int) -> dict:
    return solve_reconstruction_4x4(reconstruct_4x4(raw, tile_size))
