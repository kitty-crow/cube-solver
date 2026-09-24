import { ReferenceAlignmentModal as BaseReferenceAlignmentModal } from "./reference-aligner.js";

const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value) {
  const period = Math.PI * 2;
  return ((value % period) + period) % period;
}

function emptyWarp() {
  return { points: Array.from({ length: 9 }, () => [0, 0]) };
}

function cloneOrientation(value) {
  return {
    yaw: Number(value?.yaw || 0),
    pitch: Number(value?.pitch || 0),
    roll: Number(value?.roll || 0),
  };
}

function normaliseAngleDelta(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function fmtDeg(value) {
  const degrees = Number(value || 0) * 180 / Math.PI;
  return `${degrees >= 0 ? "+" : ""}${degrees.toFixed(2)}°`;
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export class ReferenceAlignmentModal extends BaseReferenceAlignmentModal {
  constructor(options = {}) {
    super(options);
    this.activePointers = new Map();
    this.gesture = null;
    this.viewZoom = 1;
    this.adjustReady = false;
    this.previewInFlight = false;
    this.previewDirty = false;

    this.onWheelBound = (event) => this.onWheel(event);
    this.onKeyDownBound = (event) => this.onKeyDown(event);
    this.canvas.addEventListener("wheel", this.onWheelBound, { passive: false });
    window.addEventListener("keydown", this.onKeyDownBound);
  }

  makeRoot() {
    const root = super.makeRoot();
    const heading = root.querySelector("h2");
    if (heading) heading.textContent = "Adjust wrapped artwork";
    const globalMode = root.querySelector('[data-align-mode="global"]');
    if (globalMode) globalMode.textContent = "Move / rotate artwork";
    return root;
  }

  async open(options) {
    this.activePointers.clear();
    this.gesture = null;
    this.viewZoom = 1;
    this.adjustReady = false;
    this.previewInFlight = false;
    this.previewDirty = false;
    await super.open(options);
    this.updateReadout();
  }

  close() {
    this.activePointers.clear();
    this.gesture = null;
    this.adjustReady = false;
    this.previewInFlight = false;
    this.previewDirty = false;
    super.close();
  }

  async workerMessage(msg) {
    if (msg.type === "reference-adjust-ready") this.adjustReady = true;
    if (msg.type === "reference-adjust-preview") this.previewInFlight = false;
    await super.workerMessage(msg);
    if (msg.type === "reference-adjust-preview" && this.previewDirty) this.schedulePreview(0);
  }

  setMode(mode) {
    super.setMode(mode);
    this.hintEl.textContent = this.mode === "global"
      ? "Drag the artwork freely over the fixed scan. Pinch or Alt+wheel zooms the view. Two-finger twist, Shift+wheel, Q/E rolls. Ctrl+wheel or A/D moves horizontally; W/S or ↑/↓ moves vertically."
      : "Drag a mesh handle for local correction. Pinch or Alt+wheel zooms the view for precision. The mapping remains continuous and is never snapped to angle steps.";
  }

  schedulePreview(delay = 24) {
    this.previewDirty = true;
    if (!this.worker || !this.adjustReady || this.previewInFlight || this.previewTimer) return;
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      if (!this.worker || !this.adjustReady) return;
      const requestId = ++this.requestId;
      this.previewDirty = false;
      this.previewInFlight = true;
      this.statusEl.textContent = "Updating overlay…";
      this.worker.postMessage({
        type: "adjust-preview",
        sessionId: this.sessionId,
        requestId,
        adjustment: { orientation: this.orientation, faceWarps: this.faceWarps },
      });
    }, Math.max(0, Math.min(Number(delay) || 0, 32)));
  }

  rawPointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.canvas.width / rect.width,
      y: (event.clientY - rect.top) * this.canvas.height / rect.height,
    };
  }

  logicalPoint(raw) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      x: (raw.x - w / 2) / this.viewZoom + w / 2,
      y: (raw.y - h / 2) / this.viewZoom + h / 2,
    };
  }

  screenPoint(logical) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      x: (logical.x - w / 2) * this.viewZoom + w / 2,
      y: (logical.y - h / 2) * this.viewZoom + h / 2,
    };
  }

  beginSingleDrag(pointerId, raw) {
    if (this.mode === "global") {
      this.drag = {
        kind: "global",
        pointerId,
        start: raw,
        orientation: cloneOrientation(this.orientation),
      };
      return;
    }

    const face = FACE_NAMES[this.faceIndex];
    const warp = this.faceWarps[face] || emptyWarp();
    const w = this.canvas.width;
    const h = this.canvas.height;
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < 9; i += 1) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const point = warp.points[i];
      const logical = { x: (col / 2 + point[0]) * w, y: (row / 2 + point[1]) * h };
      const handle = this.screenPoint(logical);
      const distance = Math.hypot(raw.x - handle.x, raw.y - handle.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    this.drag = {
      kind: nearestDistance < 50 ? "handle" : "face",
      pointerId,
      start: raw,
      handle: nearest,
      points: warp.points.map((point) => [point[0], point[1]]),
    };
  }

  beginGesture() {
    const entries = [...this.activePointers.entries()].slice(0, 2);
    if (entries.length < 2) return;
    const [[idA, a], [idB, b]] = entries;
    this.drag = null;
    this.gesture = {
      ids: [idA, idB],
      startA: { ...a },
      startB: { ...b },
      startCentroid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startAngle: Math.atan2(b.y - a.y, b.x - a.x),
      orientation: cloneOrientation(this.orientation),
      zoom: this.viewZoom,
    };
  }

  pointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const raw = this.rawPointerPosition(event);
    this.activePointers.set(event.pointerId, raw);
    this.canvas.setPointerCapture?.(event.pointerId);
    if (this.activePointers.size >= 2) {
      this.beginGesture();
      return;
    }
    this.beginSingleDrag(event.pointerId, raw);
  }

  pointerMove(event) {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const raw = this.rawPointerPosition(event);
    this.activePointers.set(event.pointerId, raw);

    if (this.activePointers.size >= 2 && this.gesture) {
      const a = this.activePointers.get(this.gesture.ids[0]);
      const b = this.activePointers.get(this.gesture.ids[1]);
      if (!a || !b) return;
      const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const sensitivity = 0.045 * DEG / Math.max(0.5, this.viewZoom);
      const dx = centroid.x - this.gesture.startCentroid.x;
      const dy = centroid.y - this.gesture.startCentroid.y;
      this.orientation.yaw = wrap(this.gesture.orientation.yaw + dx * sensitivity);
      this.orientation.pitch = clamp(this.gesture.orientation.pitch - dy * sensitivity, -Math.PI / 2, Math.PI / 2);
      this.orientation.roll = wrap(this.gesture.orientation.roll + normaliseAngleDelta(angle - this.gesture.startAngle));
      this.viewZoom = clamp(this.gesture.zoom * distance / this.gesture.startDistance, 0.5, 8);
      this.changed();
      return;
    }

    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const dx = raw.x - this.drag.start.x;
    const dy = raw.y - this.drag.start.y;
    if (this.drag.kind === "global") {
      const sensitivity = 0.045 * DEG / Math.max(0.5, this.viewZoom);
      this.orientation.yaw = wrap(this.drag.orientation.yaw + dx * sensitivity);
      this.orientation.pitch = clamp(this.drag.orientation.pitch - dy * sensitivity, -Math.PI / 2, Math.PI / 2);
      this.changed();
      return;
    }

    const face = FACE_NAMES[this.faceIndex];
    const warp = this.faceWarps[face] || emptyWarp();
    const nx = dx / (this.canvas.width * this.viewZoom);
    const ny = dy / (this.canvas.height * this.viewZoom);
    if (this.drag.kind === "handle") {
      const index = this.drag.handle;
      const base = this.drag.points[index];
      warp.points[index] = [clamp(base[0] + nx, -0.42, 0.42), clamp(base[1] + ny, -0.42, 0.42)];
    } else {
      warp.points = this.drag.points.map((point) => [
        clamp(point[0] + nx, -0.42, 0.42),
        clamp(point[1] + ny, -0.42, 0.42),
      ]);
    }
    this.faceWarps[face] = warp;
    this.changed();
  }

  pointerUp(event) {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size >= 2) {
      this.beginGesture();
      return;
    }
    this.gesture = null;
    this.drag = null;
    if (this.activePointers.size === 1) {
      const [pointerId, raw] = this.activePointers.entries().next().value;
      this.beginSingleDrag(pointerId, raw);
    } else {
      this.schedulePreview(0);
    }
  }

  zoomView(factor) {
    this.viewZoom = clamp(this.viewZoom * factor, 0.5, 8);
    this.draw();
  }

  onWheel(event) {
    if (this.root.hidden || !this.canvas.contains(event.target)) return;
    event.preventDefault();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 240 : 1;
    const dx = clamp(event.deltaX * scale, -240, 240);
    const dy = clamp(event.deltaY * scale, -240, 240);

    if (event.altKey) {
      this.zoomView(Math.exp(-dy * 0.0015));
      return;
    }

    const sensitivity = 0.010 * DEG / Math.max(0.5, this.viewZoom);
    if (event.shiftKey) {
      this.orientation.roll = wrap(this.orientation.roll + dy * sensitivity);
    } else if (event.ctrlKey || event.metaKey) {
      this.orientation.yaw = wrap(this.orientation.yaw + dy * sensitivity);
    } else {
      this.orientation.yaw = wrap(this.orientation.yaw + dx * sensitivity);
      this.orientation.pitch = clamp(this.orientation.pitch + dy * sensitivity, -Math.PI / 2, Math.PI / 2);
    }
    this.changed();
  }

  onKeyDown(event) {
    if (this.root.hidden || isEditableTarget(event.target)) return;
    const key = String(event.key || "").toLowerCase();
    const fine = event.shiftKey ? 0.05 : 0.25;
    const step = fine * DEG / Math.max(0.5, this.viewZoom);
    let handled = true;

    if (key === "arrowleft" || key === "a") this.orientation.yaw = wrap(this.orientation.yaw - step);
    else if (key === "arrowright" || key === "d") this.orientation.yaw = wrap(this.orientation.yaw + step);
    else if (key === "arrowup" || key === "w") this.orientation.pitch = clamp(this.orientation.pitch + step, -Math.PI / 2, Math.PI / 2);
    else if (key === "arrowdown" || key === "s") this.orientation.pitch = clamp(this.orientation.pitch - step, -Math.PI / 2, Math.PI / 2);
    else if (key === "q") this.orientation.roll = wrap(this.orientation.roll - step);
    else if (key === "e") this.orientation.roll = wrap(this.orientation.roll + step);
    else if (key === "+" || key === "=") {
      this.zoomView(1.12);
      event.preventDefault();
      return;
    } else if (key === "-" || key === "_") {
      this.zoomView(1 / 1.12);
      event.preventDefault();
      return;
    } else if (key === "0") {
      this.viewZoom = 1;
      this.draw();
      event.preventDefault();
      return;
    } else if (key === "escape") {
      this.close();
      event.preventDefault();
      return;
    } else handled = false;

    if (!handled) return;
    event.preventDefault();
    this.changed();
  }

  drawFace() {
    const ctx = this.canvas.getContext("2d");
    const w = this.canvas.width;
    const h = this.canvas.height;
    const face = FACE_NAMES[this.faceIndex];
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.viewZoom, this.viewZoom);
    ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(this.scanFaces[this.faceIndex], 0, 0, w, h);
    if (this.previewImages[this.faceIndex]) {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.drawImage(this.previewImages[this.faceIndex], 0, 0, w, h);
      ctx.restore();
    }
    const size = Number(this.payload?.size || 3);
    ctx.save();
    ctx.lineWidth = 2 / this.viewZoom;
    ctx.strokeStyle = "rgba(255,255,255,.34)";
    for (let i = 1; i < size; i += 1) {
      const q = i * w / size;
      ctx.beginPath(); ctx.moveTo(q, 0); ctx.lineTo(q, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(w, q); ctx.stroke();
    }
    ctx.restore();
    if (this.mode === "face") {
      const warp = this.faceWarps[face] || emptyWarp();
      const points = warp.points.map((point, index) => ({
        x: ((index % 3) / 2 + point[0]) * w,
        y: (Math.floor(index / 3) / 2 + point[1]) * h,
      }));
      ctx.save();
      ctx.lineWidth = 3 / this.viewZoom;
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.fillStyle = "rgba(20,20,28,.85)";
      for (let row = 0; row < 3; row += 1) for (let col = 0; col < 2; col += 1) {
        const a = points[row * 3 + col];
        const b = points[row * 3 + col + 1];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let col = 0; col < 3; col += 1) for (let row = 0; row < 2; row += 1) {
        const a = points[row * 3 + col];
        const b = points[(row + 1) * 3 + col];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 10 / this.viewZoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.font = "700 28px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.fillText(face, 17, 17);
    ctx.fillStyle = "white";
    ctx.fillText(face, 14, 14);
    ctx.restore();
  }

  updateReadout() {
    const face = FACE_NAMES[this.faceIndex];
    const warp = this.faceWarps[face] || emptyWarp();
    const maxWarp = Math.max(...warp.points.map((point) => Math.hypot(point[0], point[1])));
    this.readoutEl.textContent = `${face} · yaw ${fmtDeg(this.orientation.yaw)} · pitch ${fmtDeg(this.orientation.pitch)} · roll ${fmtDeg(this.orientation.roll)} · view ${this.viewZoom.toFixed(2)}× · local warp ${(maxWarp * 100).toFixed(1)}%`;
  }
}
