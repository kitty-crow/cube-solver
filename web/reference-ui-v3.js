import { ReferenceAssistant as BaseReferenceAssistant } from "./reference-ui.js";

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

function pendingPromise() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export class ReferenceAssistant extends BaseReferenceAssistant {
  constructor(options = {}) {
    super(options);
    this.searchResult = null;
    this.pendingSearch = null;
    this.pendingMatch = null;
    this.matchingIndex = -1;
  }

  resetWorker(reason = "Reference task replaced") {
    this.worker?.terminate?.();
    this.worker = null;
    if (this.pendingMatch) {
      this.pendingMatch.resolve({ cancelled: true, reason });
      this.pendingMatch = null;
    }
    if (this.pendingSearch) {
      this.pendingSearch.resolve({ cancelled: true, reason });
      this.pendingSearch = null;
    }
    this.pending = null;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./reference-v4-worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "reference-status") {
        this.panel.hidden = false;
        this.statusEl.textContent = msg.detail || msg.stage;
        this.onStatus(msg.detail || msg.stage, Number(msg.progress || 0));
        return;
      }
      if (msg.type === "reference-warning") {
        this.statusEl.textContent = msg.message || "Recognition warning";
        return;
      }
      if (msg.type === "reference-search-result") {
        const pending = this.pendingSearch;
        this.pendingSearch = null;
        this.pending = null;
        this.searchResult = msg;
        this.result = { ...msg, candidates: (msg.candidates || []).map(candidate => ({ ...candidate })) };
        this.selectedIndex = -1;
        this.matchingIndex = -1;
        this.lastSubject = msg.subject || "";
        this.render();
        pending?.resolve(this.result);
        return;
      }
      if (msg.type === "reference-result") {
        const pending = this.pendingMatch;
        this.pendingMatch = null;
        this.pending = null;
        const index = this.matchingIndex;
        this.matchingIndex = -1;
        const scored = msg.candidates?.[0];
        if (this.result && index >= 0 && scored) this.result.candidates[index] = scored;
        if (scored?.usable) {
          this.selectedIndex = index;
          this.lastSubject = msg.subject || this.lastSubject;
        } else {
          this.selectedIndex = -1;
        }
        this.render();
        if (scored?.usable) {
          this.persistSelected().catch((error) => console.warn("Could not persist reference", error));
          window.dispatchEvent(new CustomEvent("picture-reference-ready"));
        }
        pending?.resolve(scored);
        return;
      }
      if (msg.type === "reference-error") {
        const error = new Error(msg.message || "Reference analysis failed");
        if (this.pendingMatch) {
          const pending = this.pendingMatch;
          this.pendingMatch = null;
          this.pending = null;
          this.matchingIndex = -1;
          this.statusEl.textContent = error.message;
          this.render();
          pending.reject(error);
        } else {
          const pending = this.pendingSearch;
          this.pendingSearch = null;
          this.pending = null;
          this.showError(error);
          pending?.reject(error);
        }
      }
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Reference worker failed");
      if (this.pendingMatch) {
        const pending = this.pendingMatch;
        this.pendingMatch = null;
        this.pending = null;
        this.matchingIndex = -1;
        this.statusEl.textContent = error.message;
        this.render();
        pending.reject(error);
      } else {
        const pending = this.pendingSearch;
        this.pendingSearch = null;
        this.pending = null;
        this.showError(error);
        pending?.reject(error);
      }
    });
    return this.worker;
  }

  invalidate() {
    this.resetWorker("Scan changed");
    this.searchResult = null;
    this.matchingIndex = -1;
    super.invalidate();
  }

  async analyse(payload, subject = "") {
    const key = fingerprint(payload);
    const wanted = String(subject || "").trim();
    if (this.pendingSearch) return this.pendingSearch.promise;
    if (this.searchResult && this.lastKey === key && wanted === this.lastSubject) return this.result;

    this.resetWorker("New artwork search");
    this.lastPayload = { ...payload };
    this.lastKey = key;
    this.lastSubject = wanted;
    this.searchResult = null;
    this.result = null;
    this.selectedIndex = -1;
    this.matchingIndex = -1;
    this.panel.hidden = false;
    this.sixWrap.hidden = true;
    this.sixGrid.textContent = "";
    this.statusEl.textContent = wanted ? `Finding artwork for “${wanted}”…` : "Recognising six faces…";

    const raw = decodeBase64(payload.rgb_b64);
    const pending = pendingPromise();
    this.pendingSearch = pending;
    this.pending = pending;
    this.ensureWorker().postMessage({
      type: "search",
      rawBuffer: raw.buffer,
      tileSize: Number(payload.tile_size),
      size: Number(payload.size),
      subject: wanted,
    }, [raw.buffer]);
    return pending.promise;
  }

  async matchCandidate(index) {
    const candidate = this.result?.candidates?.[index];
    if (!candidate || !this.lastPayload) return null;
    if (candidate.usable && candidate.evidence) {
      this.selectedIndex = index;
      this.matchingIndex = -1;
      this.render();
      await this.persistSelected();
      window.dispatchEvent(new CustomEvent("picture-reference-ready"));
      return candidate;
    }

    this.resetWorker("Different reference selected");
    this.matchingIndex = index;
    this.selectedIndex = -1;
    this.render();
    const raw = decodeBase64(this.lastPayload.rgb_b64);
    const pending = pendingPromise();
    this.pendingMatch = pending;
    this.pending = pending;
    this.ensureWorker().postMessage({
      type: "match",
      rawBuffer: raw.buffer,
      tileSize: Number(this.lastPayload.tile_size),
      size: Number(this.lastPayload.size),
      subject: this.result.subject || this.lastSubject,
      faceRecognitions: this.result.faceRecognitions || [],
      guesses: this.result.guesses || [],
      model: this.result.model || null,
      candidate,
    }, [raw.buffer]);
    try {
      return await pending.promise;
    } catch (error) {
      console.warn("Selected reference match failed", error);
      return null;
    }
  }

  render() {
    const result = this.result;
    if (!result) return;
    this.panel.hidden = false;
    this.subjectEl.value = result.subject || this.lastSubject || "";

    const guesses = (result.guesses || []).slice(0, 4);
    this.guessesEl.textContent = guesses.length
      ? `Overall: ${guesses.map((guess) => `${guess.label} ${(guess.score * 100).toFixed(0)}%`).join(" · ")}`
      : "Choose a reference image below, or edit the subject and search again.";

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
    if (this.matchingIndex >= 0) {
      const matching = result.candidates?.[this.matchingIndex];
      this.statusEl.textContent = `Matching ${matching?.title?.replace(/^File:/, "") || "selected reference"}…`;
    } else if (selected?.usable && selected.evidence) {
      this.statusEl.textContent = `Using ${selected.title.replace(/^File:/, "")} · ${(selected.fit * 100).toFixed(0)}% sticker fit`;
    } else {
      this.statusEl.textContent = `${result.candidates?.length || 0} references found · choose one to match`;
    }

    this.sixGrid.textContent = "";
    const previews = selected?.facePreviews || [];
    this.sixWrap.hidden = previews.length !== 6;
    if (previews.length === 6) {
      let line = this.sixWrap.querySelector("[data-ref-alignment]");
      if (!line) {
        line = document.createElement("p");
        line.dataset.refAlignment = "";
        line.className = "reference-debug__guesses";
        this.sixWrap.insertAdjacentElement("afterbegin", line);
      }
      const anchors = selected.alignment?.anchors || [];
      if (anchors.length) {
        const mapping = anchors.map((item) => `${item.target}←${item.source} ${(Number(item.score || 0) * 100).toFixed(0)}%`).join(" · ");
        const margin = Number(selected.alignment?.margin || 0);
        line.hidden = false;
        line.textContent = `Fixed-centre alignment: ${mapping}${Number.isFinite(margin) ? ` · margin ${(margin * 100).toFixed(1)}%` : ""}`;
      } else {
        line.hidden = true;
      }
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
      if (index === this.selectedIndex || index === this.matchingIndex) card.classList.add("reference-card--selected");
      if (candidate.usable === false) card.classList.add("reference-card--unusable");
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = candidate.thumbnailUrl;
      const body = document.createElement("span");
      body.className = "reference-card__body";
      const title = document.createElement("span");
      title.className = "reference-card__title";
      title.textContent = String(candidate.title || "Reference").replace(/^File:/, "");
      const meta = document.createElement("span");
      meta.className = "reference-card__meta";
      if (index === this.matchingIndex) meta.textContent = "matching selected image…";
      else if (candidate.usable && candidate.evidence) meta.textContent = `${candidate.layout} · ${(candidate.fit * 100).toFixed(0)}%`;
      else if (candidate.usable === false) meta.textContent = candidate.reason || "not usable";
      else meta.textContent = "tap to match against cube";
      const licence = document.createElement("span");
      licence.className = "reference-card__meta";
      licence.textContent = candidate.licence || "Wikimedia Commons";
      body.append(title, meta, licence);
      card.append(image, body);
      card.addEventListener("click", () => this.matchCandidate(index));
      this.candidatesEl.appendChild(card);
    }
  }
}
