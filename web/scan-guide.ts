import * as THREE from "three";

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
  D: new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, -1, 0)), L: new THREE.Vector3(0, 1, 0), B: new THREE.Vector3(0, 1, 0),
};
UP.D.set(0, 0, 1);

const container = document.querySelector("#scan-orientation-guide");
const title = document.querySelector("#scan-title");
const reviewGrid = document.querySelector("#review-grid");
const cubeSizeSelect = document.querySelector("#cube-size");

if (container && title && reviewGrid && cubeSizeSelect) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0, 5.6);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7774, 2.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(3, 5, 7);
  scene.add(key);

  const root = new THREE.Group();
  scene.add(root);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.02, 2.02, 2.02),
    new THREE.MeshStandardMaterial({ color: 0x171a19, roughness: 0.78, metalness: 0.02 }),
  );
  root.add(body);

  const faceMeshes = new Map();
  for (const face of FACE_NAMES) {
    const normal = NORMAL[face];
    const right = RIGHT[face];
    const up = UP[face];
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.92, 1.92),
      new THREE.MeshBasicMaterial({ color: 0x8b8f8d, side: THREE.DoubleSide }),
    );
    plane.position.copy(normal.clone().multiplyScalar(1.015));
    const basis = new THREE.Matrix4().makeBasis(right, up, normal);
    plane.quaternion.setFromRotationMatrix(basis);
    root.add(plane);
    faceMeshes.set(face, plane);
  }

  const q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
  const ORIENTATION = {
    F: q(),
    R: q(0, -Math.PI / 2, 0),
    B: q(0, Math.PI, 0),
    L: q(0, Math.PI / 2, 0),
    U: q(Math.PI / 2, 0, 0),
    D: q(-Math.PI / 2, 0, 0),
  };

  let timeline = [{ from: ORIENTATION.F, to: ORIENTATION.F, duration: 1, hold: 1 }];
  let timelineDuration = 1;
  let animationStart = performance.now();

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  }

  function stepFace() {
    const text = title.textContent.toLowerCase();
    if (text.includes("right")) return "R";
    if (text.includes("back")) return "B";
    if (text.includes("left")) return "L";
    if (text.includes("top")) return "U";
    if (text.includes("bottom")) return "D";
    if (text.includes("front")) return "F";
    return null;
  }

  function transitionFor(face) {
    const segment = (from, to, duration = 1500, hold = 650) => ({ from, to, duration, hold });
    switch (face) {
      case "R": return [segment(ORIENTATION.F, ORIENTATION.R)];
      case "B": return [segment(ORIENTATION.R, ORIENTATION.B)];
      case "L": return [segment(ORIENTATION.B, ORIENTATION.L)];
      case "U": return [
        segment(ORIENTATION.L, ORIENTATION.F, 1350, 850),
        segment(ORIENTATION.F, ORIENTATION.U, 1500, 1100),
      ];
      case "D": return [
        segment(ORIENTATION.U, ORIENTATION.F, 1350, 850),
        segment(ORIENTATION.F, ORIENTATION.D, 1500, 1100),
      ];
      case "F": return [segment(ORIENTATION.F, ORIENTATION.F, 1, 1400)];
      default: return [segment(ORIENTATION.D, ORIENTATION.D, 1, 1400)];
    }
  }

  function capturedFaceCanvases() {
    const out = new Map();
    for (const card of reviewGrid.querySelectorAll(".scan-card")) {
      const face = card.querySelector(".scan-card__head span")?.textContent?.trim();
      const canvas = card.querySelector("canvas");
      if (FACE_NAMES.includes(face) && canvas) out.set(face, canvas);
    }
    return out;
  }

  function updateTextures() {
    const captured = capturedFaceCanvases();
    for (const face of FACE_NAMES) {
      const mesh = faceMeshes.get(face);
      const material = mesh.material;
      material.map?.dispose?.();
      material.map = null;
      const canvas = captured.get(face);
      if (canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        material.color.set(0xffffff);
        material.map = texture;
      } else {
        material.color.set(0x8b8f8d);
      }
      material.needsUpdate = true;
    }
  }

  function updateTimeline() {
    timeline = transitionFor(stepFace());
    timelineDuration = timeline.reduce((sum, item) => sum + item.duration + item.hold, 0) + 900;
    animationStart = performance.now();
  }

  function update() {
    updateTextures();
    updateTimeline();
    const ready = title.textContent.toLowerCase().includes("ready to solve");
    container.closest(".scan-guide-wrap")?.classList.toggle("scan-guide-wrap--done", ready);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate(now) {
    const elapsed = (now - animationStart) % timelineDuration;
    let cursor = 0;
    let applied = false;
    for (const item of timeline) {
      if (elapsed <= cursor + item.duration) {
        const t = item.duration <= 1 ? 1 : Math.max(0, Math.min(1, (elapsed - cursor) / item.duration));
        root.quaternion.slerpQuaternions(item.from, item.to, ease(t));
        applied = true;
        break;
      }
      cursor += item.duration;
      if (elapsed <= cursor + item.hold) {
        root.quaternion.copy(item.to);
        applied = true;
        break;
      }
      cursor += item.hold;
    }
    if (!applied) root.quaternion.copy(timeline[0].from);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  const observer = new MutationObserver(update);
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  observer.observe(reviewGrid, { childList: true, subtree: true });
  cubeSizeSelect.addEventListener("change", updateTimeline);
  new ResizeObserver(resize).observe(container);

  update();
  resize();
  requestAnimationFrame(animate);
}
