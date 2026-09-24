/* Picture Cube Solver worker.
 * Camera frames never leave the browser. Visual inference and Python solving
 * are deliberately run in separate memory phases on constrained devices.
 */

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const RUNTIME_DB = "picture-cube-solver-runtime";
const RUNTIME_DB_VERSION = 2;
const EVIDENCE_STORE = "evidence";
const REFERENCE_STORE = "reference";
const VISUAL_EVIDENCE_VERSION = 2;
const REFERENCE_EVIDENCE_VERSION = 2;
let pyodide = null;
let readyPromise = null;
let solverTablesReady = false;
let mlWorker = null;
let mlRequest = null;

function status(stage, detail = "", progress = null) {
  postMessage({ type: "status", stage, detail, progress });
}

function friendlyErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const finalLine = [...lines].reverse().find((line) => /^(ValueError|RuntimeError|Error):\s*/.test(line));
  if (finalLine) return finalLine.replace(/^(ValueError|RuntimeError|Error):\s*/, "");
  return lines.at(-1) || "Solve failed";
}

function syncFs(populate) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(populate, (error) => error ? reject(error) : resolve());
  });
}

function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function scanFingerprint(payload) {
  const text = `${VISUAL_EVIDENCE_VERSION}:${payload.size || 3}:${payload.tile_size || 0}:${payload.rgb_b64 || ""}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

function openRuntimeDb() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(RUNTIME_DB, RUNTIME_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) db.createObjectStore(EVIDENCE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(REFERENCE_STORE)) db.createObjectStore(REFERENCE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open runtime storage"));
  });
}

async function loadStoreRecord(storeName, key) {
  let db;
  try {
    db = await openRuntimeDb();
    if (!db.objectStoreNames.contains(storeName)) return null;
    const transaction = db.transaction(storeName, "readonly");
    return await new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Could not read ${storeName}`));
    });
  } catch (_) {
    return null;
  } finally {
    db?.close?.();
  }
}

async function loadEvidenceCheckpoint(key) {
  const record = await loadStoreRecord(EVIDENCE_STORE, key);
  if (!record || Number(record.version) !== VISUAL_EVIDENCE_VERSION) return null;
  return record;
}

async function loadReferenceEvidence(size) {
  const record = await loadStoreRecord(REFERENCE_STORE, "current");
  if (!record?.evidence || Number(record.size) !== Number(size)) return null;
  const evidence = record.evidence;
  if (Number(evidence.version) !== REFERENCE_EVIDENCE_VERSION) return null;
  if (!Number.isFinite(Number(evidence.raw_fit)) || !Number.isFinite(Number(evidence.distinctiveness))) return null;
  return evidence;
}

async function saveEvidenceCheckpoint(key, evidence) {
  let db;
  try {
    db = await openRuntimeDb();
    const transaction = db.transaction(EVIDENCE_STORE, "readwrite");
    const store = transaction.objectStore(EVIDENCE_STORE);
    store.clear();
    store.put({
      key,
      version: VISUAL_EVIDENCE_VERSION,
      states: evidence.states,
      scores: evidence.scores.buffer.slice(evidence.scores.byteOffset, evidence.scores.byteOffset + evidence.scores.byteLength),
      models: evidence.models || {},
      capabilities: evidence.capabilities || {},
      memoryPlan: evidence.memoryPlan || {},
      savedAt: Date.now(),
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save visual checkpoint"));
      transaction.onabort = () => reject(transaction.error || new Error("Could not save visual checkpoint"));
    });
    return true;
  } catch (error) {
    console.warn("Could not checkpoint visual evidence", error);
    return false;
  } finally {
    db?.close?.();
  }
}

function evidenceForPython(evidence, referenceEvidence) {
  if (!evidence && !referenceEvidence) return null;
  const out = {
    version: VISUAL_EVIDENCE_VERSION,
    states: Number(evidence?.states || referenceEvidence?.states || 0),
  };
  if (evidence) {
    const scores = evidence.scores instanceof Float32Array ? evidence.scores : new Float32Array(evidence.scores);
    const bytes = new Uint8Array(scores.buffer, scores.byteOffset, scores.byteLength);
    out.seam_f32_b64 = bytesToBase64(bytes);
    out.models = evidence.models || {};
    out.capabilities = evidence.capabilities || {};
    out.memory_plan = evidence.memoryPlan || {};
  }
  if (referenceEvidence) out.reference_evidence = referenceEvidence;
  return out;
}

function destroyMlWorker() {
  if (!mlWorker) return;
  try { mlWorker.terminate(); } catch (_) {}
  mlWorker = null;
  mlRequest = null;
}

function ensureMlWorker() {
  if (mlWorker) return mlWorker;
  mlWorker = new Worker(new URL("./ml-worker.js", self.location.href), { type: "module" });
  mlWorker.addEventListener("message", (event) => {
    const msg = event.data || {};
    if (msg.type === "ml-status") {
      const local = Number.isFinite(msg.progress) ? Math.max(0, Math.min(1, msg.progress)) : null;
      status(`vision-${msg.stage}`, msg.detail || msg.stage, local == null ? null : 0.04 + local * 0.48);
      return;
    }
    if (msg.type === "ml-result") {
      const pending = mlRequest;
      mlRequest = null;
      if (!pending) return;
      pending.resolve({
        scores: msg.scores instanceof Float32Array ? msg.scores : new Float32Array(msg.scores),
        states: msg.states,
        models: msg.models || {},
        capabilities: msg.capabilities || {},
        memoryPlan: msg.memoryPlan || {},
      });
      return;
    }
    if (msg.type === "ml-error") {
      const pending = mlRequest;
      mlRequest = null;
      pending?.reject(new Error(msg.message || "Visual ensemble failed"));
    }
  });
  mlWorker.addEventListener("error", (event) => {
    const pending = mlRequest;
    mlRequest = null;
    pending?.reject(new Error(event.message || "Visual ensemble worker failed"));
  });
  return mlWorker;
}

async function runVisualEnsemble(payload) {
  if (!payload?.rgb_b64 || !payload?.tile_size) return null;
  if (mlRequest) throw new Error("Visual ensemble is already analysing a scan");
  const raw = base64ToBytes(payload.rgb_b64);
  const tileCount = 6 * Number(payload.size || 3) ** 2;
  status("vision", "Analysing picture continuity…", 0.04);
  return new Promise((resolve, reject) => {
    mlRequest = { resolve, reject };
    const buffer = raw.buffer;
    ensureMlWorker().postMessage({
      type: "analyse",
      rawBuffer: buffer,
      tileSize: Number(payload.tile_size),
      tileCount,
      pythonResident: Boolean(pyodide),
    }, [buffer]);
  });
}

async function loadBackendFiles() {
  const files = [
    "__init__.py", "geometry.py", "vision.py", "reconstruct.py", "centres.py", "centre_fit.py",
    "generic.py", "surface.py", "pocket.py", "bigcube.py", "backend.py",
  ];
  pyodide.FS.mkdirTree("/app/cube_backend");
  for (const file of files) {
    const url = new URL(`./py/cube_backend/${file}`, self.location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
    pyodide.FS.writeFile(`/app/cube_backend/${file}`, await response.text(), { encoding: "utf8" });
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/app')");
}

async function initialisePython(size) {
  if (!readyPromise) {
    readyPromise = (async () => {
      status("runtime", "Loading Python runtime…", 0.60);
      importScripts(`${PYODIDE_BASE}pyodide.js`);
      pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

      status("packages", "Loading solver packages…", 0.68);
      await pyodide.loadPackage(["numpy", "micropip"]);
      await pyodide.runPythonAsync(`
import micropip
await micropip.install("rubik-solver-py==0.1.1")
`);

      try {
        pyodide.FS.mkdirTree("/solver-cache");
        pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, "/solver-cache");
        await syncFs(true);
        pyodide.runPython(`
import os
os.environ["RUBIK_SOLVER_CACHE_DIR"] = "/solver-cache/rubik_solver"
`);
      } catch (error) {
        console.warn("Persistent solver cache unavailable", error);
      }

      status("backend", "Loading cube reconstruction backend…", 0.75);
      await loadBackendFiles();
      pyodide.runPython("import cube_backend");
      postMessage({ type: "python-ready", version: PYODIDE_VERSION });
    })();
  }
  await readyPromise;

  if (Number(size) === 3 && !solverTablesReady) {
    status("tables", "Preparing 3×3 solver tables…", 0.81);
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    solverTablesReady = true;
    try { await syncFs(false); } catch (error) { console.warn("Could not persist solver cache", error); }
  }
}

async function solve(payload) {
  const size = Number(payload.size || 3);
  const fingerprint = scanFingerprint(payload);
  status("checkpoint", "Checking saved visual work…", 0.02);

  let evidence = await loadEvidenceCheckpoint(fingerprint);
  if (evidence) {
    status("checkpoint", "Reusing saved visual analysis…", 0.52);
  } else {
    try {
      evidence = await runVisualEnsemble(payload);
      if (evidence) {
        status("offload", "Saving visual work before loading the solver…", 0.54);
        const saved = await saveEvidenceCheckpoint(fingerprint, evidence);
        if (saved) evidence = null;
      }
    } catch (error) {
      console.warn("Visual ensemble unavailable; continuing with deterministic CV", error);
      evidence = null;
      status("vision-fallback", "Using deterministic picture matching…", 0.54);
    }
  }

  destroyMlWorker();
  status("memory-release", "Released ML/GPU memory · loading solver…", 0.57);
  await initialisePython(size);

  if (!evidence) evidence = await loadEvidenceCheckpoint(fingerprint);
  const referenceEvidence = await loadReferenceEvidence(size);
  if (referenceEvidence) status("reference", `Using reference for ${referenceEvidence.subject || "recognised artwork"}…`, 0.84);
  payload.visual_evidence = evidenceForPython(evidence, referenceEvidence);
  evidence = null;

  status("reconstruct", `Reconstructing ${size}×${size}×${size} picture cube…`, 0.87);
  const payloadJson = JSON.stringify(payload);
  pyodide.globals.set("_scan_payload_json", payloadJson);

  const progressCallback = (detail, progress) => {
    const value = Number(progress);
    status(
      "solve-detail",
      String(detail || "Evaluating legal cube hypotheses…"),
      Number.isFinite(value) ? Math.max(0.94, Math.min(0.991, value)) : null,
    );
  };
  pyodide.globals.set("_solver_progress_callback", progressCallback);
  await pyodide.runPythonAsync("cube_backend.set_progress_callback(_solver_progress_callback)");
  status("solve", "Starting legal mapping and move search…", 0.94);

  let resultJson;
  try {
    resultJson = await pyodide.runPythonAsync("cube_backend.solve_scan(_scan_payload_json)");
  } finally {
    try { await pyodide.runPythonAsync("cube_backend.set_progress_callback(None)"); } catch (_) {}
  }
  const result = JSON.parse(String(resultJson));
  status("complete", "Solved", 1);
  postMessage({ type: "solution", result });
  status("ready", "Ready", null);
}

self.addEventListener("message", async (event) => {
  const { type } = event.data || {};
  try {
    if (type === "warm") {
      status("ready", "Ready", null);
      postMessage({ type: "solver-ready" });
      return;
    }
    if (type === "solve") {
      await solve(event.data.payload);
      return;
    }
    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    console.error(error);
    destroyMlWorker();
    postMessage({
      type: "error",
      message: friendlyErrorMessage(error),
      stack: error instanceof Error ? error.stack : "",
    });
  }
});
