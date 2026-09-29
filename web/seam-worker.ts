const SIDES = ["N", "E", "S", "W"];

function rotateCoord(x, y, n, rot) {
  const q = ((rot % 4) + 4) % 4;
  if (q === 0) return [x, y];
  if (q === 1) return [y, n - 1 - x];
  if (q === 2) return [n - 1 - x, n - 1 - y];
  return [n - 1 - y, x];
}

function pixel(raw, tile, n, x, y, rot) {
  const [ox, oy] = rotateCoord(x, y, n, rot);
  const off = ((tile * n * n) + oy * n + ox) * 3;
  return [raw[off], raw[off + 1], raw[off + 2]];
}

function sample(raw, tile, n, rot, side, t, depth) {
  const trim = Math.max(2, Math.floor(n / 10));
  const p = trim + (n - 1 - 2 * trim) * t;
  let x;
  let y;
  if (side === "N") { x = p; y = depth; }
  else if (side === "S") { x = p; y = n - 1 - depth; }
  else if (side === "W") { x = depth; y = p; }
  else { x = n - 1 - depth; y = p; }
  return pixel(raw, tile, n, Math.max(0, Math.min(n - 1, Math.round(x))), Math.max(0, Math.min(n - 1, Math.round(y))), rot);
}

function lum(rgb) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function descriptor(raw, tile, n, rot, side) {
  const samples = 20;
  const depth = Math.max(2, Math.floor(n / 12));
  const out = new Float32Array(samples * 8);
  for (let i = 0; i < samples; i += 1) {
    const t = (i + 0.5) / samples;
    const a = sample(raw, tile, n, rot, side, t, depth);
    const b = sample(raw, tile, n, rot, side, t, depth + 1);
    const t0 = Math.max(0, t - 1 / samples);
    const t1 = Math.min(1, t + 1 / samples);
    const c0 = sample(raw, tile, n, rot, side, t0, depth);
    const c1 = sample(raw, tile, n, rot, side, t1, depth);
    const total = a[0] + a[1] + a[2] + 1e-6;
    const l = lum(a);
    const normalGrad = lum(b) - l;
    const tangentGrad = (lum(c1) - lum(c0)) * 0.5;
    const chromaRange = (Math.max(...a) - Math.min(...a)) / 255;
    const o = i * 8;
    out[o] = a[0] / total;
    out[o + 1] = a[1] / total;
    out[o + 2] = a[2] / total;
    out[o + 3] = l;
    out[o + 4] = normalGrad;
    out[o + 5] = tangentGrad;
    out[o + 6] = chromaRange;
    out[o + 7] = Math.abs(normalGrad) + Math.abs(tangentGrad);
  }
  return out;
}

function seamScore(a, b) {
  const samples = a.length / 8;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < samples; i += 1) {
    meanA += a[i * 8 + 3];
    meanB += b[i * 8 + 3];
  }
  meanA /= samples;
  meanB /= samples;
  let err = 0;
  for (let i = 0; i < samples; i += 1) {
    const o = i * 8;
    const dr = a[o] - b[o];
    const dg = a[o + 1] - b[o + 1];
    const db = a[o + 2] - b[o + 2];
    const dl = (a[o + 3] - meanA) - (b[o + 3] - meanB);
    const normalContinuation = a[o + 4] + b[o + 4];
    const tangentContinuation = a[o + 5] - b[o + 5];
    const texture = a[o + 6] - b[o + 6];
    const edgeStrength = a[o + 7] - b[o + 7];
    err += 2.5 * (dr * dr + dg * dg + db * db);
    err += 0.9 * dl * dl;
    err += 1.5 * normalContinuation * normalContinuation;
    err += 0.8 * tangentContinuation * tangentContinuation;
    err += 0.4 * texture * texture;
    err += 0.35 * edgeStrength * edgeStrength;
  }
  err /= samples;
  return Math.exp(-Math.sqrt(Math.max(0, err)) * 7.5);
}

self.addEventListener("message", (event) => {
  const { rawBuffer, tileSize, tileCount, stateStart, stateEnd } = event.data;
  const raw = new Uint8Array(rawBuffer);
  const states = tileCount * 4;
  const descriptors = new Array((stateEnd - stateStart) * 4);
  for (let state = stateStart; state < stateEnd; state += 1) {
    const tile = Math.floor(state / 4);
    const rot = state % 4;
    for (let side = 0; side < 4; side += 1) {
      descriptors[(state - stateStart) * 4 + side] = descriptor(raw, tile, tileSize, rot, SIDES[side]);
    }
  }

  const allDescriptors = new Array(states * 4);
  for (let state = 0; state < states; state += 1) {
    const tile = Math.floor(state / 4);
    const rot = state % 4;
    for (let side = 0; side < 4; side += 1) {
      allDescriptors[state * 4 + side] = descriptor(raw, tile, tileSize, rot, SIDES[side]);
    }
  }

  const chunkStates = stateEnd - stateStart;
  const scores = new Float32Array(4 * chunkStates * states);
  const opposite = [2, 3, 0, 1];
  for (let side = 0; side < 4; side += 1) {
    for (let local = 0; local < chunkStates; local += 1) {
      const aState = stateStart + local;
      const aTile = Math.floor(aState / 4);
      const a = descriptors[local * 4 + side];
      for (let bState = 0; bState < states; bState += 1) {
        const bTile = Math.floor(bState / 4);
        const idx = side * chunkStates * states + local * states + bState;
        if (aTile === bTile) {
          scores[idx] = -1;
          continue;
        }
        scores[idx] = seamScore(a, allDescriptors[bState * 4 + opposite[side]]);
      }
    }
  }
  postMessage({ stateStart, stateEnd, scores }, [scores.buffer]);
});
