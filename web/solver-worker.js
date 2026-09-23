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
  const files = [
    "__init__.py", "geometry.py", "generic.py", "vision.py", "reconstruct.py",
    "centres.py", "pocket.py", "bigcube.py", "backend.py",
  ];
  pyodide.FS.mkdirTree("/app/cube_backend");
  for (const file of files) {
    const url = new URL(`./py/cube_backend/${file}`, self.location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${file}: ${response.status}`);
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
    await pyodide.loadPackage(["numpy", "micropip"]);

    status("packages", "Loading solver…");
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
      console.warn("Solver cache unavailable", error);
    }

    await loadBackendFiles();
    pyodide.runPython("import cube_backend");
    postMessage({ type: "python-ready", version: PYODIDE_VERSION });

    status("tables", "Preparing…");
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    try { await syncFs(false); } catch (error) { console.warn("Could not persist solver cache", error); }
    solverReady = true;
    postMessage({ type: "solver-ready" });
    status("ready", "Ready");
  })();
  return readyPromise;
}

async function solve(payload) {
  await initialise();
  if (!solverReady) {
    await pyodide.runPythonAsync("cube_backend.warm_solver()");
    solverReady = true;
  }
  status("solve", "Solving…");
  pyodide.globals.set("_scan_payload_json", JSON.stringify(payload));
  const resultJson = await pyodide.runPythonAsync("cube_backend.solve_scan(_scan_payload_json)");
  const result = JSON.parse(String(resultJson));
  postMessage({ type: "solution", result });
  status("ready", "Ready");
}

self.addEventListener("message", async (event) => {
  const { type } = event.data || {};
  try {
    if (type === "warm") await initialise();
    else if (type === "solve") await solve(event.data.payload);
    else throw new Error(`Unknown worker message: ${type}`);
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
