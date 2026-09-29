export async function detectMlCapabilities() {
  const hardwareConcurrency = Math.max(1, Number(globalThis.navigator?.hardwareConcurrency || 1));
  const deviceMemory = Number(globalThis.navigator?.deviceMemory || 0);
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  const wasmThreads = crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  const wasmSIMD = typeof WebAssembly !== "undefined";
  const userAgent = String(globalThis.navigator?.userAgent || "");
  const mobile = Boolean(globalThis.navigator?.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const heapLimitBytes = Number(globalThis.performance?.memory?.jsHeapSizeLimit || 0);
  const heapLimitMB = heapLimitBytes > 0 ? Math.floor(heapLimitBytes / 1048576) : 0;

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

  let memoryTier = "low";
  if ((deviceMemory >= 8 || heapLimitMB >= 3072) && !mobile) memoryTier = "high";
  else if (deviceMemory >= 4 || heapLimitMB >= 1536 || (!mobile && hardwareConcurrency >= 8)) memoryTier = "medium";

  // Browsers do not expose exact free RAM. Use a deliberately conservative
  // working-set budget and never assume unknown mobile memory is plentiful.
  let memoryBudgetMB;
  if (deviceMemory > 0) memoryBudgetMB = Math.floor(Math.min(1536, Math.max(256, deviceMemory * 1024 * 0.20)));
  else if (heapLimitMB > 0) memoryBudgetMB = Math.floor(Math.min(1536, Math.max(256, heapLimitMB * 0.35)));
  else memoryBudgetMB = mobile ? 320 : memoryTier === "high" ? 1024 : 640;

  const maxWorkersByMemory = memoryTier === "low" ? 2 : memoryTier === "medium" ? 4 : 8;
  const cpuWorkers = Math.max(1, Math.min(maxWorkersByMemory, hardwareConcurrency > 2 ? hardwareConcurrency - 1 : 1));
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
    heapLimitMB,
    mobile,
    memoryTier,
    memoryBudgetMB,
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
  if (capabilities.memoryTier) parts.push(`${capabilities.memoryTier} memory`);
  return parts.join(" · ");
}
