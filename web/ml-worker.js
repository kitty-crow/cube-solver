import { detectMlCapabilities } from "./ml-capabilities.js";

const ORT_VERSION = "1.23.2";
const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.mjs`;
const ORT_WASM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

const MODELS = {
  dino: {
    name: "DINOv2-small",
    url: "https://huggingface.co/onnx-community/dinov2-small-ONNX/resolve/main/onnx/model_uint8.onnx",
    weight: 0.16,
  },
  lightglue: {
    name: "SuperPoint + LightGlue",
    url: "https://huggingface.co/thomasonzhou/superpoint-lightglue/resolve/main/model.onnx",
    weight: 0.09,
  },
  loftr: {
    name: "EfficientLoFTR",
    url: "https://huggingface.co/pankaj-kaushik/efficient-loftr-onnx/resolve/main/eloftr_outdoor_opt.onnx",
    weight: 0.08,
  },
  xfeat: {
    name: "XFeat",
    url: "https://github.com/DavideCatto/XFeat-ONNX/releases/download/V1.0.0/xfeat_dense_e2e.onnx",
    weight: 0.07,
  },
  romaDescriptor: {
    name: "RoMaV2 turbo descriptor",
    url: "https://huggingface.co/opsiclear-admin/romav2_web/resolve/main/dinov3_turbo.onnx",
  },
  romaMatcher: {
    name: "RoMaV2 turbo matcher",
    url: "https://huggingface.co/opsiclear-admin/romav2_web/resolve/main/matcher_turbo.onnx",
    weight: 0.10,
  },
};

let capabilitiesPromise = null;
let ortPromise = null;
const sessions = new Map();

function status(stage, detail = "") {
  postMessage({ type: "ml-status", stage, detail });
}

async function capabilities() {
  if (!capabilitiesPromise) capabilitiesPromise = detectMlCapabilities();
  return capabilitiesPromise;
}

async function ortModule() {
  if (!ortPromise) {
    ortPromise = import(ORT_URL).then((ort) => {
      ort.env.wasm.wasmPaths = ORT_WASM;
      return ort;
    });
  }
  return ortPromise;
}

async function loadSession(key) {
  if (sessions.has(key)) return sessions.get(key);
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown model ${key}`);
  const promise = (async () => {
    const ort = await ortModule();
    const caps = await capabilities();
    ort.env.wasm.numThreads = caps.wasmThreads ? Math.max(1, Math.min(8, caps.cpuWorkers)) : 1;
    const candidates = [];
    if (caps.webgpu) candidates.push(["webgpu"]);
    if (caps.webgl2) candidates.push(["webgl"]);
    candidates.push(["wasm"]);
    let lastError = null;
    for (const executionProviders of candidates) {
      try {
        const session = await ort.InferenceSession.create(model.url, {
          executionProviders,
          graphOptimizationLevel: "all",
          enableCpuMemArena: true,
          enableMemPattern: true,
        });
        return { session, provider: executionProviders[0] };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Could not load ${model.name}`);
  })();
  sessions.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
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
  const off = ((tile * n * n) + oy * n + ox) * 3;
  return [raw[off], raw[off + 1], raw[off + 2]];
}

function resizeState(raw, tileSize, state, width, height, channels = 3, normalise = false) {
  const data = new Float32Array(width * height * channels);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(tileSize - 1, Math.floor((y + 0.5) * tileSize / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(tileSize - 1, Math.floor((x + 0.5) * tileSize / width));
      const rgb = statePixel(raw, tileSize, state, sx, sy);
      if (channels === 1) {
        data[o++] = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      } else {
        for (let c = 0; c < 3; c += 1) {
          const v = rgb[c] / 255;
          data[o++] = normalise ? (v - mean[c]) / std[c] : v;
        }
      }
    }
  }
  if (channels === 3) {
    const planar = new Float32Array(data.length);
    const pixels = width * height;
    for (let p = 0; p < pixels; p += 1) {
      planar[p] = data[p * 3];
      planar[pixels + p] = data[p * 3 + 1];
      planar[2 * pixels + p] = data[p * 3 + 2];
    }
    return planar;
  }
  return data;
}

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return dot / Math.sqrt(aa * bb);
}

async function dinoEmbeddings(raw, tileSize, tileCount) {
  const { session, provider } = await loadSession("dino");
  const ort = await ortModule();
  const name = session.inputNames[0];
  const metadata = session.inputMetadata?.[name];
  const dims = metadata?.dimensions || metadata?.dims || [];
  const height = Number(dims[dims.length - 2]) > 0 ? Number(dims[dims.length - 2]) : 224;
  const width = Number(dims[dims.length - 1]) > 0 ? Number(dims[dims.length - 1]) : 224;
  const result = new Array(tileCount);
  for (let tile = 0; tile < tileCount; tile += 1) {
    const input = resizeState(raw, tileSize, tile * 4, width, height, 3, true);
    const outputs = await session.run({ [name]: new ort.Tensor("float32", input, [1, 3, height, width]) });
    const tensor = outputs.last_hidden_state || outputs[session.outputNames[0]];
    const data = tensor.data;
    const hidden = Number(tensor.dims[tensor.dims.length - 1]) || Math.min(384, data.length);
    result[tile] = Float32Array.from(data.slice(0, hidden));
  }
  return { embeddings: result, provider };
}

function metadataDims(session, name) {
  const meta = session.inputMetadata?.[name];
  return meta?.dimensions || meta?.dims || [];
}

function resolveShape(dims, defaultChannels = 1, defaultSize = 256) {
  const d = Array.from(dims || []);
  const channels = Number(d[d.length - 3]) > 0 ? Number(d[d.length - 3]) : defaultChannels;
  const height = Number(d[d.length - 2]) > 0 ? Number(d[d.length - 2]) : defaultSize;
  const width = Number(d[d.length - 1]) > 0 ? Number(d[d.length - 1]) : defaultSize;
  return { channels: channels === 3 ? 3 : 1, height, width };
}

function normaliseConfidence(values) {
  if (!values?.length) return null;
  let sum = 0;
  let count = 0;
  for (const raw of values) {
    if (!Number.isFinite(raw)) continue;
    let value = Number(raw);
    if (value < 0 || value > 1) value = 1 / (1 + Math.exp(-value));
    sum += Math.max(0, Math.min(1, value));
    count += 1;
  }
  return count ? sum / count : null;
}

function scoreOutputs(outputs) {
  const entries = Object.entries(outputs);
  const confidence = [];
  let matchCount = 0;
  for (const [name, tensor] of entries) {
    const lower = name.toLowerCase();
    if (/(conf|score|certainty|mconf)/.test(lower)) {
      const data = tensor.data;
      const stride = Math.max(1, Math.floor(data.length / 2048));
      const sampled = [];
      for (let i = 0; i < data.length; i += stride) sampled.push(Number(data[i]));
      const value = normaliseConfidence(sampled);
      if (value != null) confidence.push(value);
    }
    if (/match/.test(lower)) {
      for (const value of tensor.data) if (Number(value) >= 0) matchCount += 1;
    }
  }
  if (confidence.length) return confidence.reduce((a, b) => a + b, 0) / confidence.length;
  if (matchCount) return Math.min(1, Math.log1p(matchCount) / Math.log(128));
  return null;
}

async function runPairModel(key, raw, tileSize, aState, bState) {
  const { session, provider } = await loadSession(key);
  const ort = await ortModule();
  const names = session.inputNames;
  const feeds = {};
  if (names.length === 1) {
    const name = names[0];
    const shape = resolveShape(metadataDims(session, name), 1, 256);
    const one = resizeState(raw, tileSize, aState, shape.width, shape.height, shape.channels, false);
    const two = resizeState(raw, tileSize, bState, shape.width, shape.height, shape.channels, false);
    const per = one.length;
    const pair = new Float32Array(per * 2);
    pair.set(one, 0);
    pair.set(two, per);
    feeds[name] = new ort.Tensor("float32", pair, [2, shape.channels, shape.height, shape.width]);
  } else {
    for (let i = 0; i < Math.min(2, names.length); i += 1) {
      const name = names[i];
      const shape = resolveShape(metadataDims(session, name), 1, 256);
      const data = resizeState(raw, tileSize, i === 0 ? aState : bState, shape.width, shape.height, shape.channels, false);
      feeds[name] = new ort.Tensor("float32", data, [1, shape.channels, shape.height, shape.width]);
    }
  }
  const outputs = await session.run(feeds);
  return { score: scoreOutputs(outputs), provider };
}

async function runRoma(raw, tileSize, aState, bState) {
  const caps = await capabilities();
  if (!caps.webgpu || (caps.deviceMemory && caps.deviceMemory < 12)) return { score: null, provider: null, skipped: "memory" };
  try {
    const descriptor = await loadSession("romaDescriptor");
    const matcher = await loadSession("romaMatcher");
    const ort = await ortModule();
    const descriptorName = descriptor.session.inputNames[0];
    const shape = resolveShape(metadataDims(descriptor.session, descriptorName), 3, 320);
    const descriptors = [];
    for (const state of [aState, bState]) {
      const data = resizeState(raw, tileSize, state, shape.width, shape.height, 3, false);
      const outputs = await descriptor.session.run({ [descriptorName]: new ort.Tensor("float32", data, [1, 3, shape.height, shape.width]) });
      descriptors.push(outputs);
    }
    const feeds = {};
    const matcherNames = matcher.session.inputNames;
    const tensorsA = Object.values(descriptors[0]);
    const tensorsB = Object.values(descriptors[1]);
    for (let i = 0; i < matcherNames.length; i += 1) {
      const source = i < Math.ceil(matcherNames.length / 2) ? tensorsA : tensorsB;
      const tensor = source[i % source.length];
      feeds[matcherNames[i]] = tensor;
    }
    const outputs = await matcher.session.run(feeds);
    return { score: scoreOutputs(outputs), provider: matcher.provider };
  } catch (_) {
    return { score: null, provider: null };
  }
}

async function classicalScores(raw, tileSize, tileCount, workers) {
  const states = tileCount * 4;
  const count = Math.max(1, Math.min(workers, states));
  const output = new Float32Array(4 * states * states);
  const jobs = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * states / count);
    const end = Math.floor((i + 1) * states / count);
    jobs.push(new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./seam-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        const { stateStart, stateEnd, scores } = event.data;
        const chunk = stateEnd - stateStart;
        for (let side = 0; side < 4; side += 1) {
          const src = side * chunk * states;
          const dst = side * states * states + stateStart * states;
          output.set(scores.subarray(src, src + chunk * states), dst);
        }
        worker.terminate();
        resolve();
      };
      worker.onerror = (error) => { worker.terminate(); reject(error); };
      const copy = raw.slice().buffer;
      worker.postMessage({ rawBuffer: copy, tileSize, tileCount, stateStart: start, stateEnd: end }, [copy]);
    }));
  }
  await Promise.all(jobs);
  return output;
}

function blendDino(scores, embeddings, tileCount, weight) {
  const states = tileCount * 4;
  for (let side = 0; side < 4; side += 1) {
    const base = side * states * states;
    for (let a = 0; a < states; a += 1) {
      const at = Math.floor(a / 4);
      for (let b = 0; b < states; b += 1) {
        const bt = Math.floor(b / 4);
        if (at === bt) continue;
        const sim = Math.max(0, Math.min(1, (cosine(embeddings[at], embeddings[bt]) + 1) * 0.5));
        const idx = base + a * states + b;
        scores[idx] = scores[idx] * (1 - weight) + sim * weight;
      }
    }
  }
}

function ambiguousCandidates(scores, tileCount, limit = 32) {
  const states = tileCount * 4;
  const result = [];
  for (let side = 0; side < 4; side += 1) {
    const base = side * states * states;
    for (let a = 0; a < states; a += 1) {
      let best = -Infinity;
      let second = -Infinity;
      let bestB = -1;
      for (let b = 0; b < states; b += 1) {
        if (Math.floor(a / 4) === Math.floor(b / 4)) continue;
        const value = scores[base + a * states + b];
        if (value > best) { second = best; best = value; bestB = b; }
        else if (value > second) second = value;
      }
      if (bestB >= 0) result.push({ a, b: bestB, side, ambiguity: Math.max(0, best - second), score: best });
    }
  }
  result.sort((x, y) => x.ambiguity - y.ambiguity || y.score - x.score);
  const unique = [];
  const seen = new Set();
  for (const item of result) {
    const key = `${Math.floor(item.a / 4)}:${Math.floor(item.b / 4)}:${item.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

async function refinePairs(scores, raw, tileSize, tileCount, caps, modelStatus) {
  const states = tileCount * 4;
  const candidates = ambiguousCandidates(scores, tileCount, caps.webgpu ? 32 : 12);
  const enabled = caps.webgpu ? ["lightglue", "loftr", "xfeat"] : ["xfeat", "lightglue"];
  for (const key of enabled) {
    let used = 0;
    let provider = null;
    for (const item of candidates) {
      try {
        const result = await runPairModel(key, raw, tileSize, item.a, item.b);
        provider ||= result.provider;
        if (result.score == null) continue;
        const idx = item.side * states * states + item.a * states + item.b;
        const w = MODELS[key].weight;
        scores[idx] = scores[idx] * (1 - w) + result.score * w;
        used += 1;
      } catch (error) {
        modelStatus[key] = { active: false, error: String(error?.message || error) };
        break;
      }
    }
    if (used) modelStatus[key] = { active: true, provider, evaluated: used };
  }

  if (caps.webgpu && (!caps.deviceMemory || caps.deviceMemory >= 12) && candidates.length) {
    const item = candidates[0];
    status("roma", "Checking hardest seam with RoMaV2…");
    const result = await runRoma(raw, tileSize, item.a, item.b);
    if (result.score != null) {
      const idx = item.side * states * states + item.a * states + item.b;
      const w = MODELS.romaMatcher.weight;
      scores[idx] = scores[idx] * (1 - w) + result.score * w;
      modelStatus.roma = { active: true, provider: result.provider, evaluated: 1 };
    } else {
      modelStatus.roma = { active: false, skipped: result.skipped || "unavailable" };
    }
  }
}

async function analyse(data) {
  const caps = await capabilities();
  const raw = new Uint8Array(data.rawBuffer);
  const tileSize = Number(data.tileSize);
  const tileCount = Number(data.tileCount);
  const modelStatus = {};

  status("classical", `Scoring seams on ${caps.cpuWorkers} CPU worker${caps.cpuWorkers === 1 ? "" : "s"}…`);
  const classicalPromise = classicalScores(raw, tileSize, tileCount, caps.cpuWorkers);

  let dino = null;
  const useDino = caps.webgpu || caps.hardwareConcurrency >= 6;
  if (useDino) {
    status("dino", "Loading DINOv2 visual features…");
    try {
      dino = await dinoEmbeddings(raw, tileSize, tileCount);
      modelStatus.dino = { active: true, provider: dino.provider, evaluated: tileCount };
    } catch (error) {
      modelStatus.dino = { active: false, error: String(error?.message || error) };
    }
  } else modelStatus.dino = { active: false, skipped: "low-power" };

  const scores = await classicalPromise;
  if (dino) blendDino(scores, dino.embeddings, tileCount, MODELS.dino.weight);

  status("ensemble", "Resolving ambiguous seams with learned matchers…");
  await refinePairs(scores, raw, tileSize, tileCount, caps, modelStatus);

  postMessage({
    type: "ml-result",
    scores,
    states: tileCount * 4,
    capabilities: caps,
    models: modelStatus,
  }, [scores.buffer]);
}

self.addEventListener("message", async (event) => {
  const { type } = event.data || {};
  try {
    if (type === "warm") {
      const caps = await capabilities();
      postMessage({ type: "ml-ready", capabilities: caps });
      return;
    }
    if (type === "analyse") {
      await analyse(event.data);
      return;
    }
    throw new Error(`Unknown ML worker message: ${type}`);
  } catch (error) {
    postMessage({ type: "ml-error", message: error instanceof Error ? error.message : String(error) });
  }
});
