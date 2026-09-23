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


class TileBank:
    """Rotation-aware sticker descriptors with optional ensemble seam evidence."""

    def __init__(self, raw: bytes, size: int, tile_count: int = 54, evidence=None):
        expected = tile_count * size * size * 3
        if len(raw) != expected:
            raise ValueError(f"Expected {expected} RGB bytes, got {len(raw)}")
        self.raw = raw
        self.size = size
        self.tile_count = tile_count
        self._profiles: dict[tuple[int, int, str], tuple[tuple[float, float, float, float], ...]] = {}
        self._states = tile_count * 4
        self._external = self._decode_evidence(_ACTIVE_EVIDENCE if evidence is None else evidence)
        for tile in range(tile_count):
            for rot in range(4):
                for side in SIDES:
                    self._profiles[(tile, rot, side)] = self._make_profile(tile, rot, side)

    def _decode_evidence(self, evidence):
        if not isinstance(evidence, dict):
            return None
        if int(evidence.get("version", 0)) != 1:
            return None
        if int(evidence.get("states", 0)) != self._states:
            return None
        encoded = evidence.get("seam_f32_b64")
        if not isinstance(encoded, str) or not encoded:
            return None
        try:
            values = array("f")
            values.frombytes(base64.b64decode(encoded))
            if sys.byteorder != "little":
                values.byteswap()
        except Exception:
            return None
        expected = 4 * self._states * self._states
        if len(values) != expected:
            return None
        return values

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
        # The deterministic border metric remains the anchor. Ensemble evidence
        # can strongly break visually ambiguous ties without overriding geometry.
        return base + 0.10 * (2.0 * learned - 1.0)
