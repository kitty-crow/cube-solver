import { loadScan } from "./scan-store.js";
import { ReferenceAssistant } from "./reference-ui.js";

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const TILE_SIZE = 48;

function rotateCanvas(source, quarters) {
  const q = ((quarters % 4) + 4) % 4;
  if (!q) return source;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(q * Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function savedPayload() {
  const saved = await loadScan();
  if (!saved || saved.captures.size !== 6) return null;
  const size = saved.size;
  const tileCount = 6 * size * size;
  const rgb = new Uint8Array(tileCount * TILE_SIZE * TILE_SIZE * 3);
  let write = 0;
  const tile = document.createElement("canvas");
  tile.width = TILE_SIZE;
  tile.height = TILE_SIZE;
  const ctx = tile.getContext("2d", { alpha: false, willReadFrequently: true });

  for (const face of FACE_ORDER) {
    const capture = saved.captures.get(face);
    if (!capture) return null;
    const source = rotateCanvas(capture, saved.rotations.get(face) || 0);
    const cell = source.width / size;
    const inset = cell * 0.055;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
        ctx.drawImage(source, col * cell + inset, row * cell + inset, cell - 2 * inset, cell - 2 * inset, 0, 0, TILE_SIZE, TILE_SIZE);
        const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
        for (let p = 0; p < data.length; p += 4) {
          rgb[write++] = data[p];
          rgb[write++] = data[p + 1];
          rgb[write++] = data[p + 2];
        }
      }
    }
  }
  return { size, tile_size: TILE_SIZE, rgb_b64: bytesToBase64(rgb), savedAt: saved.savedAt };
}

function payloadKey(payload) {
  if (!payload) return "";
  return `${payload.size}:${payload.savedAt}:${payload.rgb_b64.length}:${payload.rgb_b64.slice(0, 20)}:${payload.rgb_b64.slice(-20)}`;
}

const solveButton = document.querySelector("#solve-cube");
const reviewGrid = document.querySelector("#review-grid");
const workerStatus = document.querySelector("#worker-status");
const assistant = new ReferenceAssistant({
  onStatus(detail) {
    if (workerStatus && detail) workerStatus.textContent = detail;
  },
});
window.pictureReference = assistant;

let analysedKey = "";
let analysing = false;
let scanRefreshTimer = null;

async function refreshAvailability() {
  const payload = await savedPayload().catch(() => null);
  if (!payload) {
    analysedKey = "";
    assistant.invalidate();
    assistant.panel.hidden = true;
    return;
  }
  assistant.panel.hidden = false;
  assistant.lastPayload = payload;
  const key = payloadKey(payload);
  if (key !== analysedKey && !assistant.pending) {
    assistant.statusEl.textContent = "Ready to identify six faces";
  }
}

new MutationObserver(() => {
  clearTimeout(scanRefreshTimer);
  scanRefreshTimer = setTimeout(refreshAvailability, 180);
}).observe(reviewGrid, { childList: true, subtree: true });
setTimeout(refreshAvailability, 250);

solveButton.addEventListener("click", async (event) => {
  if (analysing) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const payload = await savedPayload().catch(() => null);
  if (!payload) return;
  const key = payloadKey(payload);
  const currentSubject = assistant.subjectEl.value.trim();
  const ready = analysedKey === key && assistant.result && (!currentSubject || currentSubject === assistant.lastSubject);
  if (ready) {
    await assistant.persistSelected().catch(() => {});
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  analysing = true;
  const oldText = solveButton.textContent;
  solveButton.disabled = true;
  solveButton.textContent = "Identifying artwork…";
  assistant.panel.hidden = false;
  assistant.lastPayload = payload;
  try {
    await assistant.analyse(payload, currentSubject);
    analysedKey = key;
    solveButton.textContent = assistant.selectedEvidence() ? "Solve with reference" : "Solve without reference";
    assistant.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    console.warn("Semantic reference analysis failed", error);
    analysedKey = key;
    solveButton.textContent = "Solve without reference";
  } finally {
    solveButton.disabled = false;
    if (!assistant.result && oldText) solveButton.textContent = "Solve without reference";
    analysing = false;
  }
}, true);
