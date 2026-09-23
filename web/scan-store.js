const DB_NAME = "picture-cube-solver";
const DB_VERSION = 1;
const STORE = "scan";
const KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open scan storage"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode captured face")), "image/webp", 0.94);
  });
}

async function blobCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

export async function saveScan(size, captures, rotations) {
  if (!globalThis.indexedDB) return;
  const faces = {};
  for (const [face, canvas] of captures) faces[face] = await canvasBlob(canvas);
  const rotationObject = Object.fromEntries(rotations);
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({
      version: 1,
      size: Number(size),
      savedAt: Date.now(),
      rotations: rotationObject,
      faces,
    }, KEY);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save scan"));
      transaction.onabort = () => reject(transaction.error || new Error("Could not save scan"));
    });
  } finally {
    db.close();
  }
}

export async function loadScan() {
  if (!globalThis.indexedDB) return null;
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readonly");
    const record = await requestResult(transaction.objectStore(STORE).get(KEY));
    if (!record?.faces || ![2, 3, 4].includes(Number(record.size))) return null;
    const captures = new Map();
    for (const [face, blob] of Object.entries(record.faces)) {
      if (blob instanceof Blob) captures.set(face, await blobCanvas(blob));
    }
    return {
      size: Number(record.size),
      savedAt: Number(record.savedAt || 0),
      captures,
      rotations: new Map(Object.entries(record.rotations || {}).map(([face, value]) => [face, Number(value) || 0])),
    };
  } finally {
    db.close();
  }
}

export async function clearScan() {
  if (!globalThis.indexedDB) return;
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(KEY);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear scan"));
      transaction.onabort = () => reject(transaction.error || new Error("Could not clear scan"));
    });
  } finally {
    db.close();
  }
}
