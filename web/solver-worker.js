/* Picture Cube Solver Python worker.
 * Camera frames never leave the browser. This worker hosts Pyodide and the
 * Python reconstruction/solver backend so CPU-heavy work never blocks the UI.
 */

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide = null;
let readyPromise = null;
let solverReady = false;
let mlWorker = null;
let mlRequest = null;

function syncFs(populate) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(populate, (error) => error ? reject(error) : resolve());
  });
}

function status(stage, detail = "") {
  postMessage({ type: "status", stage, detail });
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

function ensureMlWorker() {
  if (mlWorker) return mlWorker;
  mlWorker = new Worker(new URL("./ml-worker.js", self.location.href), { type: "module" });
  mlWorker.addEventListener("message", (event) => {
    const msg = event.data || {};
    if (msg.type === "ml-status") {
      status(`vision-${msg.stage}`, msg.detail || msg.stage);
      return;
    }
    if (msg.type === "ml-result") {
      const pending = mlRequest;
      mlRequest = null;
      if (!pending) return;
      const scores = msg.scores instanceof Float32Array ? msg.scores : new Float32Array(msg.scores);
      const bytes = new Uint8Array(scores.buffer, scores.byteOffset, scores.byteLength);
      pending.resolve({
        version: 1,
        states: msg.states,
        seam_f32_b64: bytesToBase64(bytes),
        models: msg.models || {},
        capabilities: msg.capabilities || {},
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
  mlWorker.postMessage({ type: "warm" });
  return mlWorker;
}

async function runVisualEnsemble(payload) {
  if (!payload?.rgb_b64 || !payload?.tile_size) return null;
  if (mlRequest) throw new Error("Visual ensemble is already analysing a scan");
  const raw = base64ToBytes(payload.rgb_b64);
  const tileCount = 6 * Number(payload.size || 3) ** 2;
  status("vision", "Analysing picture continuity…");
  return new Promise((resolve, reject) => {
    mlRequest = { resolve, reject };
    const buffer = raw.buffer;
    ensureMlWorker().postMessage({
      type: "analyse",
      rawBuffer: buffer,
      tileSize: Number(payload.tile_size),
      tileCount,
    }, [buffer]);
  });
}

async function loadBackendFiles() {
  const files = [
    "__init__.py", "geometry.py", "vision.py", "reconstruct.py", "centres.py",
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

async function initialise() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    status("runtime", "Loading Python…");
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    status("packages", "Loading packages…");
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

    await loadBackendFiles();
    pyodide.runPython("import cube_backend");
    postMessage({ type: "python-ready", version: PYODIDE_VERSION });

    status("tables", "Preparing 3×3 tables…");
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    try { await syncFs(false); } catch (error) { console.warn("Could not persist solver cache", error); }
    solverReady = true;
    postMessage({ type: "solver-ready" });
    status("ready", "Ready");

    // Warm capability detection independently. Model weights remain lazy so a
    // user who never solves a scan does not pay the network/memory cost.
    try { ensureMlWorker(); } catch (error) { console.warn("ML worker unavailable", error); }
  })();
  return readyPromise;
}

async function solve(payload) {
  await initialise();
  if (!solverReady) {
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    solverReady = true;
  }

  try {
    payload.visual_evidence = await runVisualEnsemble(payload);
  } catch (error) {
    console.warn("Visual ensemble unavailable; continuing with deterministic CV", error);
    payload.visual_evidence = null;
    status("vision-fallback", "Using deterministic picture matching…");
  }

  status("reconstruct", `Solving ${payload.size || 3}×${payload.size || 3}×${payload.size || 3}…`);
  const payloadJson = JSON.stringify(payload);
  pyodide.globals.set("_scan_payload_json", payloadJson);
  const resultJson = await pyodide.runPythonAsync("cube_backend.solve_scan(_scan_payload_json)");
  const result = JSON.parse(String(resultJson));
  postMessage({ type: "solution", result });
  status("ready", "Ready");
}

self.addEventListener("message", async (event) => {
  const { type } = event.data || {};
  try {
    if (type === "warm") {
      await initialise();
      return;
    }
    if (type === "solve") {
      await solve(event.data.payload);
      return;
    }
    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    console.error(error);
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "",
    });
  }
});

initialise().catch((error) => {
  console.error(error);
  postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
});
