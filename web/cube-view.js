import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const NORMAL = {
  U: new THREE.Vector3(0, 1, 0), R: new THREE.Vector3(1, 0, 0), F: new THREE.Vector3(0, 0, 1),
  D: new THREE.Vector3(0, -1, 0), L: new THREE.Vector3(-1, 0, 0), B: new THREE.Vector3(0, 0, -1),
};
const RIGHT = {
  U: new THREE.Vector3(1, 0, 0), R: new THREE.Vector3(0, 0, -1), F: new THREE.Vector3(1, 0, 0),
  D: new THREE.Vector3(1, 0, 0), L: new THREE.Vector3(0, 0, 1), B: new THREE.Vector3(-1, 0, 0),
};
const UP = {
  U: new THREE.Vector3(0, 0, -1), R: new THREE.Vector3(0, 1, 0), F: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, 0, 1), L: new THREE.Vector3(0, 1, 0), B: new THREE.Vector3(0, 1, 0),
};

function parseMove(token) {
  const match = String(token).trim().match(/^(\d+)?([URFDLB])([wW]?)(2|'?)$/);
  if (!match) throw new Error(`Unsupported move: ${token}`);
  const [, prefix, face, wide, suffix] = match;
  const layers = wide ? Number(prefix || 2) : 1;
  const turns = suffix === "2" ? 2 : suffix === "'" ? -1 : 1;
  return { face, layers, turns };
}

function roundedStickerGeometry(size = 0.86, radius = 0.105) {
  const half = size / 2;
  const r = Math.min(radius, half * 0.48);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  const position = geometry.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / size + 0.5;
    uv[i * 2 + 1] = position.getY(i) / size + 0.5;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function coordKey(x, y, z) { return `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`; }
function snapCoord(value, size) {
  const centre = (size - 1) / 2;
  return Math.round(value + centre) - centre;
}

export class CubeView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.cubelets = [];
    this.busy = false;
    this.size = 3;
    this.rounded = false;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this._clearImageListener = () => this.clear();
    window.addEventListener("picture-image-memory-cleared", this._clearImageListener);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x718078, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 7, 8);
    this.scene.add(key);
    this.resize();
    this.animateLoop();
  }

  dispose() {
    this._resizeObserver.disconnect();
    window.removeEventListener("picture-image-memory-cleared", this._clearImageListener);
    this.clear();
    this.controls.dispose?.();
    this.renderer.dispose();
    this.container.textContent = "";
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animateLoop() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animateLoop());
  }

  clear() {
    while (this.root.children.length) {
      const child = this.root.children.pop();
      child?.traverse((obj) => {
        obj.geometry?.dispose?.();
        const materials = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        for (const material of materials) {
          material.map?.dispose?.();
          material.dispose?.();
        }
      });
    }
    this.cubelets = [];
  }

  build(tileCanvases, size = 3, { rounded = false } = {}) {
    this.clear();
    this.size = size;
    this.rounded = Boolean(rounded);
    const centre = (size - 1) / 2;
    const distance = Math.max(5.2, size * 2.35);
    this.camera.position.set(distance * 0.82, distance * 0.68, distance);
    this.controls.minDistance = size * 1.45;
    this.controls.maxDistance = size * 4.2;

    const boxGeometry = this.rounded
      ? new RoundedBoxGeometry(0.94, 0.94, 0.94, 4, 0.085)
      : new THREE.BoxGeometry(0.94, 0.94, 0.94);
    const stickerGeometry = this.rounded
      ? roundedStickerGeometry(0.86, 0.105)
      : new THREE.PlaneGeometry(0.86, 0.86);
    const black = new THREE.MeshStandardMaterial({ color: 0x101312, roughness: 0.68, metalness: 0.05 });
    const cubeletByKey = new Map();

    for (let xi = 0; xi < size; xi += 1) {
      for (let yi = 0; yi < size; yi += 1) {
        for (let zi = 0; zi < size; zi += 1) {
          const x = xi - centre;
          const y = yi - centre;
          const z = zi - centre;
          const group = new THREE.Group();
          group.position.set(x, y, z);
          const mesh = new THREE.Mesh(boxGeometry.clone(), black.clone());
          group.add(mesh);
          this.root.add(group);
          this.cubelets.push(group);
          cubeletByKey.set(coordKey(x, y, z), group);
        }
      }
    }

    boxGeometry.dispose();
    black.dispose();

    for (let f = 0; f < 6; f += 1) {
      const face = FACE_NAMES[f];
      const normal = NORMAL[face];
      const right = RIGHT[face];
      const up = UP[face];
      for (let local = 0; local < size * size; local += 1) {
        const row = Math.floor(local / size);
        const col = local % size;
        const pos = normal.clone().multiplyScalar(centre)
          .add(right.clone().multiplyScalar(col - centre))
          .add(up.clone().multiplyScalar(centre - row));
        const cubelet = cubeletByKey.get(coordKey(pos.x, pos.y, pos.z));
        if (!cubelet) continue;
        const canvas = tileCanvases[f * size * size + local];
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const sticker = new THREE.Mesh(
          stickerGeometry.clone(),
          new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
        );
        sticker.position.copy(normal.clone().multiplyScalar(this.rounded ? 0.486 : 0.481));
        const basis = new THREE.Matrix4();
        basis.makeBasis(right, up, normal);
        sticker.quaternion.setFromRotationMatrix(basis);
        cubelet.add(sticker);
      }
    }
    stickerGeometry.dispose();
  }

  async move(token, duration = 430) {
    if (this.busy || !token) return;
    this.busy = true;
    try {
      const { face, layers, turns } = parseMove(token);
      if (layers > this.size) throw new Error(`Move ${token} exceeds ${this.size}×${this.size}`);
      const axis = NORMAL[face];
      const centre = (this.size - 1) / 2;
      const cutoff = centre - layers + 0.5;
      const pivot = new THREE.Group();
      this.root.add(pivot);
      const selected = this.cubelets.filter((cubelet) => cubelet.position.dot(axis) > cutoff);
      for (const cubelet of selected) pivot.attach(cubelet);

      const angle = -turns * Math.PI / 2;
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          pivot.setRotationFromAxisAngle(axis, angle * easeInOut(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });

      pivot.setRotationFromAxisAngle(axis, angle);
      pivot.updateMatrixWorld(true);
      for (const cubelet of selected) {
        this.root.attach(cubelet);
        cubelet.position.set(
          snapCoord(cubelet.position.x, this.size),
          snapCoord(cubelet.position.y, this.size),
          snapCoord(cubelet.position.z, this.size),
        );
        const e = new THREE.Euler().setFromQuaternion(cubelet.quaternion, "XYZ");
        const q = Math.PI / 2;
        e.set(Math.round(e.x / q) * q, Math.round(e.y / q) * q, Math.round(e.z / q) * q);
        cubelet.quaternion.setFromEuler(e);
      }
      this.root.remove(pivot);
    } finally {
      this.busy = false;
    }
  }

  async inverseMove(token, duration = 360) {
    const inv = token.endsWith("2") ? token : token.endsWith("'") ? token.slice(0, -1) : `${token}'`;
    await this.move(inv, duration);
  }
}
