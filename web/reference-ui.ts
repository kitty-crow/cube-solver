const RUNTIME_DB = "picture-cube-solver-runtime";
const RUNTIME_DB_VERSION = 2;
const EVIDENCE_STORE = "evidence";
const REFERENCE_STORE = "reference";

function decodeBase64(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB unavailable"));
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

async function storeReference(size, evidence) {
  let db;
  try {
    db = await openDb();
    const tx = db.transaction(REFERENCE_STORE, "readwrite");
    const store = tx.objectStore(REFERENCE_STORE);
    store.clear();
    if (evidence) store.put({ key: "current", size: Number(size), evidence, savedAt: Date.now() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not store reference"));
      tx.onabort = () => reject(tx.error || new Error("Could not store reference"));
    });
  } finally {
    db?.close?.();
  }
}

async function clearReference() {
  let db;
  try {
    db = await openDb();
    const tx = db.transaction(REFERENCE_STORE, "readwrite");
    tx.objectStore(REFERENCE_STORE).clear();
  } catch (_) {
  } finally {
    db?.close?.();
  }
}

function installStyles() {
  if (document.querySelector("#reference-debug-styles")) return;
  const style = document.createElement("style");
  style.id = "reference-debug-styles";
  style.textContent = `
    .reference-debug { display:grid; gap:.9rem; padding:1rem; border:1px solid var(--app-border); border-radius:var(--app-radius); }
    .reference-debug[hidden] { display:none; }
    .reference-debug__head { display:flex; justify-content:space-between; gap:1rem; align-items:baseline; }
    .reference-debug__head h2 { margin:0; font-size:1.25rem; }
    .reference-debug__status { margin:0; opacity:.68; font-size:.76rem; text-align:right; }
    .reference-debug__controls { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.55rem; }
    .reference-debug__controls input { width:100%; box-sizing:border-box; padding:.68rem .8rem; border:1px solid var(--app-border); border-radius:.7rem; background:var(--pages-bg,white); color:inherit; font:inherit; }
    .reference-debug__guesses { margin:0; opacity:.72; font-size:.76rem; }
    .reference-face-guesses { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.4rem; }
    .reference-face-guess { min-width:0; padding:.45rem; border:1px solid var(--app-border); border-radius:.65rem; font-size:.66rem; }
    .reference-face-guess strong { display:block; margin-bottom:.18rem; font-size:.72rem; }
    .reference-candidates { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.55rem; }
    .reference-card { display:grid; grid-template-rows:6.5rem auto; min-width:0; padding:0; overflow:hidden; border:1px solid var(--app-border); border-radius:.75rem; background:transparent; color:inherit; text-align:left; cursor:pointer; }
    .reference-card img { width:100%; height:6.5rem; object-fit:cover; }
    .reference-card__body { display:grid; gap:.15rem; padding:.5rem; }
    .reference-card__title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.72rem; font-weight:750; }
    .reference-card__meta { font-size:.64rem; opacity:.65; }
    .reference-card--selected { outline:2px solid var(--pages-accent); outline-offset:1px; }
    .reference-card--unusable { opacity:.45; cursor:default; }
    .reference-six { display:grid; gap:.4rem; }
    .reference-six__title { margin:0; font-size:.75rem; font-weight:700; }
    .reference-six__grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.35rem; }
    .reference-six__face { display:grid; gap:.2rem; margin:0; min-width:0; }
    .reference-six__face img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:.45rem; border:1px solid var(--app-border); }
    .reference-six__face figcaption { text-align:center; font-size:.62rem; opacity:.7; }
    @media (max-width:700px) { .reference-face-guesses,.reference-six__grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
    @media (max-width:520px) { .reference-debug__controls { grid-template-columns:1fr; } .reference-debug__head { display:grid; } .reference-debug__status { text-align:left; } }
  `;
  document.head.appendChild(style);
}

function makePanel() {
  installStyles();
  const panel = document.createElement("section");
  panel.className = "reference-debug pages-panel";
  panel.id = "reference-debug";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="reference-debug__head">
      <h2>Artwork recognition</h2>
      <p class="reference-debug__status" data-ref-status>Waiting for six faces</p>
    </div>
    <div class="reference-debug__controls">
      <input data-ref-subject type="text" aria-label="What the cube artwork represents" placeholder="What does the cube image represent?">
      <button data-ref-search class="pages-button" type="button">Search references again</button>
    </div>
    <p class="reference-debug__guesses" data-ref-guesses></p>
    <div class="reference-face-guesses" data-ref-face-guesses></div>
    <div class="reference-six" data-ref-six hidden>
      <p class="reference-six__title">Six faces derived from selected reference</p>
      <div class="reference-six__grid" data-ref-six-grid></div>
    </div>
    <div class="reference-candidates" data-ref-candidates></div>
  `;
  document.querySelector(".review-section")?.insertAdjacentElement("afterend", panel);
  return panel;
}

export class ReferenceAssistant {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.panel = makePanel();
    this.statusEl = this.panel.querySelector("[data-ref-status]");
    this.subjectEl = this.panel.querySelector("[data-ref-subject]");
    this.guessesEl = this.panel.querySelector("[data-ref-guesses]");
    this.faceGuessesEl = this.panel.querySelector("[data-ref-face-guesses]");
    this.sixWrap = this.panel.querySelector("[data-ref-six]");
    this.sixGrid = this.panel.querySelector("[data-ref-six-grid]");
    this.candidatesEl = this.panel.querySelector("[data-ref-candidates]");
    this.searchButton = this.panel.querySelector("[data-ref-search]");
    this.worker = null;
    this.pending = null;
    this.result = null;
    this.selectedIndex = -1;
    this.lastPayload = null;
    this.lastKey = null;
    this.lastSubject = "";

    this.searchButton.addEventListener("click", () => {
      if (!this.lastPayload) return;
      this.analyse(this.lastPayload, this.subjectEl.value.trim()).catch((error) => this.showError(error));
    });
    this.subjectEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.searchButton.click();
    });
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./reference-v2-worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "reference-status") {
        this.panel.hidden = false;
        this.statusEl.textContent = msg.detail || msg.stage;
        this.onStatus(msg.detail || msg.stage, Number(msg.progress || 0));
      } else if (msg.type === "reference-warning") {
        this.statusEl.textContent = msg.message || "Recognition warning";
      } else if (msg.type === "reference-result") {
        const pending = this.pending;
        this.pending = null;
        this.result = msg;
        this.selectedIndex = Number.isInteger(msg.selectedIndex) ? msg.selectedIndex : -1;
        this.lastSubject = msg.subject || "";
        this.render();
        this.persistSelected().catch((error) => console.warn("Could not persist reference", error));
        pending?.resolve(msg);
      } else if (msg.type === "reference-error") {
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
    this.faceGuessesEl.textContent = "";
    this.candidatesEl.textContent = "";
    this.sixGrid.textContent = "";
    this.sixWrap.hidden = true;
    this.statusEl.textContent = "Scan changed · recognition will refresh";
    clearReference();
  }

  async analyse(payload, subject = "") {
    const key = fingerprint(payload);
    const wanted = String(subject || "").trim();
    if (this.pending) return this.pending.promise;
    if (this.result && this.lastKey === key && wanted === this.lastSubject) return this.result;
    this.lastPayload = { ...payload };
    this.lastKey = key;
    this.panel.hidden = false;
    this.statusEl.textContent = wanted ? `Searching for “${wanted}”…` : "Recognising six faces…";
    const raw = decodeBase64(payload.rgb_b64);
    let resolvePending;
    let rejectPending;
    const promise = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
    this.pending = { promise, resolve: resolvePending, reject: rejectPending };
    this.ensureWorker().postMessage({ type: "analyse", rawBuffer: raw.buffer, tileSize: Number(payload.tile_size), size: Number(payload.size), subject: wanted }, [raw.buffer]);
    return promise;
  }

  async prime(payload) {
    this.lastPayload = { ...payload };
    const key = fingerprint(payload);
    if (this.result && this.lastKey === key) return this.result;
    return this.analyse(payload, this.subjectEl.value.trim());
  }

  async ensure(payload) {
    await this.prime(payload);
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
      face_recognitions: this.result.faceRecognitions || [],
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
    await storeReference(Number(this.lastPayload?.size || 0), this.selectedEvidence());
  }

  render() {
    const result = this.result;
    if (!result) return;
    this.panel.hidden = false;
    this.subjectEl.value = result.subject || "";
    const guesses = (result.guesses || []).slice(0, 4);
    this.guessesEl.textContent = guesses.length
      ? `Overall: ${guesses.map((guess) => `${guess.label} ${(guess.score * 100).toFixed(0)}%`).join(" · ")}`
      : "Edit the subject if the automatic interpretation is wrong.";

    this.faceGuessesEl.textContent = "";
    for (const item of result.faceRecognitions || []) {
      const card = document.createElement("div");
      card.className = "reference-face-guess";
      const top = item.guesses?.[0];
      const second = item.guesses?.[1];
      const strong = document.createElement("strong");
      strong.textContent = `Scan ${item.face}`;
      card.appendChild(strong);
      card.append(document.createTextNode(top ? `${top.label} ${(top.score * 100).toFixed(0)}%${second ? ` · ${second.label} ${(second.score * 100).toFixed(0)}%` : ""}` : "No guess"));
      this.faceGuessesEl.appendChild(card);
    }

    const selected = result.candidates?.[this.selectedIndex];
    this.statusEl.textContent = selected?.usable
      ? `Using ${selected.title.replace(/^File:/, "")} · ${(selected.fit * 100).toFixed(0)}% sticker fit`
      : "No usable six-face reference found · continuity-only fallback";

    this.sixGrid.textContent = "";
    const previews = selected?.facePreviews || [];
    this.sixWrap.hidden = previews.length !== 6;
    if (previews.length === 6) {
      for (let i = 0; i < 6; i += 1) {
        const figure = document.createElement("figure");
        figure.className = "reference-six__face";
        const img = document.createElement("img");
        img.src = previews[i];
        img.alt = `Derived reference face ${["U","R","F","D","L","B"][i]}`;
        const caption = document.createElement("figcaption");
        caption.textContent = ["U","R","F","D","L","B"][i];
        figure.append(img, caption);
        this.sixGrid.appendChild(figure);
      }
    }

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
      meta.textContent = candidate.usable ? `${candidate.layout} · ${(candidate.fit * 100).toFixed(0)}%` : candidate.reason || "not usable";
      const licence = document.createElement("span");
      licence.className = "reference-card__meta";
      licence.textContent = candidate.licence || "Wikimedia Commons";
      body.append(title, meta, licence);
      card.append(image, body);
      if (candidate.usable) card.addEventListener("click", () => {
        this.selectedIndex = index;
        this.render();
        this.persistSelected().catch((error) => console.warn("Could not persist reference", error));
      });
      this.candidatesEl.appendChild(card);
    }
  }

  showError(error) {
    this.panel.hidden = false;
    this.statusEl.textContent = error instanceof Error ? error.message : String(error);
    clearReference();
    this.onStatus("Reference analysis unavailable · continuing without it", 1);
  }
}
