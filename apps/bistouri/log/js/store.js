// On-device storage. IndexedDB holds the resident's cases (including ones not yet
// synced) and cached copies of their account and program lists, so the logger
// opens and saves cases with no signal. localStorage holds small preferences.

const DB_NAME = 'bistouri-log';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // One row per case: { id, owner_id, program_id, case_date, ..., needs_sync }
        if (!db.objectStoreNames.contains('cases')) {
          db.createObjectStore('cases', { keyPath: 'id' }).createIndex('owner', 'owner_id');
        }
        // Caches and queues: 'account:<uid>', 'reference:<pid>', 'unlocks:<uid>'
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const kv = {
  get: (key) => run('kv', 'readonly', (s) => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', (s) => { s.put(value, key); }),
  del: (key) => run('kv', 'readwrite', (s) => { s.delete(key); }),
};

export const caseStore = {
  /** Every case on this device for one user, deleted ones included. */
  all: (ownerId) => run('cases', 'readonly', (s) => s.index('owner').getAll(ownerId)),
  put: (c) => run('cases', 'readwrite', (s) => { s.put(c); }),
  putMany: (list) => run('cases', 'readwrite', (s) => { for (const c of list) s.put(c); }),
  removeOwner: async (ownerId) => {
    const rows = await caseStore.all(ownerId);
    return run('cases', 'readwrite', (s) => { for (const c of rows) s.delete(c.id); });
  },
};

// localStorage can throw (private windows, blocked storage); preferences are
// conveniences, so failures are ignored.
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('bistouri.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('bistouri.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  removeWhere(test) {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('bistouri.') && test(k.slice(9))) localStorage.removeItem(k);
    } catch { /* ignore */ }
  },
};
