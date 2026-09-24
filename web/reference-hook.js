import { loadScan } from "./scan-store.js";
import { buildPayloadFromCaptures } from "./scan-geometry.js";
import { ReferenceAssistant } from "./reference-ui-v2.js";

const TILE_SIZE = 48;
const ROUNDED_SETTING = "picture-cube-rounded-cubies";

async function savedPayload() {
  const saved = await loadScan();
  if (!saved || saved.captures.size !== 6) return null;
  const rounded = localStorage.getItem(ROUNDED_SETTING) === "1";
  const prepared = buildPayloadFromCaptures(saved.captures, saved.rotations, saved.size, TILE_SIZE, rounded);
  return { ...prepared.payload, savedAt: saved.savedAt };
}

function payloadKey(payload) {
  if (!payload) return "";
  return `${payload.size}:${payload.savedAt}:${payload.rounded_cubies ? 1 : 0}:${payload.rgb_b64.length}:${payload.rgb_b64.slice(0, 20)}:${payload.rgb_b64.slice(-20)}`;
}

const solveButton = document.querySelector("#solve-cube");
const reviewGrid = document.querySelector("#review-grid");
const workerStatus = document.querySelector("#worker-status");
const solveProgressWrap = document.querySelector("#solve-progress-wrap");
const solveProgressTrack = document.querySelector("#solve-progress-track");
const solveProgressBar = document.querySelector("#solve-progress-bar");
const solveProgressLabel = document.querySelector("#solve-progress-label");
const solveProgressValue = document.querySelector("#solve-progress-value");

function semanticProgress(detail, progress) {
  if (!solveProgressWrap || !Number.isFinite(progress)) return;
  const value = Math.max(0, Math.min(1, Number(progress)));
  const percent = Math.round(value * 100);
  solveProgressWrap.hidden = false;
  solveProgressBar.style.width = `${percent}%`;
  solveProgressValue.textContent = `${percent}%`;
  solveProgressTrack.setAttribute("aria-valuenow", String(percent));
  solveProgressLabel.textContent = detail || "Identifying artwork…";
}

function hideSemanticProgress() {
  if (!solveProgressWrap) return;
  solveProgressWrap.hidden = true;
  solveProgressBar.style.width = "0%";
  solveProgressValue.textContent = "0%";
  solveProgressTrack.setAttribute("aria-valuenow", "0");
}

const assistant = new ReferenceAssistant({
  onStatus(detail, progress) {
    if (workerStatus && detail) workerStatus.textContent = detail;
    semanticProgress(detail, progress);
  },
});
window.pictureReference = assistant;

let analysedKey = "";
let analysing = false;
let allowSolve = false;
let failedSubject = "";
let scanRefreshTimer = null;

async function refreshAvailability() {
  const payload = await savedPayload().catch(() => null);
  if (!payload) {
    analysedKey = "";
    allowSolve = false;
    failedSubject = "";
    assistant.invalidate();
    assistant.panel.hidden = true;
    return;
  }
  assistant.panel.hidden = false;
  assistant.lastPayload = payload;
  const key = payloadKey(payload);
  if (key !== analysedKey && !assistant.pending) assistant.statusEl.textContent = "Ready to identify six faces";
}

function invalidateForScanChange() {
  analysedKey = "";
  allowSolve = false;
  failedSubject = "";
  hideSemanticProgress();
  assistant.invalidate();
  clearTimeout(scanRefreshTimer);
  scanRefreshTimer = setTimeout(refreshAvailability, 180);
}

new MutationObserver(invalidateForScanChange).observe(reviewGrid, { childList: true, subtree: true });
window.addEventListener("picture-scan-geometry-changed", invalidateForScanChange);
window.addEventListener("picture-image-memory-cleared", () => {
  analysedKey = "";
  allowSolve = false;
  failedSubject = "";
  hideSemanticProgress();
  assistant.invalidate();
  assistant.panel.hidden = true;
});
setTimeout(refreshAvailability, 250);

assistant.subjectEl.addEventListener("input", () => {
  allowSolve = false;
  failedSubject = "";
});
assistant.searchButton.addEventListener("click", () => {
  allowSolve = false;
  failedSubject = "";
});
assistant.candidatesEl.addEventListener("click", () => {
  queueMicrotask(() => { if (assistant.selectedEvidence()) allowSolve = true; });
});

solveButton.addEventListener("click", (event) => {
  const currentSubject = assistant.subjectEl.value.trim();
  const subjectMatches = !currentSubject || currentSubject === assistant.lastSubject || currentSubject === failedSubject;
  if (allowSolve && subjectMatches) {
    allowSolve = false;
    hideSemanticProgress();
    assistant.persistSelected().catch(() => {});
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  if (analysing) return;

  analysing = true;
  solveButton.disabled = true;
  solveButton.textContent = "Identifying artwork…";
  assistant.panel.hidden = false;
  semanticProgress("Recognising six faces…", 0.01);

  (async () => {
    const payload = await savedPayload().catch(() => null);
    if (!payload) throw new Error("Saved scan is not ready yet");
    const key = payloadKey(payload);
    assistant.lastPayload = payload;
    const result = await assistant.analyse(payload, currentSubject);
    analysedKey = key;
    failedSubject = "";
    allowSolve = true;
    solveButton.textContent = assistant.selectedEvidence() ? "Solve with reference" : "Solve without reference";
    assistant.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return result;
  })().catch((error) => {
    console.warn("Semantic reference analysis failed", error);
    failedSubject = currentSubject;
    allowSolve = true;
    solveButton.textContent = "Solve without reference";
  }).finally(() => {
    hideSemanticProgress();
    solveButton.disabled = false;
    analysing = false;
  });
}, true);
