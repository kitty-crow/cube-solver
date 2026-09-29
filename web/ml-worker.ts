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

function status(stage, detail = "", progress = null) {
  postMessage({ type: "ml-status", stage, detail, progress });
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
    ort.env.wasm.numThreads = caps.wasmThreads ? Math.max(1, Math.min(4, caps.cpuWorkers)) : 1;
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

async function releaseSession(key) {
  const pending = sessions.get(key);
  sessions.delete(key);
  if (!pending) return;
  try {
    const loaded = await pending;
    await loaded.session?.release?.();
  } catch (_) {}
}

async function releaseAllSessions() {
  const keys = [...sessions.keys()];
  for (const key of keys) await releaseSession(key);
}

function disposeOutputs(outputs) {
  if (!outputs) return;
  for (const tensor of Object.values(outputs)) tensor?.dispose?.();
}

function memoryPlan(caps, pythonResident = false) {
  const constrained = pythonResident || caps.memoryTier === "low";
  const medium = !constrained && caps.memoryTier === "medium";
  const veryLarge = !pythonResident && !caps.mobile && caps.memoryTier === "high" && caps.webgpu && caps.memoryBudgetMB >= 1200;
  return {
    workers: constrained ? Math.min(2, caps.cpuWorkers) : medium ? Math.min(4, caps.cpuWorkers) : caps.cpuWorkers,
    useDino: !constrained && (caps.webgpu || (!caps.mobile && caps.hardwareConcurrency >= 8)),
    pairModels: constrained ? ["xfeat"] : medium ? ["xfeat", "lightglue"] : ["lightglue", "xfeat", "loftr"],
    candidateLimit: constrained ? 4 : medium ? 10 : 24,
    useRoma: veryLarge,
    constrained,
  };
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
  const confidence = [];
  let matchCount = 0;
  for (const [name, tensor] of Object.entries(outputs)) {
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

async function dinoEmbeddings(raw, tileSize, tileCount, onProgress) {
  const { session, provider } = await loadSession("dino");
  const ort = await ortModule();
  const name = session.inputNames[0];
  const metadata = session.inputMetadata?.[name];
  const dims = metadata?.dimensions || metadata?.dims || [];
  const height = Number(dims[dims.length - 2]) > 0 ? Number(dims[dims.length - 2]) : 224;
  const width = Number(dims[dims.length - 1]) > 0 ? Number(dims[dims.length - 1]) : 224;
  const result = new Array(tileCount);
  try {
    for (let tile = 0; tile < tileCount; tile += 1) {
      const inputData = resizeState(raw, tileSize, tile * 4, width, height, 3, true);
      const input = new ort.Tensor("float32", inputData, [1, 3, height, width]);
      let outputs = null;
      try {
        outputs = await session.run({ [name]: input });
        const tensor = outputs.last_hidden_state || outputs[session.outputNames[0]];
        const data = tensor.data;
        const hidden = Number(tensor.dims[tensor.dims.length - 1]) || Math.min(384, data.length);
        result[tile] = Float32Array.from(data.slice(0, hidden));
      } finally {
        input.dispose?.();
        disposeOutputs(outputs);
      }
      onProgress?.((tile + 1) / tileCount);
    }
    return { embeddings: result, provider };
  } finally {
    await releaseSession("dino");
  }
}

async function runPairModel(key, raw, tileSize, aState, bState) {
  const { session, provider } = await loadSession(key);
  const ort = await ortModule();
  const names = session.inputNames;
  const feeds = {};
  const inputs = [];
  if (names.length === 1) {
    const name = names[0];
    const shape = resolveShape(metadataDims(session, name), 1, 256);
    const one = resizeState(raw, tileSize, aState, shape.width, shape.height, shape.channels, false);
    const two = resizeState(raw, tileSize, bState, shape.width, shape.height, shape.channels, false);
    const pair = new Float32Array(one.length + two.length);
    pair.set(one, 0);
    pair.set(two, one.length);
    const input = new ort.Tensor("float32", pair, [2, shape.channels, shape.height, shape.width]);
    feeds[name] = input;
    inputs.push(input);
  } else {
    for (let i = 0; i < Math.min(2, names.length); i += 1) {
      const name = names[i];
      const shape = resolveShape(metadataDims(session, name), 1, 256);
      const data = resizeState(raw, tileSize, i === 0 ? aState : bState, shape.width, shape.height, shape.channels, false);
      const input = new ort.Tensor("float32", data, [1, shape.channels, shape.height, shape.width]);
      feeds[name] = input;
      inputs.push(input);
    }
  }
  let outputs = null;
  try {
    outputs = await session.run(feeds);
    return { score: scoreOutputs(outputs), provider };
  } finally {
    for (const input of inputs) input.dispose?.();
    disposeOutputs(outputs);
  }
}

async function runRoma(raw, tileSize, aState, bState) {
  const caps = await capabilities();
  if (!caps.webgpu) return { score: null, provider: null, skipped: "no-webgpu" };
  let descriptorOutputs = [];
  try {
    const descriptor = await loadSession("romaDescriptor");
    const ort = await ortModule();
    const descriptorName = descriptor.session.inputNames[0];
    const shape = resolveShape(metadataDims(descriptor.session, descriptorName), 3, 320);
    for (const state of [aState, bState]) {
      const data = resizeState(raw, tileSize, state, shape.width, shape.height, 3, false);
      const input = new ort.Tensor("float32", data, [1, 3, shape.height, shape.width]);
      try {
        descriptorOutputs.push(await descriptor.session.run({ [descriptorName]: input }));
      } finally {
        input.dispose?.();
      }
    }
    await releaseSession("romaDescriptor");

    const matcher = await loadSession("romaMatcher");
    const feeds = {};
    const matcherNames = matcher.session.inputNames;
    const tensorsA = Object.values(descriptorOutputs[0]);
    const tensorsB = Object.values(descriptorOutputs[1]);
    for (let i = 0; i < matcherNames.length; i += 1) {
      const source = i < Math.ceil(matcherNames.length / 2) ? tensorsA : tensorsB;
      feeds[matcherNames[i]] = source[i % source.length];
    }
    let outputs = null;
    try {
      outputs = await matcher.session.run(feeds);
      return { score: scoreOutputs(outputs), provider: matcher.provider };
    } finally {
      disposeOutputs(outputs);
      await releaseSession("romaMatcher");
    }
  } catch (_) {
    return { score: null, provider: null };
  } finally {
    await releaseSession("romaDescriptor");
    await releaseSession("romaMatcher");
    for (const outputs of descriptorOutputs) disposeOutputs(outputs);
    descriptorOutputs = [];
  }
}

async function classicalScores(raw, tileSize, tileCount, workers, onProgress) {
  const states = tileCount * 4;
  const count = Math.max(1, Math.min(workers, states));
  const output = new Float32Array(4 * states * states);
  const jobs = [];
  let completed = 0;
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
        completed += 1;
        onProgress?.(completed / count);
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

async function refinePairs(scores, raw, tileSize, tileCount, caps, plan, modelStatus) {
  const states = tileCount * 4;
  const candidates = ambiguousCandidates(scores, tileCount, plan.candidateLimit);
  const totalUnits = Math.max(1, plan.pairModels.length * Math.max(1, candidates.length) + (plan.useRoma ? 1 : 0));
  let units = 0;
  for (const key of plan.pairModels) {
    let used = 0;
    let provider = null;
    status(key, `Checking ambiguous seams with ${MODELS[key].name}…`, 0.58 + 0.32 * (units / totalUnits));
    try {
      for (const item of candidates) {
        const result = await runPairModel(key, raw, tileSize, item.a, item.b);
        provider ||= result.provider;
        if (result.score != null) {
          const idx = item.side * states * states + item.a * states + item.b;
          const w = MODELS[key].weight;
          scores[idx] = scores[idx] * (1 - w) + result.score * w;
          used += 1;
        }
        units += 1;
        status(key, `Checking ambiguous seams with ${MODELS[key].name}…`, 0.58 + 0.32 * (units / totalUnits));
      }
      modelStatus[key] = used ? { active: true, provider, evaluated: used } : { active: false, skipped: "no-score" };
    } catch (error) {
      modelStatus[key] = { active: false, error: String(error?.message || error) };
    } finally {
      await releaseSession(key);
    }
  }

  if (plan.useRoma && candidates.length) {
    const item = candidates[0];
    status("roma", "Checking hardest seam with RoMaV2…", 0.92);
    const result = await runRoma(raw, tileSize, item.a, item.b);
    if (result.score != null) {
      const idx = item.side * states * states + item.a * states + item.b;
      const w = MODELS.romaMatcher.weight;
      scores[idx] = scores[idx] * (1 - w) + result.score * w;
      modelStatus.roma = { active: true, provider: result.provider, evaluated: 1 };
    } else modelStatus.roma = { active: false, skipped: result.skipped || "unavailable" };
  } else modelStatus.roma = { active: false, skipped: plan.constrained ? "memory-budget" : "not-required" };
}

async function analyse(data) {
  const caps = await capabilities();
  const raw = new Uint8Array(data.rawBuffer);
  const tileSize = Number(data.tileSize);
  const tileCount = Number(data.tileCount);
  const modelStatus = {};
  const plan = memoryPlan(caps, Boolean(data.pythonResident));

  status("memory", `Using ${plan.workers} CPU worker${plan.workers === 1 ? "" : "s"} · ${caps.memoryTier} memory plan`, 0.02);
  const classicalPromise = classicalScores(raw, tileSize, tileCount, plan.workers, (p) => {
    status("classical", "Scoring picture seams…", 0.04 + p * 0.26);
  });

  let dino = null;
  if (plan.useDino) {
    status("dino", "Loading DINOv2 visual features…", 0.30);
    try {
      dino = await dinoEmbeddings(raw, tileSize, tileCount, (p) => {
        status("dino", "Extracting DINOv2 visual features…", 0.30 + p * 0.24);
      });
      modelStatus.dino = { active: true, provider: dino.provider, evaluated: tileCount };
    } catch (error) {
      modelStatus.dino = { active: false, error: String(error?.message || error) };
      await releaseSession("dino");
    }
  } else modelStatus.dino = { active: false, skipped: "memory-budget" };

  const scores = await classicalPromise;
  if (dino) blendDino(scores, dino.embeddings, tileCount, MODELS.dino.weight);
  dino = null;

  status("ensemble", "Resolving ambiguous seams with learned matchers…", 0.56);
  await refinePairs(scores, raw, tileSize, tileCount, caps, plan, modelStatus);
  await releaseAllSessions();

  status("complete", "Visual evidence ready", 1);
  postMessage({
    type: "ml-result",
    scores,
    states: tileCount * 4,
    capabilities: caps,
    models: modelStatus,
    memoryPlan: plan,
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
    if (type === "dispose") {
      await releaseAllSessions();
      close();
      return;
    }
    throw new Error(`Unknown ML worker message: ${type}`);
  } catch (error) {
    await releaseAllSessions();
    postMessage({ type: "ml-error", message: error instanceof Error ? error.message : String(error) });
  }
});
