from __future__ import annotations

from array import array
import base64
import math
import sys
from functools import lru_cache

from .geometry import SIDES

_SIDE_INDEX = {"N": 0, "E": 1, "S": 2, "W": 3}
_ACTIVE_EVIDENCE = None


def set_visual_evidence(evidence) -> None:
    global _ACTIVE_EVIDENCE
    _ACTIVE_EVIDENCE = evidence


def _decode_f32(encoded: str, expected: int):
    try:
        values = array("f")
        values.frombytes(base64.b64decode(encoded))
        if sys.byteorder != "little":
            values.byteswap()
    except Exception:
        return None
    return values if len(values) == expected else None


def _median(values):
    ordered = sorted(values)
    n = len(ordered)
    middle = n // 2
    return ordered[middle] if n % 2 else 0.5 * (ordered[middle - 1] + ordered[middle])


def _stats(values):
    values = tuple(max(0.0, min(1.0, float(v))) for v in values)
    mean = sum(values) / max(1, len(values))
    variance = sum((value - mean) ** 2 for value in values) / max(1, len(values))
    std = math.sqrt(max(variance, 1e-12))
    median = _median(values)
    best = max(values, default=0.0)
    spread = max(0.0, best - median)
    reliability = max(0.0, min(1.0, (spread - 0.010) / 0.10))
    return mean, std, reliability, values


class TileBank:
    """Rotation-aware sticker descriptors with glare-safe seam and source evidence."""

    def __init__(self, raw: bytes, size: int, tile_count: int = 54, evidence=None):
        expected = tile_count * size * size * 3
        if len(raw) != expected:
            raise ValueError(f"Expected {expected} RGB bytes, got {len(raw)}")
        self.raw = raw
        self.size = size
        self.tile_count = tile_count
        self._profiles: dict[tuple[int, int, str], tuple[tuple[float, float, float, float, float], ...]] = {}
        self._states = tile_count * 4
        active = _ACTIVE_EVIDENCE if evidence is None else evidence
        self._external = self._decode_seam_evidence(active)
        self._absolute, self._reference_fit, self._reference_distinctiveness = self._decode_absolute_evidence(active)
        self._absolute_stats = self._build_absolute_stats()
        self._target_stats = self._build_target_stats()
        for tile in range(tile_count):
            for rot in range(4):
                for side in SIDES:
                    self._profiles[(tile, rot, side)] = self._make_profile(tile, rot, side)

    @property
    def has_reference(self) -> bool:
        return self._absolute is not None

    @property
    def reference_fit(self) -> float:
        return self._reference_fit

    @property
    def reference_distinctiveness(self) -> float:
        return self._reference_distinctiveness

    def _decode_seam_evidence(self, evidence):
        if not isinstance(evidence, dict):
            return None
        if int(evidence.get("version", 0)) not in (1, 2):
            return None
        if int(evidence.get("states", 0)) != self._states:
            return None
        encoded = evidence.get("seam_f32_b64")
        if not isinstance(encoded, str) or not encoded:
            return None
        return _decode_f32(encoded, 4 * self._states * self._states)

    def _decode_absolute_evidence(self, evidence):
        if not isinstance(evidence, dict):
            return None, 0.0, 0.0
        reference = evidence.get("reference_evidence")
        if not isinstance(reference, dict):
            return None, 0.0, 0.0
        if int(reference.get("version", 0)) not in (1, 2):
            return None, 0.0, 0.0
        targets = int(reference.get("targets", 0))
        states = int(reference.get("states", 0))
        if targets != self.tile_count or states != self._states:
            return None, 0.0, 0.0
        encoded = reference.get("absolute_f32_b64")
        if not isinstance(encoded, str) or not encoded:
            return None, 0.0, 0.0
        values = _decode_f32(encoded, self._states * self.tile_count)
        if values is None:
            return None, 0.0, 0.0
        fit = max(0.0, min(1.0, float(reference.get("fit", 0.0) or 0.0)))
        distinctiveness = max(0.0, min(1.0, float(reference.get("distinctiveness", 0.0) or 0.0)))
        return values, fit, distinctiveness

    def _build_absolute_stats(self):
        if self._absolute is None:
            return None
        stats = []
        n = self.tile_count
        for state in range(self._states):
            start = state * n
            stats.append(_stats(self._absolute[start:start + n]))
        return tuple(stats)

    def _build_target_stats(self):
        if self._absolute is None:
            return None
        out = []
        n = self.tile_count
        for target in range(n):
            values = []
            for tile in range(n):
                values.append(max(
                    float(self._absolute[(tile * 4 + rot) * n + target])
                    for rot in range(4)
                ))
            out.append(_stats(values))
        return tuple(out)

    @staticmethod
    def _glare_weight(r: float, g: float, b: float) -> float:
        hi = max(r, g, b) / 255.0
        lo = min(r, g, b) / 255.0
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        saturation = (hi - lo) / max(hi, 1e-6)
        clipped = max(0.0, min(1.0, (hi - 0.90) / 0.10))
        white_specular = max(0.0, min(1.0, (lum - 0.72) / 0.24)) * max(0.0, min(1.0, (0.24 - saturation) / 0.24))
        glare = max(clipped * 0.85, white_specular)
        return max(0.05, 1.0 - 0.95 * glare)

    def _rgb_rot(self, tile: int, x: int, y: int, rot: int) -> tuple[int, int, int]:
        n = self.size
        rot %= 4
        if rot == 0:
            ox, oy = x, y
        elif rot == 1:
            ox, oy = y, n - 1 - x
        elif rot == 2:
            ox, oy = n - 1 - x, n - 1 - y
        else:
            ox, oy = n - 1 - y, x
        offset = ((tile * n * n) + oy * n + ox) * 3
        return self.raw[offset], self.raw[offset + 1], self.raw[offset + 2]

    def _make_profile(self, tile: int, rot: int, side: str) -> tuple[tuple[float, float, float, float, float], ...]:
        n = self.size
        trim = max(2, n // 9)
        depth0 = max(2, n // 10)
        depth_count = max(2, n // 14)
        samples = 18
        out = []
        for i in range(samples):
            t = trim + (n - 1 - 2 * trim) * (i + 0.5) / samples
            accum = [0.0, 0.0, 0.0]
            weight_sum = 0.0
            raw_weight_sum = 0.0
            for d in range(depth0, depth0 + depth_count):
                if side == "N":
                    x, y = int(t), d
                elif side == "S":
                    x, y = int(t), n - 1 - d
                elif side == "W":
                    x, y = d, int(t)
                else:
                    x, y = n - 1 - d, int(t)
                r, g, b = self._rgb_rot(tile, x, y, rot)
                weight = self._glare_weight(r, g, b)
                accum[0] += r * weight
                accum[1] += g * weight
                accum[2] += b * weight
                weight_sum += weight
                raw_weight_sum += 1.0
            denom = max(weight_sum, 1e-6)
            r, g, b = (v / denom for v in accum)
            total = r + g + b + 1e-6
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            reliability = weight_sum / max(raw_weight_sum, 1.0)
            out.append((r / total, g / total, b / total, lum, reliability))
        return tuple(out)

    def seam_reliability(self, tile: int, rot: int, side: str) -> float:
        profile = self._profiles[(tile, rot % 4, side)]
        return sum(item[4] for item in profile) / max(1, len(profile))

    def external_compatibility(self, a: int, ar: int, aside: str, b: int, br: int, bside: str) -> float | None:
        if self._external is None:
            return None
        if aside not in _SIDE_INDEX or bside not in _SIDE_INDEX:
            return None
        astate = a * 4 + (ar % 4)
        bstate = b * 4 + (br % 4)
        n = self._states
        direct = self._external[_SIDE_INDEX[aside] * n * n + astate * n + bstate]
        reverse = self._external[_SIDE_INDEX[bside] * n * n + bstate * n + astate]
        values = [float(x) for x in (direct, reverse) if math.isfinite(float(x)) and float(x) >= 0.0]
        if not values:
            return None
        return max(0.0, min(1.0, sum(values) / len(values)))

    def absolute_compatibility(self, tile: int, rot: int, target_facelet: int) -> float | None:
        if self._absolute is None:
            return None
        if not (0 <= tile < self.tile_count and 0 <= target_facelet < self.tile_count):
            return None
        state = tile * 4 + (rot % 4)
        value = float(self._absolute[state * self.tile_count + target_facelet])
        if not math.isfinite(value):
            return None
        return max(0.0, min(1.0, value))

    def placement_percentile(self, tile: int, rot: int, target_facelet: int) -> float | None:
        value = self.absolute_compatibility(tile, rot, target_facelet)
        if value is None or self._absolute_stats is None:
            return None
        state = tile * 4 + (rot % 4)
        row = self._absolute_stats[state][3]
        below = sum(1 for item in row if item < value)
        equal = sum(1 for item in row if abs(item - value) <= 1e-7)
        return max(0.0, min(1.0, (below + 0.5 * equal) / len(row)))

    def target_percentile(self, tile: int, rot: int, target_facelet: int) -> float | None:
        value = self.absolute_compatibility(tile, rot, target_facelet)
        if value is None or self._target_stats is None:
            return None
        candidates = self._target_stats[target_facelet][3]
        below = sum(1 for item in candidates if item < value)
        equal = sum(1 for item in candidates if abs(item - value) <= 1e-7)
        return max(0.0, min(1.0, (below + 0.5 * equal) / len(candidates)))

    def placement_score(self, tile: int, rot: int, target_facelet: int) -> float:
        """Source-first evidence for one exact sticker destination.

        The score is bidirectional: the destination must be unusually good for
        this sticker, and this sticker must be unusually good for the destination.
        This suppresses common ocean/sky patches while strongly rewarding a
        coastline, border, text fragment, or other distinctive source location.
        """
        value = self.absolute_compatibility(tile, rot, target_facelet)
        if value is None or self._absolute_stats is None or self._target_stats is None:
            return 0.0
        state = tile * 4 + (rot % 4)
        row_mean, row_std, row_reliability, _ = self._absolute_stats[state]
        col_mean, col_std, col_reliability, _ = self._target_stats[target_facelet]
        row_percentile = self.placement_percentile(tile, rot, target_facelet)
        col_percentile = self.target_percentile(tile, rot, target_facelet)
        if row_percentile is None or col_percentile is None:
            return 0.0

        row_z = math.tanh(((value - row_mean) / max(0.018, row_std)) / 1.45)
        col_z = math.tanh(((value - col_mean) / max(0.018, col_std)) / 1.45)
        row_rank = 2.0 * row_percentile - 1.0
        col_rank = 2.0 * col_percentile - 1.0
        reliability = math.sqrt(max(0.0, row_reliability * col_reliability))
        # A selected source is the solved-picture target, not merely a weak hint.
        # Overall fit mostly reflects lighting, glare and projection imperfections.
        reference_confidence = 0.72 + 0.28 * self._reference_fit
        signal = 0.30 * row_z + 0.24 * col_z + 0.24 * row_rank + 0.22 * col_rank
        return 1.40 * reference_confidence * reliability * signal

    @lru_cache(maxsize=262144)
    def compatibility(self, a: int, ar: int, aside: str, b: int, br: int, bside: str) -> float:
        pa = self._profiles[(a, ar % 4, aside)]
        pb = self._profiles[(b, br % 4, bside)]
        weights = [math.sqrt(max(0.0, x[4] * y[4])) for x, y in zip(pa, pb)]
        weight_sum = max(sum(weights), 1e-6)
        ma = sum(x[3] * w for x, w in zip(pa, weights)) / weight_sum
        mb = sum(y[3] * w for y, w in zip(pb, weights)) / weight_sum
        err = 0.0
        for x, y, weight in zip(pa, pb, weights):
            err += weight * 2.2 * ((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2)
            err += weight * 0.8 * (((x[3] - ma) - (y[3] - mb)) ** 2)
        mse = err / weight_sum
        base = -math.sqrt(max(mse, 1e-12))
        learned = self.external_compatibility(a, ar, aside, b, br, bside)
        if learned is None:
            return base
        seam_reliability = math.sqrt(self.seam_reliability(a, ar, aside) * self.seam_reliability(b, br, bside))
        return base + 0.10 * seam_reliability * (2.0 * learned - 1.0)
