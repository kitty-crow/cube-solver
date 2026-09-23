import { CubeView } from "./cube-view.js";

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const TILE_SIZE = 48;
const CAPTURE_SIZE = 768;

const $ = (selector) => document.querySelector(selector);
const video = $("#camera");
const captureCanvas = $("#capture-canvas");
const cameraStage = document.querySelector(".camera-stage");
const probeCanvas = $("#probe-canvas");
const startButton = $("#start-camera");
const captureButton = $("#capture-face");
const autoToggle = $("#auto-capture");
const solveButton = $("#solve-cube");
const cubeSizeSelect = $("#cube-size");
const faceGuide = $("#face-guide");
const turnCubeSize = $("#turn-cube-size");
const scanTitle = $("#scan-title");
const scanInstruction = $("#scan-instruction");
const scanCounter = $("#scan-counter");
const progressBar = $("#scan-progress");
const stabilityLabel = $("#stability-label");
const reviewGrid = $("#review-grid");
const workerStatus = $("#worker-status");
const resultPanel = $("#result-panel");
const resultSummary = $("#result-summary");
const moveText = $("#move-text");
const moveDetail = $("#move-detail");
const prevButton = $("#prev-move");
const nextButton = $("#next-move");
const playButton = $("#play-moves");
const resetButton = $("#reset-playback");
const confidenceText = $("#confidence-text");
const cubeContainer = $("#cube-view");

let cubeSize = Number(cubeSizeSelect.value);
let stream = null;
let scanIndex = 0;
let retakeFace = null;
let captures = new Map();
let captureRotations = new Map();
let workerReady = false;
let pythonReady = false;
let solving = false;
let previousProbe = null;
let stableSince = 0;
let autoLatch = false;
let solution = null;
let moveIndex = 0;
let playing = false;
let cubeView = null;

function faceSequence() {
  const n = `${cubeSize}×${cubeSize}`;
  return [
    { face: "F", short: "Front", title: "Scan front", instruction: `Choose a front face and centre the ${n} grid.` },
    { face: "R", short: "Right", title: "Scan right", instruction: "Rotate the whole cube 90° clockwise as viewed from above." },
    { face: "B", short: "Back", title: "Scan back", instruction: "Rotate the whole cube 90° clockwise again." },
    { face: "L", short: "Left", title: "Scan left", instruction: "Rotate the whole cube 90° clockwise again." },
    { face: "U", short: "Top", title: "Scan top", instruction: "Return to the original front. Tilt the top towards the camera with the original front edge at the bottom." },
    { face: "D", short: "Bottom", title: "Scan bottom", instruction: "Return to the original front. Tilt the bottom towards the camera with the original front edge at the top." },
  ];
}

const worker = new Worker(new URL("./solver-worker.js", import.meta.url));
worker.postMessage({ type: "warm" });
worker.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "status") workerStatus.textContent = msg.detail || msg.stage;
  else if (msg.type === "python-ready") {
    pythonReady = true;
    workerStatus.textContent = `Python ${msg.version}`;
  } else if (msg.type === "solver-ready") {
    workerReady = true;
    workerStatus.textContent = "Ready";
    updateSolveButton();
  } else if (msg.type === "solution") {
    solving = false;
    showSolution(msg.result).catch(showError);
    updateSolveButton();
  } else if (msg.type === "error") {
    solving = false;
    showError(new Error(msg.message || "Worker failed"));
    updateSolveButton();
  }
});

function currentStep() {
  const sequence = faceSequence();
  if (retakeFace) return sequence.find((s) => s.face === retakeFace);
  return sequence[Math.min(scanIndex, sequence.length - 1)];
}

function renderGuide() {
  faceGuide.textContent = "";
  for (let i = 1; i < cubeSize; i += 1) {
    const pct = `${(i / cubeSize) * 100}%`;
    const v = document.createElement("span");
    v.className = "face-guide__line face-guide__line--v";
    v.style.left = pct;
    const h = document.createElement("span");
    h.className = "face-guide__line face-guide__line--h";
    h.style.top = pct;
    faceGuide.append(v, h);
  }
  turnCubeSize.textContent = `${cubeSize}×${cubeSize}`;
}

function updateScanUI() {
  const step = currentStep();
  if (captures.size >= 6 && !retakeFace) {
    scanTitle.textContent = "Ready to solve";
    scanInstruction.textContent = "Retake or rotate a capture if needed.";
    scanCounter.textContent = "6 / 6";
    progressBar.style.width = "100%";
    captureButton.disabled = true;
  } else {
    scanTitle.textContent = step.title;
    scanInstruction.textContent = retakeFace ? `Retake ${step.short}. ${step.instruction}` : step.instruction;
    const shown = retakeFace ? captures.size : scanIndex;
    scanCounter.textContent = `${Math.min(6, shown + 1)} / 6`;
    progressBar.style.width = `${(captures.size / 6) * 100}%`;
    captureButton.disabled = !stream;
  }
  updateSolveButton();
}

function updateSolveButton() {
  solveButton.disabled = captures.size !== 6 || solving || !workerReady;
  if (captures.size === 6 && !workerReady) solveButton.textContent = pythonReady ? "Preparing…" : "Loading Python…";
  else if (solving) solveButton.textContent = "Solving…";
  else solveButton.textContent = `Solve ${cubeSize}×${cubeSize}×${cubeSize}`;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable.");
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  startButton.hidden = true;
  cameraStage?.classList.add("camera-stage--live");
  captureButton.disabled = false;
  updateScanUI();
  requestAnimationFrame(stabilityLoop);
}

function cropFromVideo() {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (!sourceW || !sourceH) throw new Error("Camera has not produced a frame yet.");
  const side = Math.floor(Math.min(sourceW, sourceH) * 0.72);
  const sx = Math.floor((sourceW - side) / 2);
  const sy = Math.floor((sourceH - side) / 2);
  captureCanvas.width = CAPTURE_SIZE;
  captureCanvas.height = CAPTURE_SIZE;
  const ctx = captureCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.drawImage(video, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
  return cloneCanvas(captureCanvas);
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0);
  return canvas;
}

function rotateCanvas(source, quarters) {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return cloneCanvas(source);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(q * Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function captureFace() {
  if (!stream || (captures.size >= 6 && !retakeFace)) return;
  const step = currentStep();
  captures.set(step.face, cropFromVideo());
  captureRotations.set(step.face, 0);
  autoLatch = true;
  stableSince = 0;
  previousProbe = null;
  if (retakeFace) retakeFace = null;
  else scanIndex += 1;
  renderReview();
  updateScanUI();
}

function renderReview() {
  reviewGrid.textContent = "";
  if (!captures.size) {
    const p = document.createElement("p");
    p.className = "review-empty";
    p.textContent = "No captures yet.";
    reviewGrid.appendChild(p);
    return;
  }
  for (const step of faceSequence()) {
    const canvas = captures.get(step.face);
    if (!canvas) continue;
    const card = document.createElement("article");
    card.className = "scan-card";
    const preview = document.createElement("canvas");
    preview.width = 240;
    preview.height = 240;
    const shown = rotateCanvas(canvas, captureRotations.get(step.face) || 0);
    preview.getContext("2d").drawImage(shown, 0, 0, preview.width, preview.height);
    const header = document.createElement("div");
    header.className = "scan-card__head";
    header.innerHTML = `<strong>${step.short}</strong><span>${step.face}</span>`;
    const buttons = document.createElement("div");
    buttons.className = "scan-card__buttons";
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.className = "pages-button pages-button--quiet";
    rotate.textContent = "↻ Rotate";
    rotate.addEventListener("click", () => {
      captureRotations.set(step.face, ((captureRotations.get(step.face) || 0) + 1) % 4);
      renderReview();
    });
    const retake = document.createElement("button");
    retake.type = "button";
    retake.className = "pages-button pages-button--quiet";
    retake.textContent = "Retake";
    retake.addEventListener("click", async () => {
      retakeFace = step.face;
      if (!stream) await startCamera();
      updateScanUI();
      document.querySelector("#scanner")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    buttons.append(rotate, retake);
    card.append(header, preview, buttons);
    reviewGrid.appendChild(card);
  }
}

function stabilityLoop() {
  if (!stream) return;
  const w = 32;
  const h = 32;
  probeCanvas.width = w;
  probeCanvas.height = h;
  const ctx = probeCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (sourceW && sourceH) {
    const side = Math.min(sourceW, sourceH) * 0.65;
    ctx.drawImage(video, (sourceW - side) / 2, (sourceH - side) / 2, side, side, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const probe = new Float32Array(w * h);
    let mean = 0;
    for (let i = 0; i < probe.length; i += 1) {
      const o = i * 4;
      const y = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
      probe[i] = y;
      mean += y;
    }
    mean /= probe.length;
    let variance = 0;
    for (const value of probe) variance += (value - mean) ** 2;
    variance = Math.sqrt(variance / probe.length);
    let motion = Infinity;
    if (previousProbe) {
      motion = 0;
      for (let i = 0; i < probe.length; i += 1) motion += Math.abs(probe[i] - previousProbe[i]);
      motion /= probe.length;
    }
    previousProbe = probe;
    const stable = motion < 2.2 && variance > 10;
    if (stable) {
      if (!stableSince) stableSince = performance.now();
      const elapsed = performance.now() - stableSince;
      stabilityLabel.textContent = elapsed >= 900 ? "Steady" : "Hold steady";
      if (elapsed >= 900 && autoToggle.checked && !autoLatch && (captures.size < 6 || retakeFace)) {
        autoLatch = true;
        captureFace();
      }
    } else {
      stableSince = 0;
      autoLatch = false;
      stabilityLabel.textContent = variance <= 10 ? "Place cube in guide" : "Hold steady";
    }
  }
  requestAnimationFrame(stabilityLoop);
}

function splitTiles(faceCanvas, quarters = 0) {
  const source = rotateCanvas(faceCanvas, quarters);
  const tiles = [];
  const cell = source.width / cubeSize;
  const inset = cell * 0.055;
  for (let row = 0; row < cubeSize; row += 1) {
    for (let col = 0; col < cubeSize; col += 1) {
      const tile = document.createElement("canvas");
      tile.width = TILE_SIZE;
      tile.height = TILE_SIZE;
      const ctx = tile.getContext("2d", { alpha: false, willReadFrequently: true });
      ctx.drawImage(source, col * cell + inset, row * cell + inset, cell - 2 * inset, cell - 2 * inset, 0, 0, TILE_SIZE, TILE_SIZE);
      tiles.push(tile);
    }
  }
  return tiles;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function preparePayload() {
  const allTiles = [];
  for (const face of FACE_ORDER) {
    const capture = captures.get(face);
    if (!capture) throw new Error(`Missing ${face} capture`);
    allTiles.push(...splitTiles(capture, captureRotations.get(face) || 0));
  }
  const tileCount = 6 * cubeSize * cubeSize;
  const rgb = new Uint8Array(tileCount * TILE_SIZE * TILE_SIZE * 3);
  let write = 0;
  for (const tile of allTiles) {
    const data = tile.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    for (let p = 0; p < data.length; p += 4) {
      rgb[write++] = data[p];
      rgb[write++] = data[p + 1];
      rgb[write++] = data[p + 2];
    }
  }
  return { payload: { size: cubeSize, tile_size: TILE_SIZE, rgb_b64: bytesToBase64(rgb) }, tiles: allTiles };
}

async function solveCube() {
  if (captures.size !== 6 || solving) return;
  solving = true;
  solution = null;
  resultPanel.hidden = true;
  updateSolveButton();
  workerStatus.textContent = "Solving…";
  const prepared = preparePayload();
  window.__lastTileCanvases = prepared.tiles;
  worker.postMessage({ type: "solve", payload: prepared.payload });
}

function moveInstruction(token) {
  const clean = token.replace(/[2']/g, "");
  const wide = clean.toLowerCase().includes("w");
  const faceCode = clean[0]?.toUpperCase();
  const names = { U: "top", R: "right", F: "front", D: "bottom", L: "left", B: "back" };
  const face = names[faceCode] || faceCode;
  const layer = wide ? `${face} two layers` : `${face} face`;
  if (token.endsWith("2")) return `Turn the ${layer} 180°.`;
  if (token.endsWith("'")) return `Turn the ${layer} 90° anti-clockwise.`;
  return `Turn the ${layer} 90° clockwise.`;
}

function updateMoveUI() {
  if (!solution) return;
  const moves = solution.moves || [];
  if (moveIndex >= moves.length) {
    moveText.textContent = "Solved ✓";
    moveDetail.textContent = "";
  } else {
    const token = moves[moveIndex];
    moveText.textContent = `${moveIndex + 1} / ${moves.length} · ${token}`;
    moveDetail.textContent = moveInstruction(token);
  }
  prevButton.disabled = moveIndex <= 0 || cubeView?.busy;
  nextButton.disabled = moveIndex >= moves.length || cubeView?.busy;
  resetButton.disabled = moveIndex === 0 || cubeView?.busy;
  playButton.textContent = playing ? "Pause" : "Play";
}

async function showSolution(result) {
  solution = result;
  moveIndex = 0;
  playing = false;
  resultPanel.hidden = false;
  const count = result.move_count ?? result.cubie_move_count ?? (result.moves || []).length;
  resultSummary.textContent = `${count} moves`;
  confidenceText.textContent = Number.isFinite(result.confidence) ? `Confidence ${(result.confidence * 100).toFixed(0)}%` : "";
  if (!cubeView) cubeView = new CubeView(cubeContainer);
  cubeView.build(window.__lastTileCanvases || preparePayload().tiles, cubeSize);
  updateMoveUI();
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function nextMove() {
  if (!solution || moveIndex >= solution.moves.length || cubeView.busy) return;
  await cubeView.move(solution.moves[moveIndex]);
  moveIndex += 1;
  updateMoveUI();
}

async function previousMove() {
  if (!solution || moveIndex <= 0 || cubeView.busy) return;
  await cubeView.inverseMove(solution.moves[moveIndex - 1]);
  moveIndex -= 1;
  updateMoveUI();
}

async function resetPlayback() {
  if (!solution || cubeView.busy) return;
  playing = false;
  while (moveIndex > 0) await previousMove();
  updateMoveUI();
}

async function togglePlay() {
  if (!solution) return;
  playing = !playing;
  updateMoveUI();
  while (playing && moveIndex < solution.moves.length) {
    await nextMove();
    await new Promise((resolve) => setTimeout(resolve, 140));
  }
  playing = false;
  updateMoveUI();
}

function showError(error) {
  console.error(error);
  resultPanel.hidden = false;
  resultSummary.textContent = "Could not solve scan";
  moveText.textContent = "Retake and try again";
  moveDetail.textContent = error instanceof Error ? error.message : String(error);
  confidenceText.textContent = "";
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetScanForSize() {
  cubeSize = Number(cubeSizeSelect.value);
  scanIndex = 0;
  retakeFace = null;
  captures = new Map();
  captureRotations = new Map();
  solution = null;
  moveIndex = 0;
  playing = false;
  resultPanel.hidden = true;
  renderGuide();
  renderReview();
  updateScanUI();
}

startButton.addEventListener("click", () => startCamera().catch(showError));
captureButton.addEventListener("click", captureFace);
solveButton.addEventListener("click", solveCube);
prevButton.addEventListener("click", previousMove);
nextButton.addEventListener("click", nextMove);
playButton.addEventListener("click", togglePlay);
resetButton.addEventListener("click", resetPlayback);
cubeSizeSelect.addEventListener("change", resetScanForSize);

window.addEventListener("pagehide", () => {
  for (const track of stream?.getTracks?.() || []) track.stop();
});

renderGuide();
renderReview();
updateScanUI();
