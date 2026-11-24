// IndexedDB persistence. Writes resolve only after the transaction commits.

const DB_NAME = "hrr-log";
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "session_id" });
      const events = db.createObjectStore("events", { keyPath: ["session_id", "seq"] });
      events.createIndex("by_session", "session_id");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(db, storeNames, apply) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, "readwrite");
    apply(transaction);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function read(db, storeName, query) {
  return new Promise((resolve, reject) => {
    const request = query(db.transaction(storeName, "readonly").objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const putSession = (db, session) =>
  write(db, "sessions", (t) => t.objectStore("sessions").put(session));

export const getSession = (db, id) => read(db, "sessions", (s) => s.get(id));

export async function listSessions(db) {
  const sessions = await read(db, "sessions", (s) => s.getAll());
  return sessions.sort((a, b) => b.created_epoch_ms - a.created_epoch_ms);
}

export const putEvent = (db, event) =>
  write(db, "events", (t) => t.objectStore("events").put(event));

export async function listEvents(db, sessionId) {
  const events = await read(db, "events", (s) => s.index("by_session").getAll(sessionId));
  return events.sort((a, b) => a.seq - b.seq);
}

export const deleteSession = (db, id) =>
  write(db, ["sessions", "events"], (t) => {
    t.objectStore("sessions").delete(id);
    t.objectStore("events").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });

export const setMeta = (db, key, value) =>
  write(db, "meta", (t) => t.objectStore("meta").put({ key, value }));

export async function getMeta(db, key) {
  const row = await read(db, "meta", (s) => s.get(key));
  return row ? row.value : null;
}
