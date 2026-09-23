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


class TileBank:
    """Rotation-aware sticker descriptors with seam and absolute reference evidence."""

    def __init__(self, raw: bytes, size: int, tile_count: int = 54, evidence=None):
        expected = tile_count * size * size * 3
        if len(raw) != expected:
            raise ValueError(f"Expected {expected} RGB bytes, got {len(raw)}")
        self.raw = raw
        self.size = size
        self.tile_count = tile_count
        self._profiles: dict[tuple[int, int, str], tuple[tuple[float, float, float, float], ...]] = {}
        self._states = tile_count * 4
        active = _ACTIVE_EVIDENCE if evidence is None else evidence
        self._external = self._decode_seam_evidence(active)
        self._absolute, self._reference_fit = self._decode_absolute_evidence(active)
        self._absolute_stats = self._build_absolute_stats()
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

    def _decode_seam_evidence(self, evidence):
        if not isinstance(evidence, dict):
            return None
        if int(evidence.get("version", 0)) != 1:
            return None
        if int(evidence.get("states", 0)) != self._states:
            return None
        encoded = evidence.get("seam_f32_b64")
        if not isinstance(encoded, str) or not encoded:
            return None
        return _decode_f32(encoded, 4 * self._states * self._states)

    def _decode_absolute_evidence(self, evidence):
        if not isinstance(evidence, dict):
            return None, 0.0
        reference = evidence.get("reference_evidence")
        if not isinstance(reference, dict):
            return None, 0.0
        if int(reference.get("version", 0)) != 1:
            return None, 0.0
        targets = int(reference.get("targets", 0))
        states = int(reference.get("states", 0))
        if targets != self.tile_count or states != self._states:
            return None, 0.0
        encoded = reference.get("absolute_f32_b64")
        if not isinstance(encoded, str) or not encoded:
            return None, 0.0
        values = _decode_f32(encoded, self._states * self.tile_count)
        if values is None:
            return None, 0.0
        fit = float(reference.get("fit", 0.0) or 0.0)
        return values, max(0.0, min(1.0, fit))

    def _build_absolute_stats(self):
        if self._absolute is None:
            return None
        stats = []
        n = self.tile_count
        for state in range(self._states):
            start = state * n
            row = [max(0.0, min(1.0, float(self._absolute[start + target]))) for target in range(n)]
            mean = sum(row) / n
            variance = sum((value - mean) ** 2 for value in row) / n
            std = math.sqrt(max(variance, 1e-12))
            ordered = sorted(row)
            middle = n // 2
            median = ordered[middle] if n % 2 else 0.5 * (ordered[middle - 1] + ordered[middle])
            best = ordered[-1]
            # Generic references often make every ocean/sky tile score around
            # 0.95. Such a row is not useful absolute-position evidence even
            # though its raw cosine score looks excellent. Only reward a state
            # when the reference actually distinguishes some destinations.
            spread = max(0.0, best - median)
            reliability = max(0.0, min(1.0, (spread - 0.012) / 0.11))
            stats.append((mean, std, reliability, tuple(row)))
        return tuple(stats)

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

    def _make_profile(self, tile: int, rot: int, side: str) -> tuple[tuple[float, float, float, float], ...]:
        n = self.size
        trim = max(2, n // 9)
        depth0 = max(2, n // 10)
        depth_count = max(2, n // 14)
        samples = 18
        out = []
        for i in range(samples):
            t = trim + (n - 1 - 2 * trim) * (i + 0.5) / samples
            accum = [0.0, 0.0, 0.0]
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
                accum[0] += r
                accum[1] += g
                accum[2] += b
            r, g, b = (v / depth_count for v in accum)
            total = r + g + b + 1e-6
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            out.append((r / total, g / total, b / total, lum))
        return tuple(out)

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

    def placement_score(self, tile: int, rot: int, target_facelet: int) -> float:
        """Discriminative absolute-position evidence for one sticker.

        Raw reference similarity is deliberately not enough. A uniform ocean
        sticker can have a 0.98 cosine match to dozens of ocean positions. The
        score therefore asks whether this destination is unusually good for
        this exact sticker state, and suppresses flat/ambiguous rows.
        """
        value = self.absolute_compatibility(tile, rot, target_facelet)
        if value is None or self._absolute_stats is None:
            return 0.0
        state = tile * 4 + (rot % 4)
        mean, std, reliability, _ = self._absolute_stats[state]
        if reliability <= 0.0:
            return 0.0
        percentile = self.placement_percentile(tile, rot, target_facelet)
        if percentile is None:
            return 0.0
        z = (value - mean) / max(0.022, std)
        z_signal = math.tanh(z / 1.6)
        rank_signal = 2.0 * percentile - 1.0
        reference_confidence = max(0.0, min(1.0, (self._reference_fit - 0.35) / 0.40))
        signal = 0.62 * z_signal + 0.38 * rank_signal
        return 0.72 * reference_confidence * reliability * signal

    @lru_cache(maxsize=262144)
    def compatibility(self, a: int, ar: int, aside: str, b: int, br: int, bside: str) -> float:
        pa = self._profiles[(a, ar % 4, aside)]
        pb = self._profiles[(b, br % 4, bside)]
        ma = sum(x[3] for x in pa) / len(pa)
        mb = sum(x[3] for x in pb) / len(pb)
        err = 0.0
        for x, y in zip(pa, pb):
            err += 2.2 * ((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2)
            err += 0.8 * (((x[3] - ma) - (y[3] - mb)) ** 2)
        mse = err / len(pa)
        base = -math.sqrt(max(mse, 1e-12))
        learned = self.external_compatibility(a, ar, aside, b, br, bside)
        if learned is None:
            return base
        return base + 0.10 * (2.0 * learned - 1.0)
