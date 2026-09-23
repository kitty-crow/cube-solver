const RUNTIME_DB = "picture-cube-solver-runtime";
const RUNTIME_DB_VERSION = 2;
const EVIDENCE_STORE = "evidence";
const REFERENCE_STORE = "reference";
const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const TILE_SIZE = 48;

function decodeBase64(encoded) {
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

function fingerprint(payload) {
  const text = `${payload.size || 3}:${payload.tile_size || 0}:${payload.rgb_b64 || ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function openRuntimeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RUNTIME_DB, RUNTIME_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) db.createObjectStore(EVIDENCE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(REFERENCE_STORE)) db.createObjectStore(REFERENCE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open reference storage"));
  });
}

async function storeCurrentReference(size, evidence) {
  if (!globalThis.indexedDB) return;
  const db = await openRuntimeDb();
  try {
    const tx = db.transaction(REFERENCE_STORE, "readwrite");
    const store = tx.objectStore(REFERENCE_STORE);
    store.clear();
    if (evidence) store.put({ key: "current", size: Number(size), evidence, savedAt: Date.now() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not store selected reference"));
      tx.onabort = () => reject(tx.error || new Error("Could not store selected reference"));
    });
  } finally {
    db.close();
  }
}

async function clearCurrentReference() {
  if (!globalThis.indexedDB) return;
  const db = await openRuntimeDb();
  try {
    const tx = db.transaction(REFERENCE_STORE, "readwrite");
    tx.objectStore(REFERENCE_STORE).clear();
  } finally {
    db.close();
  }
}

function addStyles() {
  if (document.querySelector("#reference-debug-styles")) return;
  const style = document.createElement("style");
  style.id = "reference-debug-styles";
  style.textContent = `
    .reference-debug { display:grid; gap:1rem; padding:1rem; border:1px solid var(--app-border); border-radius:var(--app-radius); }
    .reference-debug[hidden] { display:none; }
    .reference-debug__head { display:flex; gap:1rem; justify-content:space-between; align-items:baseline; }
    .reference-debug__head h2 { margin:0; font-size:clamp(1.2rem,2.5vw,1.8rem); }
    .reference-debug__status { margin:0; font-size:.78rem; opacity:.68; text-align:right; }
    .reference-debug__controls { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.6rem; }
    .reference-debug__controls input { width:100%; padding:.7rem .8rem; border:1px solid var(--app-border); border-radius:.75rem; background:var(--pages-bg,white); color:inherit; font:inherit; }
    .reference-debug__guesses { margin:0; font-size:.8rem; opacity:.7; }
    .reference-candidates { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.65rem; }
    .reference-card { display:grid; grid-template-rows:7rem auto; min-width:0; padding:0; overflow:hidden; border:1px solid var(--app-border); border-radius:.8rem; background:transparent; color:inherit; text-align:left; cursor:pointer; }
    .reference-card img { width:100%; height:7rem; object-fit:cover; background:color-mix(in srgb,currentColor 8%,transparent); }
    .reference-card__body { display:grid; gap:.18rem; padding:.55rem; }
    .reference-card__title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.76rem; font-weight:750; }
    .reference-card__meta { font-size:.67rem; opacity:.65; }
    .reference-card--selected { outline:2px solid var(--pages-accent); outline-offset:1px; }
    .reference-card--unusable { opacity:.48; cursor:default; }
    @media (max-width:620px) { .reference-debug__controls { grid-template-columns:1fr; } .reference-debug__head { display:grid; } .reference-debug__status { text-align:left; } }
  `;
  document.head.appendChild(style);
}

function makePanel() {
  addStyles();
  const panel = document.createElement("section");
  panel.id = "reference-debug";
  panel.className = "reference-debug pages-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="reference-debug__head">
      <h2>Artwork recognition</h2>
      <p class="reference-debug__status" data-reference-status>Waiting for a complete scan</p>
    </div>
    <div class="reference-debug__controls">
      <input data-reference-subject type="text" aria-label="What the cube artwork represents" placeholder="What does the cube image represent?">
      <button data-reference-search class="pages-button" type="button">Search references</button>
    </div>
    <p class="reference-debug__guesses" data-reference-guesses></p>
    <div class="reference-candidates" data-reference-candidates></div>
  `;
  const review = document.querySelector(".review-section");
  review?.insertAdjacentElement("afterend", panel);
  return panel;
}

export class ReferenceAssistant {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.panel = makePanel();
    this.statusEl = this.panel.querySelector("[data-reference-status]");
    this.subjectEl = this.panel.querySelector("[data-reference-subject]");
    this.guessesEl = this.panel.querySelector("[data-reference-guesses]");
    this.candidatesEl = this.panel.querySelector("[data-reference-candidates]");
    this.searchButton = this.panel.querySelector("[data-reference-search]");
    this.worker = null;
    this.pending = null;
    this.result = null;
    this.selectedIndex = -1;
    this.lastPayload = null;
    this.lastKey = null;
    this.lastSubject = "";

    this.searchButton.addEventListener("click", () => {
      if (!this.lastPayload) return;
      const subject = this.subjectEl.value.trim();
      this.analyse(this.lastPayload, subject).catch((error) => this.showError(error));
    });
    this.subjectEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.searchButton.click();
    });
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./reference-worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "reference-status") {
        this.panel.hidden = false;
        this.statusEl.textContent = msg.detail || msg.stage;
        this.onStatus(msg.detail || msg.stage, Number(msg.progress || 0));
        return;
      }
      if (msg.type === "reference-warning") {
        this.statusEl.textContent = msg.message || "Artwork recognition warning";
        return;
      }
      if (msg.type === "reference-result") {
        const pending = this.pending;
        this.pending = null;
        this.result = msg;
        this.selectedIndex = Number.isInteger(msg.selectedIndex) ? msg.selectedIndex : -1;
        this.lastSubject = msg.subject || "";
        this.render();
        this.persistSelected().catch((error) => console.warn("Could not persist selected reference", error));
        pending?.resolve(msg);
        return;
      }
      if (msg.type === "reference-error") {
        const pending = this.pending;
        this.pending = null;
        const error = new Error(msg.message || "Reference analysis failed");
        this.showError(error);
        pending?.reject(error);
      }
    });
    this.worker.addEventListener("error", (event) => {
      const pending = this.pending;
      this.pending = null;
      const error = new Error(event.message || "Reference worker failed");
      this.showError(error);
      pending?.reject(error);
    });
    return this.worker;
  }

  invalidate() {
    this.lastKey = null;
    this.result = null;
    this.selectedIndex = -1;
    this.lastSubject = "";
    this.candidatesEl.textContent = "";
    this.guessesEl.textContent = "";
    this.statusEl.textContent = "Scan changed · reference analysis will refresh";
    clearCurrentReference().catch(() => {});
  }

  async analyse(payload, subject = "") {
    const key = fingerprint(payload);
    const wantedSubject = String(subject || "").trim();
    if (this.pending) return this.pending.promise;
    if (this.result && this.lastKey === key && wantedSubject === this.lastSubject) return this.result;

    this.lastPayload = { ...payload };
    this.lastKey = key;
    this.panel.hidden = false;
    this.statusEl.textContent = wantedSubject ? `Searching for “${wantedSubject}”…` : "Recognising artwork…";
    this.subjectEl.value = wantedSubject || this.subjectEl.value;

    const bytes = decodeBase64(payload.rgb_b64);
    let resolvePending;
    let rejectPending;
    const promise = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
    this.pending = { promise, resolve: resolvePending, reject: rejectPending };
    this.ensureWorker().postMessage({
      type: "analyse",
      rawBuffer: bytes.buffer,
      tileSize: Number(payload.tile_size || 48),
      size: Number(payload.size || 3),
      subject: wantedSubject,
    }, [bytes.buffer]);
    return promise;
  }

  async ensure(payload) {
    this.lastPayload = { ...payload };
    const key = fingerprint(payload);
    if (!this.result || this.lastKey !== key) await this.analyse(payload, this.subjectEl.value.trim());
    await this.persistSelected();
    return this.selectedEvidence();
  }

  selectedEvidence() {
    const candidate = this.result?.candidates?.[this.selectedIndex];
    if (!candidate?.usable || !candidate.evidence) return null;
    return {
      ...candidate.evidence,
      subject: this.result.subject,
      recognition_model: this.result.model || null,
      reference: {
        title: candidate.title,
        source_url: candidate.sourceUrl,
        thumbnail_url: candidate.thumbnailUrl,
        licence: candidate.licence || "",
        artist: candidate.artist || "",
        layout: candidate.layout || "",
        fit: Number(candidate.fit || 0),
      },
    };
  }

  async persistSelected() {
    const evidence = this.selectedEvidence();
    await storeCurrentReference(Number(this.lastPayload?.size || 0), evidence);
    return evidence;
  }

  render() {
    const result = this.result;
    if (!result) return;
    this.panel.hidden = false;
    this.subjectEl.value = result.subject || "";
    const guesses = (result.guesses || []).filter((guess) => guess.label).slice(0, 3);
    this.guessesEl.textContent = guesses.length
      ? `Model guesses: ${guesses.map((guess) => `${guess.label} ${(guess.score * 100).toFixed(0)}%`).join(" · ")}`
      : "No automatic subject guess available. Edit the subject and search again.";
    const selected = result.candidates?.[this.selectedIndex];
    this.statusEl.textContent = selected?.usable
      ? `Using ${selected.title.replace(/^File:/, "")} · fit ${(selected.fit * 100).toFixed(0)}%`
      : "No usable cube-net reference found · using visual continuity only";

    this.candidatesEl.textContent = "";
    for (const [index, candidate] of (result.candidates || []).entries()) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "reference-card";
      if (index === this.selectedIndex) card.classList.add("reference-card--selected");
      if (!candidate.usable) card.classList.add("reference-card--unusable");
      card.disabled = !candidate.usable;

      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = candidate.thumbnailUrl;
      const body = document.createElement("span");
      body.className = "reference-card__body";
      const title = document.createElement("span");
      title.className = "reference-card__title";
      title.textContent = candidate.title.replace(/^File:/, "");
      const meta = document.createElement("span");
      meta.className = "reference-card__meta";
      const fit = candidate.usable ? `${(candidate.fit * 100).toFixed(0)}% fit` : candidate.reason || "not a cube net";
      meta.textContent = candidate.usable ? `${candidate.layout || "cube net"} · ${fit}` : fit;
      const licence = document.createElement("span");
      licence.className = "reference-card__meta";
      licence.textContent = candidate.licence || "Wikimedia Commons";
      body.append(title, meta, licence);
      card.append(image, body);

      if (candidate.usable) {
        card.addEventListener("click", () => {
          this.selectedIndex = index;
          this.render();
          this.persistSelected().catch((error) => console.warn("Could not persist selected reference", error));
        });
      }
      this.candidatesEl.appendChild(card);
    }
  }

  showError(error) {
    this.panel.hidden = false;
    this.statusEl.textContent = error instanceof Error ? error.message : String(error);
    clearCurrentReference().catch(() => {});
    this.onStatus("Reference analysis unavailable · continuing without it", 1);
  }
}

function payloadFromReview() {
  const size = Number(document.querySelector("#cube-size")?.value || 3);
  const byFace = new Map();
  for (const card of document.querySelectorAll("#review-grid .scan-card")) {
    const face = card.querySelector(".scan-card__head span")?.textContent?.trim();
    const canvas = card.querySelector("canvas");
    if (FACE_ORDER.includes(face) && canvas) byFace.set(face, canvas);
  }
  if (byFace.size !== 6) return null;

  const tileCount = 6 * size * size;
  const rgb = new Uint8Array(tileCount * TILE_SIZE * TILE_SIZE * 3);
  let write = 0;
  const scratch = document.createElement("canvas");
  scratch.width = TILE_SIZE;
  scratch.height = TILE_SIZE;
  const ctx = scratch.getContext("2d", { alpha: false, willReadFrequently: true });
  for (const face of FACE_ORDER) {
    const source = byFace.get(face);
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
  return { size, tile_size: TILE_SIZE, rgb_b64: bytesToBase64(rgb) };
}

function releaseCameraForRecognition() {
  const video = document.querySelector("#camera");
  const stream = video?.srcObject;
  for (const track of stream?.getTracks?.() || []) track.stop();
  if (video) video.srcObject = null;
  document.querySelector(".camera-stage")?.classList.remove("camera-stage--live");
}

function bootstrap() {
  const solveButton = document.querySelector("#solve-cube");
  const reviewGrid = document.querySelector("#review-grid");
  if (!solveButton || !reviewGrid) return;

  const assistant = new ReferenceAssistant();
  window.pictureReference = assistant;
  let replaying = false;
  let mutationTimer = null;

  const syncScan = () => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      const payload = payloadFromReview();
      if (!payload) {
        assistant.invalidate();
        assistant.panel.hidden = true;
        return;
      }
      assistant.panel.hidden = false;
      assistant.lastPayload = payload;
      assistant.statusEl.textContent = assistant.result ? assistant.statusEl.textContent : "Ready to identify artwork";
    }, 100);
  };
  new MutationObserver(() => {
    assistant.invalidate();
    syncScan();
  }).observe(reviewGrid, { childList: true, subtree: true });
  syncScan();

  solveButton.addEventListener("click", async (event) => {
    if (replaying) {
      replaying = false;
      return;
    }
    const payload = payloadFromReview();
    if (!payload) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const oldText = solveButton.textContent;
    solveButton.disabled = true;
    solveButton.textContent = "Identifying artwork…";
    releaseCameraForRecognition();
    try {
      await assistant.ensure(payload);
    } catch (error) {
      console.warn("Reference-assisted reconstruction unavailable", error);
      await clearCurrentReference().catch(() => {});
    } finally {
      solveButton.disabled = false;
      solveButton.textContent = oldText;
      replaying = true;
      solveButton.click();
    }
  }, true);
}

bootstrap();
