import { detectMlCapabilities } from "./ml-capabilities.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_NORMAL = [
  [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1],
];
const FACE_RIGHT = [
  [1, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0],
];
const FACE_UP = [
  [0, 0, -1], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 1, 0],
];
const SUBJECT_LABELS = [
  "planet Earth, a globe, or a world map",
  "a geographic map or cartographic image",
  "outer space, stars, or a galaxy",
  "the Moon or another planet",
  "an ocean or underwater scene",
  "a landscape or countryside",
  "mountains",
  "a beach or coastline",
  "a forest or trees",
  "flowers or plants",
  "an animal",
  "a cat",
  "a dog",
  "a bird",
  "a human face or portrait",
  "people",
  "a city or skyline",
  "a building or architecture",
  "a vehicle or car",
  "an aeroplane",
  "a ship or boat",
  "food",
  "a painting or fine artwork",
  "a cartoon or illustration",
  "a fantasy or video game scene",
  "abstract art",
  "a geometric pattern",
  "text, typography, or a logo",
  "a flag",
  "sports",
  "fire",
  "ice or snow",
  "sky or clouds",
  "a historical photograph",
  "music or a musical instrument",
];

let transformersPromise = null;
let capabilitiesPromise = null;

function status(stage, detail, progress) {
  postMessage({ type: "reference-status", stage, detail, progress });
}

function capabilities() {
  if (!capabilitiesPromise) capabilitiesPromise = detectMlCapabilities();
  return capabilitiesPromise;
}

async function transformers() {
  if (!transformersPromise) transformersPromise = import(TRANSFORMERS_URL);
  return transformersPromise;
}

function vecAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vecMul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function neg(a) { return [-a[0], -a[1], -a[2]]; }
function sameVec(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function vecKey(a) { return a.join(","); }

function rotate90(vector, axis, quarters) {
  let out = vector;
  for (let i = 0; i < ((quarters % 4) + 4) % 4; i += 1) {
    out = vecAdd(cross(axis, out), vecMul(axis, dot(axis, out)));
  }
  return out;
}

function allCubeRotations() {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const signed = axes.concat(axes.map(neg));
  const out = [];
  for (const x of signed) {
    for (const y of signed) {
      if (dot(x, y) !== 0) continue;
      const z = cross(x, y);
      const key = `${vecKey(x)}|${vecKey(y)}|${vecKey(z)}`;
      if (!out.some((item) => item.key === key)) out.push({ key, x, y, z });
    }
  }
  return out;
}

const CUBE_ROTATIONS = allCubeRotations();

function rotateByMatrix(v, m) {
  return [
    m.x[0] * v[0] + m.y[0] * v[1] + m.z[0] * v[2],
    m.x[1] * v[0] + m.y[1] * v[1] + m.z[1] * v[2],
    m.x[2] * v[0] + m.y[2] * v[1] + m.z[2] * v[2],
  ];
}

function faceIndexForNormal(normal) {
  return FACE_NORMAL.findIndex((n) => sameVec(n, normal));
}

function transformFaceletIndex(index, size, matrix) {
  const faceArea = size * size;
  const face = Math.floor(index / faceArea);
  const local = index % faceArea;
  const row = Math.floor(local / size);
  const col = local % size;
  const shell = size - 1;
  const position = vecAdd(
    vecMul(FACE_NORMAL[face], shell),
    vecAdd(vecMul(FACE_RIGHT[face], 2 * col - shell), vecMul(FACE_UP[face], shell - 2 * row)),
  );
  const normal = rotateByMatrix(FACE_NORMAL[face], matrix);
  const moved = rotateByMatrix(position, matrix);
  const targetFace = faceIndexForNormal(normal);
  const targetCol = Math.round((dot(moved, FACE_RIGHT[targetFace]) + shell) / 2);
  const targetRow = Math.round((shell - dot(moved, FACE_UP[targetFace])) / 2);
  return targetFace * faceArea + targetRow * size + targetCol;
}

function statePixel(raw, tileSize, state, x, y) {
  const tile = Math.floor(state / 4);
  const rot = state % 4;
  const n = tileSize;
  let ox = x;
  let oy = y;
  if (rot === 1) { ox = y; oy = n - 1 - x; }
  else if (rot === 2) { ox = n - 1 - x; oy = n - 1 - y; }
  else if (rot === 3) { ox = n - 1 - y; oy = x; }
  const offset = ((tile * n * n) + oy * n + ox) * 3;
  return [raw[offset], raw[offset + 1], raw[offset + 2]];
}

function buildMontage(raw, tileSize, size) {
  const facePixels = size * tileSize;
  const canvas = new OffscreenCanvas(facePixels * 3, facePixels * 2);
  const ctx = canvas.getContext("2d", { alpha: false });
  const positions = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
  for (let face = 0; face < 6; face += 1) {
    const image = ctx.createImageData(facePixels, facePixels);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const tile = face * size * size + row * size + col;
        for (let y = 0; y < tileSize; y += 1) {
          for (let x = 0; x < tileSize; x += 1) {
            const src = ((tile * tileSize * tileSize) + y * tileSize + x) * 3;
            const dst = (((row * tileSize + y) * facePixels) + col * tileSize + x) * 4;
            image.data[dst] = raw[src];
            image.data[dst + 1] = raw[src + 1];
            image.data[dst + 2] = raw[src + 2];
            image.data[dst + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(image, positions[face][0] * facePixels, positions[face][1] * facePixels);
  }
  return canvas;
}

function normaliseSubject(label) {
  const value = String(label || "").trim();
  if (/planet earth|globe|world map/i.test(value)) return "planet Earth world map";
  if (/cartographic|geographic map/i.test(value)) return "map cartography";
  return value.replace(/^(a|an|the)\s+/i, "").replace(/\bor\b.*$/i, "").trim() || "picture artwork";
}

async function recogniseSubject(raw, tileSize, size) {
  const caps = await capabilities();
  const { pipeline } = await transformers();
  const model = caps.memoryTier === "high" && !caps.mobile
    ? "Xenova/mobileclip_s0"
    : "onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX";
  const options = caps.webgpu
    ? { device: "webgpu", dtype: "q8" }
    : { dtype: caps.memoryTier === "low" ? "q4" : "q8" };
  let classifier = null;
  try {
    status("recognise", "Recognising the cube artwork…", 0.06);
    classifier = await pipeline("zero-shot-image-classification", model, options);
    const output = await classifier(buildMontage(raw, tileSize, size), SUBJECT_LABELS, {
      hypothesis_template: "This picture represents {}",
    });
    const guesses = Array.from(output || []).slice(0, 5).map((item) => ({
      label: normaliseSubject(item.label),
      rawLabel: item.label,
      score: Number(item.score || 0),
    }));
    return { subject: guesses[0]?.label || "picture artwork", guesses, model };
  } finally {
    try { await classifier?.dispose?.(); } catch (_) {}
  }
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function candidatePriority(candidate, subject, queryRank) {
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  const words = subject.toLowerCase().split(/\W+/).filter((x) => x.length > 2);
  let score = Math.max(0, 1 - queryRank * 0.05);
  if (/cube.?map|cubemap|cube map|cube projection|cube net/.test(text)) score += 1.8;
  if (/texture|projection|map/.test(text)) score += 0.35;
  for (const word of words) if (text.includes(word)) score += 0.12;
  return score;
}

async function commonsSearch(query, limit = 8) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "768",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(`Commons search failed: ${response.status}`);
  const data = await response.json();
  return (data?.query?.pages || []).map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    return {
      title: page.title || "",
      thumbnailUrl: info.thumburl || info.url || "",
      sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`,
      mime: info.mime || "",
      description: stripHtml(meta.ImageDescription?.value || meta.ObjectName?.value || ""),
      artist: stripHtml(meta.Artist?.value || ""),
      licence: stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value || ""),
    };
  }).filter((item) => item.thumbnailUrl && /^image\//.test(item.mime));
}

async function searchReferences(subject) {
  const queries = [
    `${subject} cube map`,
    `${subject} cubemap texture`,
    `${subject} cube projection`,
    subject,
  ];
  const byTitle = new Map();
  for (let qi = 0; qi < queries.length; qi += 1) {
    status("search", `Searching public references for “${subject}”…`, 0.16 + qi * 0.04);
    try {
      for (const candidate of await commonsSearch(queries[qi], 8)) {
        const key = candidate.title.toLowerCase();
        const ranked = { ...candidate, searchPriority: candidatePriority(candidate, subject, qi) };
        const old = byTitle.get(key);
        if (!old || ranked.searchPriority > old.searchPriority) byTitle.set(key, ranked);
      }
    } catch (_) {}
  }
  return [...byTitle.values()].sort((a, b) => b.searchPriority - a.searchPriority).slice(0, 12);
}

function cellActivity(data, width, height, col, row, cols, rows) {
  const x0 = Math.floor(col * width / cols);
  const x1 = Math.floor((col + 1) * width / cols);
  const y0 = Math.floor(row * height / rows);
  const y1 = Math.floor((row + 1) * height / rows);
  let sr = 0; let sg = 0; let sb = 0; let s2 = 0; let count = 0;
  for (let sy = 0; sy < 12; sy += 1) {
    const y = Math.min(height - 1, Math.floor(y0 + (sy + 0.5) * (y1 - y0) / 12));
    for (let sx = 0; sx < 12; sx += 1) {
      const x = Math.min(width - 1, Math.floor(x0 + (sx + 0.5) * (x1 - x0) / 12));
      const o = (y * width + x) * 4;
      const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
      sr += r; sg += g; sb += b; s2 += r * r + g * g + b * b; count += 1;
    }
  }
  const mr = sr / count; const mg = sg / count; const mb = sb / count;
  const variance = Math.max(0, s2 / count - (mr * mr + mg * mg + mb * mb));
  return Math.sqrt(variance) + 0.04 * (Math.max(mr, mg, mb) - Math.min(mr, mg, mb));
}

function combinations(values, choose) {
  const out = [];
  function walk(start, picked) {
    if (picked.length === choose) { out.push(picked.slice()); return; }
    for (let i = start; i <= values.length - (choose - picked.length); i += 1) {
      picked.push(values[i]); walk(i + 1, picked); picked.pop();
    }
  }
  walk(0, []);
  return out;
}

function orientationEqual(a, b) {
  return sameVec(a.n, b.n) && sameVec(a.r, b.r) && sameVec(a.u, b.u);
}

function foldNet(cells, cols, rows) {
  const occupied = new Set(cells.map((cell) => `${cell.col},${cell.row}`));
  const orientations = new Map();
  const first = cells[0];
  orientations.set(`${first.col},${first.row}`, { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] });
  const queue = [first];
  while (queue.length) {
    const cell = queue.shift();
    const key = `${cell.col},${cell.row}`;
    const o = orientations.get(key);
    const neighbours = [
      [cell.col + 1, cell.row, o.u, 1],
      [cell.col - 1, cell.row, o.u, -1],
      [cell.col, cell.row - 1, o.r, -1],
      [cell.col, cell.row + 1, o.r, 1],
    ];
    for (const [col, row, axis, q] of neighbours) {
      const nk = `${col},${row}`;
      if (!occupied.has(nk)) continue;
      const next = {
        n: rotate90(o.n, axis, q),
        r: rotate90(o.r, axis, q),
        u: rotate90(o.u, axis, q),
      };
      if (orientations.has(nk)) {
        if (!orientationEqual(orientations.get(nk), next)) return null;
      } else {
        orientations.set(nk, next);
        queue.push({ col, row });
      }
    }
  }
  if (orientations.size !== 6) return null;
  const normals = new Set([...orientations.values()].map((o) => vecKey(o.n)));
  if (normals.size !== 6 || [...normals].some((key) => !FACE_NORMAL.some((n) => vecKey(n) === key))) return null;
  return orientations;
}

function detectCubeNet(imageData) {
  const { width, height, data } = imageData;
  const layouts = [];
  const ratio = width / height;
  if (Math.abs(ratio - 4 / 3) < 0.12) layouts.push([4, 3]);
  if (Math.abs(ratio - 3 / 4) < 0.12) layouts.push([3, 4]);
  let best = null;
  for (const [cols, rows] of layouts) {
    const ranked = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        ranked.push({ col, row, activity: cellActivity(data, width, height, col, row, cols, rows) });
      }
    }
    ranked.sort((a, b) => b.activity - a.activity);
    const pool = ranked.slice(0, Math.min(8, ranked.length));
    for (const cells of combinations(pool, 6)) {
      const orientations = foldNet(cells, cols, rows);
      if (!orientations) continue;
      const score = cells.reduce((sum, cell) => sum + cell.activity, 0);
      if (!best || score > best.score) best = { cols, rows, cells, orientations, score };
    }
  }
  return best;
}

function sampleDescriptorFromState(raw, tileSize, state, side = 10) {
  const pixels = new Float32Array(side * side * 4);
  let meanLum = 0;
  let p = 0;
  for (let y = 0; y < side; y += 1) {
    const sy = Math.min(tileSize - 1, Math.floor((y + 0.5) * tileSize / side));
    for (let x = 0; x < side; x += 1) {
      const sx = Math.min(tileSize - 1, Math.floor((x + 0.5) * tileSize / side));
      const [r, g, b] = statePixel(raw, tileSize, state, sx, sy);
      const sum = r + g + b + 1;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      pixels[p++] = r / sum;
      pixels[p++] = g / sum;
      pixels[p++] = b / sum;
      pixels[p++] = lum;
      meanLum += lum;
    }
  }
  meanLum /= side * side;
  return finishDescriptor(pixels, side, meanLum);
}

function sampleDescriptorFromImage(data, width, height, x0, y0, x1, y1, side = 10) {
  const pixels = new Float32Array(side * side * 4);
  let meanLum = 0;
  let p = 0;
  for (let y = 0; y < side; y += 1) {
    const sy = Math.max(0, Math.min(height - 1, Math.floor(y0 + (y + 0.5) * (y1 - y0) / side)));
    for (let x = 0; x < side; x += 1) {
      const sx = Math.max(0, Math.min(width - 1, Math.floor(x0 + (x + 0.5) * (x1 - x0) / side)));
      const o = (sy * width + sx) * 4;
      const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
      const sum = r + g + b + 1;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      pixels[p++] = r / sum;
      pixels[p++] = g / sum;
      pixels[p++] = b / sum;
      pixels[p++] = lum;
      meanLum += lum;
    }
  }
  meanLum /= side * side;
  return finishDescriptor(pixels, side, meanLum);
}

function finishDescriptor(pixels, side, meanLum) {
  const out = [];
  for (let i = 0; i < side * side; i += 1) {
    out.push(pixels[i * 4] * 0.75, pixels[i * 4 + 1] * 0.75, pixels[i * 4 + 2] * 0.75, (pixels[i * 4 + 3] - meanLum) * 0.45);
  }
  for (let y = 1; y < side - 1; y += 1) {
    for (let x = 1; x < side - 1; x += 1) {
      const i = y * side + x;
      const dx = pixels[(i + 1) * 4 + 3] - pixels[(i - 1) * 4 + 3];
      const dy = pixels[(i + side) * 4 + 3] - pixels[(i - side) * 4 + 3];
      out.push(dx * 0.75, dy * 0.75);
    }
  }
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(out, (value) => value / norm);
}

function descriptorSimilarity(a, b) {
  let dotProduct = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) dotProduct += a[i] * b[i];
  return Math.max(0, Math.min(1, (dotProduct + 1) * 0.5));
}

function extractReferenceDescriptors(imageData, net, size) {
  const faceArea = size * size;
  const targetCount = 6 * faceArea;
  const descriptors = new Array(targetCount);
  const { width, height, data } = imageData;
  const cellW = width / net.cols;
  const cellH = height / net.rows;
  for (const cell of net.cells) {
    const o = net.orientations.get(`${cell.col},${cell.row}`);
    const face = faceIndexForNormal(o.n);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const shell = size - 1;
        const tangent = vecAdd(vecMul(o.r, 2 * col - shell), vecMul(o.u, shell - 2 * row));
        const canonicalCol = Math.round((dot(tangent, FACE_RIGHT[face]) + shell) / 2);
        const canonicalRow = Math.round((shell - dot(tangent, FACE_UP[face])) / 2);
        const target = face * faceArea + canonicalRow * size + canonicalCol;
        const x0 = cell.col * cellW + col * cellW / size;
        const y0 = cell.row * cellH + row * cellH / size;
        const x1 = cell.col * cellW + (col + 1) * cellW / size;
        const y1 = cell.row * cellH + (row + 1) * cellH / size;
        descriptors[target] = sampleDescriptorFromImage(data, width, height, x0, y0, x1, y1);
      }
    }
  }
  return descriptors.every(Boolean) ? descriptors : null;
}

function rotateReferenceDescriptors(descriptors, size, matrix) {
  const out = new Array(descriptors.length);
  for (let oldIndex = 0; oldIndex < descriptors.length; oldIndex += 1) {
    out[transformFaceletIndex(oldIndex, size, matrix)] = descriptors[oldIndex];
  }
  return out;
}

function alignReferenceToFixedCentres(scanDescriptors, referenceDescriptors, size) {
  if (size % 2 === 0) return referenceDescriptors;
  const faceArea = size * size;
  const mid = Math.floor(size / 2);
  let best = referenceDescriptors;
  let bestScore = -Infinity;
  for (const rotation of CUBE_ROTATIONS) {
    const candidate = rotateReferenceDescriptors(referenceDescriptors, size, rotation);
    let score = 0;
    for (let face = 0; face < 6; face += 1) {
      const tile = face * faceArea + mid * size + mid;
      const target = tile;
      let local = 0;
      for (let rot = 0; rot < 4; rot += 1) local = Math.max(local, descriptorSimilarity(scanDescriptors[tile * 4 + rot], candidate[target]));
      score += local;
    }
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

function hungarianMax(matrix) {
  const n = matrix.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1); minv.fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = -matrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  let score = 0;
  for (let j = 1; j <= n; j += 1) if (p[j] > 0) score += matrix[p[j] - 1][j - 1];
  return score;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function buildAbsoluteEvidence(raw, tileSize, size, referenceDescriptors) {
  const tileCount = 6 * size * size;
  const states = tileCount * 4;
  const scanDescriptors = new Array(states);
  for (let state = 0; state < states; state += 1) scanDescriptors[state] = sampleDescriptorFromState(raw, tileSize, state);
  const aligned = alignReferenceToFixedCentres(scanDescriptors, referenceDescriptors, size);
  const scores = new Float32Array(states * tileCount);
  const pairBest = Array.from({ length: tileCount }, () => new Float64Array(tileCount));
  for (let tile = 0; tile < tileCount; tile += 1) {
    for (let target = 0; target < tileCount; target += 1) {
      let best = 0;
      for (let rot = 0; rot < 4; rot += 1) {
        const state = tile * 4 + rot;
        const score = descriptorSimilarity(scanDescriptors[state], aligned[target]);
        scores[state * tileCount + target] = score;
        if (score > best) best = score;
      }
      pairBest[tile][target] = best;
    }
  }
  const fit = hungarianMax(pairBest) / tileCount;
  const bytes = new Uint8Array(scores.buffer, scores.byteOffset, scores.byteLength);
  return { fit, absolute_f32_b64: bytesToBase64(bytes), states, targets: tileCount };
}

async function imageDataFromUrl(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`Reference image fetch failed: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const maxSide = 768;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close?.();
  }
}

async function scoreCandidate(candidate, raw, tileSize, size) {
  try {
    const imageData = await imageDataFromUrl(candidate.thumbnailUrl);
    const net = detectCubeNet(imageData);
    if (!net) return { ...candidate, usable: false, reason: "No six-face cube net detected" };
    const referenceDescriptors = extractReferenceDescriptors(imageData, net, size);
    if (!referenceDescriptors) return { ...candidate, usable: false, reason: "Could not read all six reference faces" };
    const evidence = buildAbsoluteEvidence(raw, tileSize, size, referenceDescriptors);
    return {
      ...candidate,
      usable: true,
      fit: evidence.fit,
      layout: `${net.cols}×${net.rows} cube net`,
      evidence: {
        version: 1,
        states: evidence.states,
        targets: evidence.targets,
        absolute_f32_b64: evidence.absolute_f32_b64,
        fit: evidence.fit,
      },
    };
  } catch (error) {
    return { ...candidate, usable: false, reason: String(error?.message || error) };
  }
}

async function analyse(data) {
  const raw = new Uint8Array(data.rawBuffer);
  const tileSize = Number(data.tileSize || 48);
  const size = Number(data.size || 3);
  let subject = String(data.subject || "").trim();
  let guesses = [];
  let model = null;

  if (!subject) {
    try {
      const recognised = await recogniseSubject(raw, tileSize, size);
      subject = recognised.subject;
      guesses = recognised.guesses;
      model = recognised.model;
    } catch (error) {
      guesses = [{ label: "picture artwork", rawLabel: "recognition unavailable", score: 0 }];
      subject = "picture artwork";
      postMessage({ type: "reference-warning", message: `Artwork recognition unavailable: ${error?.message || error}` });
    }
  }

  status("search", `Looking for references for “${subject}”…`, 0.24);
  const candidates = await searchReferences(subject);
  const ranked = candidates.slice(0, 7);
  const scored = [];
  for (let i = 0; i < ranked.length; i += 1) {
    status("reference", `Checking reference ${i + 1} of ${ranked.length}…`, 0.38 + 0.54 * ((i + 0.5) / Math.max(1, ranked.length)));
    scored.push(await scoreCandidate(ranked[i], raw, tileSize, size));
  }
  scored.sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (a.usable && b.usable && b.fit !== a.fit) return b.fit - a.fit;
    return b.searchPriority - a.searchPriority;
  });
  const selectedIndex = scored.findIndex((candidate) => candidate.usable);
  status("complete", selectedIndex >= 0 ? "Reference-assisted reconstruction ready" : "No usable cube-net reference found", 1);
  postMessage({
    type: "reference-result",
    subject,
    guesses,
    model,
    candidates: scored,
    selectedIndex,
  });
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};
  try {
    if (data.type === "analyse") {
      await analyse(data);
      return;
    }
    throw new Error(`Unknown reference worker message: ${data.type}`);
  } catch (error) {
    postMessage({ type: "reference-error", message: error instanceof Error ? error.message : String(error) });
  }
});
