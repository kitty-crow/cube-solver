const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];

export function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0);
  return canvas;
}

export function rotateCanvas(source, quarters = 0) {
  const q = ((Number(quarters) % 4) + 4) % 4;
  if (!q) return cloneCanvas(source);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(q * Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function luminanceImage(source, resolution = 224) {
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.drawImage(source, 0, 0, resolution, resolution);
  const rgba = ctx.getImageData(0, 0, resolution, resolution).data;
  const lum = new Float32Array(resolution * resolution);
  for (let i = 0; i < lum.length; i += 1) {
    const o = i * 4;
    lum[i] = rgba[o] * 0.2126 + rgba[o + 1] * 0.7152 + rgba[o + 2] * 0.0722;
  }
  return { lum, n: resolution };
}

function verticalScore(image, x, y0, y1) {
  const { lum, n } = image;
  const ix = Math.max(2, Math.min(n - 3, Math.round(x)));
  const start = Math.max(1, Math.round(y0));
  const end = Math.min(n - 2, Math.round(y1));
  let edge = 0;
  let centre = 0;
  let side = 0;
  let count = 0;
  for (let y = start; y <= end; y += 2) {
    const row = y * n;
    const c = lum[row + ix];
    edge += Math.abs(lum[row + ix + 2] - lum[row + ix - 2]);
    centre += c;
    side += 0.5 * (lum[row + ix - 2] + lum[row + ix + 2]);
    count += 1;
  }
  if (!count) return -Infinity;
  return edge / count + Math.max(0, (side - centre) / count) * 0.34;
}

function horizontalScore(image, y, x0, x1) {
  const { lum, n } = image;
  const iy = Math.max(2, Math.min(n - 3, Math.round(y)));
  const start = Math.max(1, Math.round(x0));
  const end = Math.min(n - 2, Math.round(x1));
  let edge = 0;
  let centre = 0;
  let side = 0;
  let count = 0;
  for (let x = start; x <= end; x += 2) {
    const c = lum[iy * n + x];
    edge += Math.abs(lum[(iy + 2) * n + x] - lum[(iy - 2) * n + x]);
    centre += c;
    side += 0.5 * (lum[(iy - 2) * n + x] + lum[(iy + 2) * n + x]);
    count += 1;
  }
  if (!count) return -Infinity;
  return edge / count + Math.max(0, (side - centre) / count) * 0.34;
}

function bestNear(target, radius, minValue, maxValue, scorer) {
  const lo = Math.max(minValue, Math.floor(target - radius));
  const hi = Math.min(maxValue, Math.ceil(target + radius));
  let best = target;
  let bestScore = -Infinity;
  for (let value = lo; value <= hi; value += 1) {
    const distancePenalty = Math.abs(value - target) * 0.055;
    const score = scorer(value) - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }
  return best;
}

function lineSets(source, size) {
  const image = luminanceImage(source);
  const n = image.n;
  const topY = n * 0.28;
  const bottomY = n * 0.72;
  const leftX = n * 0.28;
  const rightX = n * 0.72;
  const cell = n / size;
  const vertical = [];
  const horizontal = [];

  for (let k = 0; k <= size; k += 1) {
    const edge = k === 0 || k === size;
    const target = edge ? (k === 0 ? n * 0.045 : n * 0.955) : n * k / size;
    const radius = edge ? n * 0.075 : cell * 0.24;
    const top = bestNear(target, radius, 2, n - 3, (x) => verticalScore(image, x, n * 0.08, n * 0.48));
    const bottom = bestNear(target, radius, 2, n - 3, (x) => verticalScore(image, x, n * 0.52, n * 0.92));
    const b = (bottom - top) / (bottomY - topY);
    vertical.push({ a: top - b * topY, b });

    const left = bestNear(target, radius, 2, n - 3, (y) => horizontalScore(image, y, n * 0.08, n * 0.48));
    const right = bestNear(target, radius, 2, n - 3, (y) => horizontalScore(image, y, n * 0.52, n * 0.92));
    const d = (right - left) / (rightX - leftX);
    horizontal.push({ c: left - d * leftX, d });
  }

  const intersection = (v, h) => {
    const denominator = 1 - v.b * h.d;
    const x = Math.abs(denominator) < 1e-5 ? v.a : (v.a + v.b * h.c) / denominator;
    const y = h.c + h.d * x;
    return {
      x: Math.max(0, Math.min(n - 1, x)) * source.width / n,
      y: Math.max(0, Math.min(n - 1, y)) * source.height / n,
    };
  };

  const points = Array.from({ length: size + 1 }, () => new Array(size + 1));
  for (let row = 0; row <= size; row += 1) {
    for (let col = 0; col <= size; col += 1) points[row][col] = intersection(vertical[col], horizontal[row]);
  }

  // Reject an obviously bad detection and fall back to a regular grid. This
  // makes rounded mode conservative rather than allowing one false edge to
  // corrupt the whole scan.
  const expected = Math.min(source.width, source.height) / size;
  let sane = true;
  for (let row = 0; row < size && sane; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const a = points[row][col];
      const b = points[row][col + 1];
      const c = points[row + 1][col];
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      const h = Math.hypot(c.x - a.x, c.y - a.y);
      if (w < expected * 0.42 || w > expected * 1.65 || h < expected * 0.42 || h > expected * 1.65) sane = false;
    }
  }
  if (sane) return points;

  return Array.from({ length: size + 1 }, (_, row) =>
    Array.from({ length: size + 1 }, (_, col) => ({
      x: source.width * (0.045 + 0.91 * col / size),
      y: source.height * (0.045 + 0.91 * row / size),
    })),
  );
}

function sourceImage(source) {
  const ctx = source.getContext("2d", { alpha: false, willReadFrequently: true });
  return ctx.getImageData(0, 0, source.width, source.height);
}

function bilinearPoint(p00, p10, p11, p01, u, v) {
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = u * v;
  const d = (1 - u) * v;
  return {
    x: p00.x * a + p10.x * b + p11.x * c + p01.x * d,
    y: p00.y * a + p10.y * b + p11.y * c + p01.y * d,
  };
}

function roundedUv(u, v, radius = 0.20) {
  let x = u;
  let y = v;
  const corners = [
    [radius, radius, u < radius && v < radius],
    [1 - radius, radius, u > 1 - radius && v < radius],
    [1 - radius, 1 - radius, u > 1 - radius && v > 1 - radius],
    [radius, 1 - radius, u < radius && v > 1 - radius],
  ];
  for (const [cx, cy, active] of corners) {
    if (!active) continue;
    const dx = u - cx;
    const dy = v - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > radius && dist > 0) {
      const scale = radius / dist;
      x = cx + dx * scale;
      y = cy + dy * scale;
    }
    break;
  }
  return [x, y];
}

function sampleRgba(image, x, y, out, offset) {
  const { data, width, height } = image;
  const sx = Math.max(0, Math.min(width - 1.001, x));
  const sy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = sx - x0;
  const fy = sy - y0;
  for (let channel = 0; channel < 3; channel += 1) {
    const a = data[(y0 * width + x0) * 4 + channel] * (1 - fx) + data[(y0 * width + x1) * 4 + channel] * fx;
    const b = data[(y1 * width + x0) * 4 + channel] * (1 - fx) + data[(y1 * width + x1) * 4 + channel] * fx;
    out[offset + channel] = Math.round(a * (1 - fy) + b * fy);
  }
  out[offset + 3] = 255;
}

function warpedTile(sourcePixels, corners, tileSize, rounded) {
  const canvas = document.createElement("canvas");
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const output = ctx.createImageData(tileSize, tileSize);
  const inset = rounded ? 0.075 : 0.052;
  const span = 1 - 2 * inset;
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      let u = (x + 0.5) / tileSize;
      let v = (y + 0.5) / tileSize;
      if (rounded) [u, v] = roundedUv(u, v);
      u = inset + u * span;
      v = inset + v * span;
      const p = bilinearPoint(corners[0], corners[1], corners[2], corners[3], u, v);
      sampleRgba(sourcePixels, p.x, p.y, output.data, (y * tileSize + x) * 4);
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

export function extractFaceTiles(faceCanvas, quarters, size, tileSize, rounded = false) {
  const source = rotateCanvas(faceCanvas, quarters);
  if (!rounded) {
    const tiles = [];
    const cell = source.width / size;
    const inset = cell * 0.055;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const tile = document.createElement("canvas");
        tile.width = tileSize;
        tile.height = tileSize;
        tile.getContext("2d", { alpha: false, willReadFrequently: true }).drawImage(
          source,
          col * cell + inset,
          row * cell + inset,
          cell - 2 * inset,
          cell - 2 * inset,
          0,
          0,
          tileSize,
          tileSize,
        );
        tiles.push(tile);
      }
    }
    return tiles;
  }

  const grid = lineSets(source, size);
  const pixels = sourceImage(source);
  const tiles = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      tiles.push(warpedTile(pixels, [
        grid[row][col],
        grid[row][col + 1],
        grid[row + 1][col + 1],
        grid[row + 1][col],
      ], tileSize, true));
    }
  }
  return tiles;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function buildPayloadFromCaptures(captures, rotations, size, tileSize, rounded = false) {
  const tiles = [];
  for (const face of FACE_ORDER) {
    const capture = captures.get(face);
    if (!capture) throw new Error(`Missing ${face} capture`);
    tiles.push(...extractFaceTiles(capture, rotations.get(face) || 0, size, tileSize, rounded));
  }
  const rgb = new Uint8Array(tiles.length * tileSize * tileSize * 3);
  let write = 0;
  for (const tile of tiles) {
    const data = tile.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, tileSize, tileSize).data;
    for (let p = 0; p < data.length; p += 4) {
      rgb[write++] = data[p];
      rgb[write++] = data[p + 1];
      rgb[write++] = data[p + 2];
    }
  }
  return {
    payload: { size: Number(size), tile_size: Number(tileSize), rounded_cubies: Boolean(rounded), rgb_b64: bytesToBase64(rgb) },
    tiles,
  };
}
