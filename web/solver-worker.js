/* Picture Cube Solver Python worker.
 * Camera frames never leave the browser. This worker hosts Pyodide and the
 * Python reconstruction/solver backend so CPU-heavy work never blocks the UI.
 */

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide = null;
let readyPromise = null;
let solverReady = false;

function syncFs(populate) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(populate, (error) => error ? reject(error) : resolve());
  });
}

function status(stage, detail = "") {
  postMessage({ type: "status", stage, detail });
}

async function loadBackendFiles() {
  const files = ["__init__.py", "geometry.py", "vision.py", "reconstruct.py", "centres.py", "backend.py"];
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
    status("runtime", "Loading Python runtime…");
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    status("packages", "Loading NumPy and package installer…");
    await pyodide.loadPackage(["numpy", "micropip"]);

    status("packages", "Installing the pure-Python two-phase cube solver…");
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("rubik-solver-py==0.1.1")
`);

    // Persist generated Kociemba tables in IndexedDB so returning visitors do not
    // rebuild them every time the page is opened. Failure is non-fatal.
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

    status("backend", "Loading picture reconstruction backend…");
    await loadBackendFiles();
    pyodide.runPython("import cube_backend");
    postMessage({ type: "python-ready", version: PYODIDE_VERSION });

    status("tables", "Preparing Kociemba lookup tables in the background…");
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    try { await syncFs(false); } catch (error) { console.warn("Could not persist solver cache", error); }
    solverReady = true;
    postMessage({ type: "solver-ready" });
    status("ready", "Python solver ready");
  })();
  return readyPromise;
}

async function solve(payload) {
  await initialise();
  if (!solverReady) {
    status("tables", "Waiting for solver lookup tables…");
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    solverReady = true;
  }
  status("reconstruct", "Matching picture pieces and enforcing cube legality…");
  const payloadJson = JSON.stringify(payload);
  pyodide.globals.set("_scan_payload_json", payloadJson);
  const resultJson = await pyodide.runPythonAsync("cube_backend.solve_scan(_scan_payload_json)");
  const result = JSON.parse(String(resultJson));
  postMessage({ type: "solution", result });
  status("ready", "Solution ready");
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
