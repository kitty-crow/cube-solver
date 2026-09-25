from __future__ import annotations

import math
import statistics

from .geometry import CENTER_FACELET, CORNER_GEOM, EDGE_GEOM, FACE_INDEX, FACE_NAMES
from .reconstruct import _facelet_string, _inversion_increment


def _srgb_to_linear(value: float) -> float:
    value = max(0.0, min(1.0, value / 255.0))
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def _rgb_to_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = (_srgb_to_linear(channel) for channel in rgb)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    delta = 6.0 / 29.0

    def f(value: float) -> float:
        if value > delta ** 3:
            return value ** (1.0 / 3.0)
        return value / (3.0 * delta * delta) + 4.0 / 29.0

    fx, fy, fz = f(x), f(y), f(z)
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


def _lab_distance(a, b) -> float:
    # CIE76 is deliberately used here. Solid cube colours are widely separated,
    # and the legal-cubie optimisation below is more important than a heavier
    # perceptual metric in Pyodide.
    return math.sqrt(sum((float(a[i]) - float(b[i])) ** 2 for i in range(3)))


def _tile_rgb(raw: bytes, tile_size: int, tile: int) -> tuple[float, float, float]:
    pixels = tile_size * tile_size
    start = tile * pixels * 3
    inset = max(1, int(tile_size * 0.16))
    channels = ([], [], [])
    for y in range(inset, tile_size - inset):
        row = start + y * tile_size * 3
        for x in range(inset, tile_size - inset):
            offset = row + x * 3
            channels[0].append(raw[offset])
            channels[1].append(raw[offset + 1])
            channels[2].append(raw[offset + 2])
    if not channels[0]:
        raise ValueError("Solid-colour scan tile contained no pixels")
    return tuple(float(statistics.median(channel)) for channel in channels)


def _representatives(raw: bytes, tile_size: int) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]]]:
    expected = 54 * tile_size * tile_size * 3
    if len(raw) != expected:
        raise ValueError(f"Expected {expected} RGB bytes for a 3×3 scan, got {len(raw)}")
    rgb = [_tile_rgb(raw, tile_size, tile) for tile in range(54)]
    lab = [_rgb_to_lab(value) for value in rgb]
    return rgb, lab


def _colour_costs(lab) -> list[list[float]]:
    # A 3×3 centre never moves between faces, so its photographed colour is the
    # canonical prototype for that face. This gives us exactly six colours,
    # regardless of their real-world names (white/yellow/etc.).
    prototypes = [lab[index] for index in CENTER_FACELET]
    return [[_lab_distance(value, prototype) for prototype in prototypes] for value in lab]


def _edge_candidate_cost(candidate, costs) -> float:
    return sum(costs[placement.tile][placement.target_face] for placement in candidate.placements)


def _corner_candidate_cost(candidate, costs) -> float:
    return sum(costs[placement.tile][placement.target_face] for placement in candidate.placements)


def _best_edges(costs):
    # Exact assignment over all 12 edge cubies. State tracks used home cubies,
    # total edge flip and permutation parity. One best colour-cost path per state
    # is sufficient because subsequent edge choices depend only on this state.
    dp = {(0, 0, 0): (0.0, ())}
    for current in range(12):
        nxt = {}
        for (mask, flip, parity), (score, path) in dp.items():
            for home in range(12):
                if mask & (1 << home):
                    continue
                inv = _inversion_increment(mask, home, 12)
                for candidate in EDGE_GEOM[current][home]:
                    key = (mask | (1 << home), flip ^ int(candidate.eo), parity ^ inv)
                    value = (score + _edge_candidate_cost(candidate, costs), path + (candidate,))
                    old = nxt.get(key)
                    if old is None or value[0] < old[0]:
                        nxt[key] = value
        dp = nxt
    full = (1 << 12) - 1
    return {parity: dp[(full, 0, parity)] for parity in (0, 1) if (full, 0, parity) in dp}


def _best_corners(costs):
    # Same exact assignment for corners, with corner twist mod 3 and parity.
    dp = {(0, 0, 0): (0.0, ())}
    for current in range(8):
        nxt = {}
        for (mask, twist, parity), (score, path) in dp.items():
            for home in range(8):
                if mask & (1 << home):
                    continue
                inv = _inversion_increment(mask, home, 8)
                for candidate in CORNER_GEOM[current][home]:
                    key = (mask | (1 << home), (twist + int(candidate.co)) % 3, parity ^ inv)
                    value = (score + _corner_candidate_cost(candidate, costs), path + (candidate,))
                    old = nxt.get(key)
                    if old is None or value[0] < old[0]:
                        nxt[key] = value
        dp = nxt
    full = (1 << 8) - 1
    return {parity: dp[(full, 0, parity)] for parity in (0, 1) if (full, 0, parity) in dp}


def _confidence(state: str, costs) -> tuple[float, float, float]:
    assigned = []
    margins = []
    centre_set = set(CENTER_FACELET)
    for tile, face_name in enumerate(state):
        if tile in centre_set:
            continue
        target = FACE_INDEX[face_name]
        row = sorted(float(value) for value in costs[tile])
        chosen = float(costs[tile][target])
        second = row[1] if len(row) > 1 else chosen
        assigned.append(chosen)
        margins.append(max(0.0, second - chosen))
    mean_cost = sum(assigned) / max(1, len(assigned))
    mean_margin = sum(margins) / max(1, len(margins))
    fit = math.exp(-mean_cost / 24.0)
    separation = 1.0 - math.exp(-mean_margin / 16.0)
    confidence = max(0.50, min(0.999, 0.62 * fit + 0.38 * separation))
    return confidence, mean_cost, mean_margin


def reconstruct_solid_colour_3x3(raw: bytes, tile_size: int) -> dict:
    """Reconstruct a 3×3 using only its six detected sticker colours.

    No image search, semantic model, seam model or reference artwork is used.
    Centre stickers define the six colour identities. The edge/corner assignment
    is then solved globally under the exact Rubik's-cube constraints, rather
    than independently classifying 48 stickers and hoping the result is legal.
    """
    rgb, lab = _representatives(raw, tile_size)
    costs = _colour_costs(lab)
    edges = _best_edges(costs)
    corners = _best_corners(costs)
    candidates = []
    for parity in (0, 1):
        if parity not in edges or parity not in corners:
            continue
        edge_cost, edge_path = edges[parity]
        corner_cost, corner_path = corners[parity]
        candidates.append((edge_cost + corner_cost, parity, edge_path, corner_path))
    if not candidates:
        raise ValueError("The six detected colours could not form a legal 3×3 cube")
    total_cost, parity, edge_path, corner_path = min(candidates, key=lambda item: item[0])
    state = _facelet_string(edge_path, corner_path)
    confidence, mean_cost, mean_margin = _confidence(state, costs)
    centres = {
        FACE_NAMES[face]: {
            "rgb": [round(channel, 1) for channel in rgb[CENTER_FACELET[face]]],
            "lab": [round(channel, 2) for channel in lab[CENTER_FACELET[face]]],
        }
        for face in range(6)
    }
    return {
        "state": state,
        "confidence": confidence,
        "colour_cost": float(total_cost),
        "mean_colour_distance": float(mean_cost),
        "mean_colour_margin": float(mean_margin),
        "parity": int(parity),
        "detected_colours": centres,
        "colour_count": 6,
        "method": "six-centre-colours+exact-cubie-constraints",
    }
