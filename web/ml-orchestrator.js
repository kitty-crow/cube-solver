import { capabilityLabel } from "./ml-capabilities.js";

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function tilesToRgb(tiles) {
  if (!tiles.length) return { rgb: new Uint8Array(), tileSize: 0 };
  const tileSize = tiles[0].width;
  const rgb = new Uint8Array(tiles.length * tileSize * tileSize * 3);
  let write = 0;
  for (const tile of tiles) {
    if (tile.width !== tileSize || tile.height !== tileSize) throw new Error("ML tiles must have equal square dimensions");
    const data = tile.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, tileSize, tileSize).data;
    for (let p = 0; p < data.length; p += 4) {
      rgb[write++] = data[p];
      rgb[write++] = data[p + 1];
      rgb[write++] = data[p + 2];
    }
  }
  return { rgb, tileSize };
}

class MlEnsemble {
  constructor() {
    this.worker = null;
    this.readyPromise = null;
    this.pending = null;
    this.capabilities = null;
  }

  _ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./ml-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => this._onMessage(event.data || {}));
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "ML worker failed");
      if (this.pending) {
        this.pending.reject(error);
        this.pending = null;
      }
    });
    this.worker = worker;
    return worker;
  }

  _onMessage(message) {
    if (message.type === "ml-ready") {
      this.capabilities = message.capabilities;
      this._readyResolve?.(message.capabilities);
      this._readyResolve = null;
      return;
    }
    if (message.type === "ml-status") {
      this.pending?.onStatus?.(message.detail || message.stage);
      return;
    }
    if (message.type === "ml-result") {
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      const scores = message.scores instanceof Float32Array ? message.scores : new Float32Array(message.scores);
      const bytes = new Uint8Array(scores.buffer, scores.byteOffset, scores.byteLength);
      pending.resolve({
        version: 1,
        states: message.states,
        seam_f32_b64: bytesToBase64(bytes),
        models: message.models || {},
        capabilities: message.capabilities || this.capabilities || {},
      });
      return;
    }
    if (message.type === "ml-error") {
      const pending = this.pending;
      this.pending = null;
      pending?.reject(new Error(message.message || "ML analysis failed"));
    }
  }

  warm() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve;
      this._ensureWorker().postMessage({ type: "warm" });
      setTimeout(() => {
        if (this._readyResolve) {
          this._readyResolve(null);
          this._readyResolve = null;
        }
      }, 8000);
    });
    return this.readyPromise;
  }

  async analyse(tiles, onStatus = null) {
    await this.warm();
    if (this.pending) throw new Error("ML analysis is already running");
    const { rgb, tileSize } = tilesToRgb(tiles);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, onStatus };
      const buffer = rgb.buffer;
      this._ensureWorker().postMessage({
        type: "analyse",
        rawBuffer: buffer,
        tileSize,
        tileCount: tiles.length,
      }, [buffer]);
    });
  }

  label() {
    return this.capabilities ? capabilityLabel(this.capabilities) : "";
  }
}

export const mlEnsemble = new MlEnsemble();
