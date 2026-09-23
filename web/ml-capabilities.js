export async function detectMlCapabilities() {
  const hardwareConcurrency = Math.max(1, Number(globalThis.navigator?.hardwareConcurrency || 1));
  const deviceMemory = Number(globalThis.navigator?.deviceMemory || 0);
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  const wasmThreads = crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  const wasmSIMD = typeof WebAssembly !== "undefined";

  let webgpu = false;
  let adapterInfo = null;
  if (globalThis.navigator?.gpu?.requestAdapter) {
    try {
      let adapter = await globalThis.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) adapter = await globalThis.navigator.gpu.requestAdapter({ powerPreference: "low-power" });
      if (adapter) {
        webgpu = true;
        adapterInfo = {
          maxBufferSize: Number(adapter.limits?.maxBufferSize || 0),
          maxStorageBufferBindingSize: Number(adapter.limits?.maxStorageBufferBindingSize || 0),
        };
      }
    } catch (_) {}
  }

  let webgl2 = false;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(2, 2)
      : globalThis.document?.createElement?.("canvas");
    webgl2 = Boolean(canvas?.getContext?.("webgl2", { powerPreference: "high-performance" }));
  } catch (_) {}

  const cpuWorkers = Math.max(1, Math.min(8, hardwareConcurrency > 2 ? hardwareConcurrency - 1 : 1));
  const neuralBackend = webgpu ? "webgpu" : webgl2 ? "webgl" : "wasm";
  const imageBackend = webgpu ? "webgpu" : webgl2 ? "webgl2" : cpuWorkers > 1 ? "workers" : "wasm";

  return {
    webgpu,
    webgl2,
    wasmThreads,
    wasmSIMD,
    crossOriginIsolated,
    hardwareConcurrency,
    deviceMemory,
    cpuWorkers,
    adapterInfo,
    neuralBackend,
    imageBackend,
    searchBackend: cpuWorkers > 1 ? "workers" : "single-worker",
  };
}

export function capabilityLabel(capabilities) {
  const parts = [];
  if (capabilities.webgpu) parts.push("WebGPU");
  else if (capabilities.webgl2) parts.push("WebGL2");
  else parts.push("WASM");
  if (capabilities.cpuWorkers > 1) parts.push(`${capabilities.cpuWorkers} CPU workers`);
  if (capabilities.wasmSIMD) parts.push("SIMD");
  return parts.join(" · ");
}
