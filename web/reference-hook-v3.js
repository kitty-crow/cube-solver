import { loadScan } from "./scan-store.js";
import { buildPayloadFromCaptures } from "./scan-geometry.js";
import { ReferenceAssistant } from "./reference-ui-v6.js";

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

function updateReferenceSolveLabel() {
  if (!assistant.selectedEvidence()) return;
  solveButton.textContent = assistant.identificationResolved?.() ? "Solve identified cube" : "Identify stickers";
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
let restoreAttemptedKey = "";

async function refreshAvailability() {
  const payload = await savedPayload().catch(() => null);
  if (!payload) {
    analysedKey = "";
    allowSolve = false;
    failedSubject = "";
    restoreAttemptedKey = "";
    assistant.invalidate();
    assistant.panel.hidden = true;
    return;
  }
  assistant.panel.hidden = false;
  assistant.lastPayload = payload;
  const key = payloadKey(payload);

  if (key !== restoreAttemptedKey && !assistant.pending) {
    restoreAttemptedKey = key;
    const restored = await assistant.restorePersisted(payload).catch((error) => {
      console.warn("Could not restore saved reference mapping", error);
      return false;
    });
    if (restored) {
      analysedKey = key;
      allowSolve = Boolean(assistant.selectedEvidence());
      failedSubject = "";
      solveButton.disabled = false;
      updateReferenceSolveLabel();
      hideSemanticProgress();
      return;
    }
  }

  if (key !== analysedKey && !assistant.pending) assistant.statusEl.textContent = "Ready to identify six faces";
}

function invalidateForScanChange() {
  analysedKey = "";
  allowSolve = false;
  failedSubject = "";
  restoreAttemptedKey = "";
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
  restoreAttemptedKey = "";
  hideSemanticProgress();
  assistant.clearPersistedSession?.().catch(() => {});
  assistant.invalidate();
  assistant.panel.hidden = true;
});
window.addEventListener("picture-reference-ready", () => {
  if (!assistant.selectedEvidence()) return;
  allowSolve = true;
  failedSubject = "";
  hideSemanticProgress();
  solveButton.disabled = false;
  updateReferenceSolveLabel();
});
window.addEventListener("picture-stickers-resolved", () => {
  allowSolve = true;
  hideSemanticProgress();
  solveButton.disabled = false;
  solveButton.textContent = "Solve identified cube";
  workerStatus.textContent = "Unique legal scramble identified";
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

solveButton.addEventListener("click", (event) => {
  const currentSubject = assistant.subjectEl.value.trim();
  const subjectMatches = !currentSubject || currentSubject === assistant.lastSubject || currentSubject === failedSubject;
  const evidence = assistant.selectedEvidence();
  if (allowSolve && subjectMatches && evidence) {
    if (Number(assistant.lastPayload?.size) === 3 && !assistant.identificationResolved?.()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      solveButton.textContent = "Identify stickers";
      assistant.openStickerIdentification().catch((error) => {
        console.warn("Could not open sticker identification", error);
        workerStatus.textContent = error instanceof Error ? error.message : String(error);
      });
      return;
    }
    allowSolve = false;
    hideSemanticProgress();
    assistant.persistSelected().catch(() => {});
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  if (analysing) return;

  if (assistant.result && assistant.lastKey && subjectMatches && !assistant.selectedEvidence()) {
    solveButton.textContent = "Choose a reference";
    assistant.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  analysing = true;
  solveButton.disabled = true;
  solveButton.textContent = "Finding artwork…";
  assistant.panel.hidden = false;
  semanticProgress("Recognising six faces…", 0.01);

  (async () => {
    const payload = await savedPayload().catch(() => null);
    if (!payload) throw new Error("Saved scan is not ready yet");
    const key = payloadKey(payload);
    assistant.lastPayload = payload;
    const result = await assistant.analyse(payload, currentSubject);
    analysedKey = key;
    restoreAttemptedKey = key;
    failedSubject = "";
    allowSolve = Boolean(assistant.selectedEvidence());
    if (allowSolve) updateReferenceSolveLabel(); else solveButton.textContent = "Choose a reference";
    assistant.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return result;
  })().catch((error) => {
    console.warn("Semantic reference search failed", error);
    failedSubject = currentSubject;
    allowSolve = true;
    solveButton.textContent = "Solve without reference";
  }).finally(() => {
    hideSemanticProgress();
    solveButton.disabled = false;
    analysing = false;
  });
}, true);
