// Image storage in IndexedDB (photos and stickers are too big for localStorage).
// If IndexedDB is unavailable the session keeps working from memory; only a refresh loses the images.
const DB_NAME = 'peelings';
const STORE = 'blobs';
const memory = new Map();
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putBlob(key, blob) {
  memory.set(key, blob);
  const db = await open();
  if (!db) return false;
  try { await tx(db, 'readwrite', (s) => s.put(blob, key)); return true; } catch { return false; }
}

export async function getBlob(key) {
  const db = await open();
  if (db) {
    try {
      const v = await tx(db, 'readonly', (s) => s.get(key));
      if (v) return v;
    } catch { /* fall through to memory */ }
  }
  return memory.get(key) || null;
}

export async function deleteBlobs(keys) {
  for (const k of keys) memory.delete(k);
  const db = await open();
  if (!db || !keys.length) return;
  try { await tx(db, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); return null; }); } catch { /* ignore */ }
}

export async function listKeys() {
  const db = await open();
  if (!db) return [...memory.keys()];
  try { return (await tx(db, 'readonly', (s) => s.getAllKeys())).map(String); } catch { return [...memory.keys()]; }
}
