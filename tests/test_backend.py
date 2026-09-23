import math
import os
import random
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

from cube_backend import backend as b  # noqa: E402


class PictureCubeBackendTests(unittest.TestCase):
    TILE = 30

    @classmethod
    def setUpClass(cls):
        n = cls.TILE
        cls.solved_tiles = []
        for face in range(6):
            width = n * 3
            image = bytearray(width * width * 3)
            for y in range(width):
                for x in range(width):
                    r = int(max(0, min(255, 35 + face * 22 + 0.72 * x + 0.14 * y + 12 * math.sin(y / 12))))
                    g = int(max(0, min(255, 25 + face * 13 + 0.18 * x + 0.76 * y + 10 * math.sin(x / 11))))
                    blue = int(max(0, min(255, 55 + face * 11 + 0.31 * x + 0.33 * y + 8 * math.sin((x + y) / 14))))
                    offset = (y * width + x) * 3
                    image[offset:offset + 3] = bytes((r, g, blue))
            for row in range(3):
                for col in range(3):
                    tile = bytearray(n * n * 3)
                    for y in range(n):
                        src = ((row * n + y) * width + col * n) * 3
                        dst = y * n * 3
                        tile[dst:dst + n * 3] = image[src:src + n * 3]
                    cls.solved_tiles.append(bytes(tile))

    @staticmethod
    def add(a, c):
        return tuple(a[i] + c[i] for i in range(3))

    @staticmethod
    def mul(a, k):
        return tuple(a[i] * k for i in range(3))

    @staticmethod
    def dot(a, c):
        return sum(a[i] * c[i] for i in range(3))

    @staticmethod
    def cross(a, c):
        return (
            a[1] * c[2] - a[2] * c[1],
            a[2] * c[0] - a[0] * c[2],
            a[0] * c[1] - a[1] * c[0],
        )

    def rot90(self, vector, axis, quarters):
        out = vector
        for _ in range(quarters % 4):
            out = self.add(self.cross(axis, out), self.mul(axis, self.dot(axis, out)))
        return out

    def rotate_tile(self, raw, quarters):
        n = self.TILE
        out = bytearray(n * n * 3)
        for y in range(n):
            for x in range(n):
                q = quarters % 4
                if q == 0:
                    ox, oy = x, y
                elif q == 1:
                    ox, oy = y, n - 1 - x
                elif q == 2:
                    ox, oy = n - 1 - x, n - 1 - y
                else:
                    ox, oy = n - 1 - y, x
                src = (oy * n + ox) * 3
                dst = (y * n + x) * 3
                out[dst:dst + 3] = raw[src:src + 3]
        return bytes(out)

    def simulated_scan(self, algorithm):
        stickers = []
        for face in range(6):
            normal = b.FACE_NORMAL[face]
            right = b.FACE_RIGHT[face]
            up = b.FACE_UP[face]
            for local in range(9):
                row, col = divmod(local, 3)
                position = self.add(normal, self.add(self.mul(right, col - 1), self.mul(up, 1 - row)))
                stickers.append([face * 9 + local, position, normal, up])

        for token in algorithm.split():
            face = b.FACE_INDEX[token[0]]
            amount = 2 if token.endswith("2") else (-1 if token.endswith("'") else 1)
            quarters = (-amount) % 4
            axis = b.FACE_NORMAL[face]
            for sticker in stickers:
                if self.dot(sticker[1], axis) == 1:
                    sticker[1] = self.rot90(sticker[1], axis, quarters)
                    sticker[2] = self.rot90(sticker[2], axis, quarters)
                    sticker[3] = self.rot90(sticker[3], axis, quarters)

        current = [None] * 54
        state = ["?"] * 54
        centre_rotations = [0] * 6
        for tile_id, position, normal, transformed_up in stickers:
            face = b.FACE_NORMAL.index(normal)
            right = b.FACE_RIGHT[face]
            up = b.FACE_UP[face]
            col = self.dot(position, right) + 1
            row = 1 - self.dot(position, up)
            current_idx = face * 9 + row * 3 + col
            if transformed_up == up:
                q = 0
            elif transformed_up == right:
                q = 1
            elif transformed_up == tuple(-x for x in up):
                q = 2
            else:
                q = 3
            current[current_idx] = self.rotate_tile(self.solved_tiles[tile_id], q)
            state[current_idx] = b.FACE_NAMES[tile_id // 9]
            if tile_id % 9 == 4:
                centre_rotations[face] = (-q) % 4
        return b"".join(current), "".join(state), centre_rotations

    def test_geometry_candidate_counts(self):
        self.assertEqual({len(x) for row in b.EDGE_GEOM for x in row}, {2})
        self.assertEqual({len(x) for row in b.CORNER_GEOM for x in row}, {3})
        self.assertEqual(len(b.CUBE_ROTATIONS), 24)

    def test_reconstructs_solved_picture(self):
        raw, state, centres = self.simulated_scan("")
        reconstructed = b.reconstruct(raw, self.TILE)
        self.assertEqual(reconstructed["state"], state)
        self.assertEqual(reconstructed["center_rotations"], centres)

    def test_reconstructs_scrambled_picture_and_centres(self):
        raw, state, centres = self.simulated_scan("R U F2 L' D B R2 U'")
        reconstructed = b.reconstruct(raw, self.TILE)
        self.assertEqual(reconstructed["state"], state)
        self.assertEqual(reconstructed["center_rotations"], centres)

    def test_reconstructs_deterministic_random_scrambles(self):
        rng = random.Random(17)
        faces = list("URFDLB")
        suffixes = ["", "'", "2"]
        previous = None
        for _ in range(3):
            moves = []
            for _ in range(12):
                choices = [f for f in faces if f != previous]
                face = rng.choice(choices)
                previous = face
                moves.append(face + rng.choice(suffixes))
            raw, state, centres = self.simulated_scan(" ".join(moves))
            reconstructed = b.reconstruct(raw, self.TILE)
            self.assertEqual(reconstructed["state"], state)
            self.assertEqual(reconstructed["center_rotations"], centres)


if __name__ == "__main__":
    unittest.main()
