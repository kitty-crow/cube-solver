import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";

const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const NORMAL = {
  U: new THREE.Vector3(0, 1, 0),
  R: new THREE.Vector3(1, 0, 0),
  F: new THREE.Vector3(0, 0, 1),
  D: new THREE.Vector3(0, -1, 0),
  L: new THREE.Vector3(-1, 0, 0),
  B: new THREE.Vector3(0, 0, -1),
};
const RIGHT = {
  U: new THREE.Vector3(1, 0, 0),
  R: new THREE.Vector3(0, 0, -1),
  F: new THREE.Vector3(1, 0, 0),
  D: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(-1, 0, 0),
};
const UP = {
  U: new THREE.Vector3(0, 0, -1),
  R: new THREE.Vector3(0, 1, 0),
  F: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, 0, 1),
  L: new THREE.Vector3(0, 1, 0),
  B: new THREE.Vector3(0, 1, 0),
};

function parseMove(token) {
  const face = token[0];
  let turns = 1;
  if (token.endsWith("2")) turns = 2;
  else if (token.endsWith("'")) turns = -1;
  return { face, turns };
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class CubeView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.camera.position.set(5.7, 4.8, 6.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 12;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.cubelets = [];
    this.busy = false;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x718078, 2.2);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 7, 8);
    this.scene.add(key);

    this.resize();
    this.animateLoop();
  }

  dispose() {
    this._resizeObserver.disconnect();
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
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of materials) {
            m.map?.dispose?.();
            m.dispose?.();
          }
        }
      });
    }
    this.cubelets = [];
  }

  build(tileCanvases) {
    this.clear();
    const boxGeometry = new THREE.BoxGeometry(0.94, 0.94, 0.94);
    const black = new THREE.MeshStandardMaterial({ color: 0x101312, roughness: 0.68, metalness: 0.05 });
    const cubeletByKey = new Map();

    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          const group = new THREE.Group();
          group.position.set(x, y, z);
          group.userData.logical = new THREE.Vector3(x, y, z);
          const mesh = new THREE.Mesh(boxGeometry.clone(), black.clone());
          group.add(mesh);
          this.root.add(group);
          this.cubelets.push(group);
          cubeletByKey.set(`${x},${y},${z}`, group);
        }
      }
    }

    for (let f = 0; f < 6; f += 1) {
      const face = FACE_NAMES[f];
      const n = NORMAL[face];
      const right = RIGHT[face];
      const up = UP[face];
      for (let local = 0; local < 9; local += 1) {
        const row = Math.floor(local / 3);
        const col = local % 3;
        const pos = n.clone().add(right.clone().multiplyScalar(col - 1)).add(up.clone().multiplyScalar(1 - row));
        const key = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
        const cubelet = cubeletByKey.get(key);
        if (!cubelet) continue;

        const canvas = tileCanvases[f * 9 + local];
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), material);
        sticker.position.copy(n.clone().multiplyScalar(0.481));

        const basis = new THREE.Matrix4();
        basis.makeBasis(right, up, n);
        sticker.quaternion.setFromRotationMatrix(basis);
        cubelet.add(sticker);
      }
    }
  }

  async move(token, duration = 430) {
    if (this.busy || !token) return;
    this.busy = true;
    try {
      const { face, turns } = parseMove(token);
      const axis = NORMAL[face];
      if (!axis) return;
      const pivot = new THREE.Group();
      this.root.add(pivot);
      const selected = this.cubelets.filter((cubelet) => cubelet.position.dot(axis) > 0.5);
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
          Math.round(cubelet.position.x),
          Math.round(cubelet.position.y),
          Math.round(cubelet.position.z),
        );
        // Snap quaternion to quarter turns to prevent numerical drift.
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
