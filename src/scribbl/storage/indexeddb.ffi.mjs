// IndexedDB, callback style: database "scribbl", store "notes", records
// { key, title, body, modified }. A note without a typed title has title "".
// Each function calls exactly one of its callbacks, once. `fail` receives a
// message string. Records go back to Gleam as plain objects, which
// `indexeddb.gleam` decodes.

const DATABASE = "scribbl";
const STORE = "notes";

// Opened on first use and then kept. A failed open is forgotten, so the next
// call tries again.
let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) throw new Error("this browser has no IndexedDB");
    const request = globalThis.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

// Run one request in its own transaction. `done` gets the request's result,
// but only once the transaction has committed.
function run(mode, request, done, fail) {
  const failed = (error) => fail(String(error?.message ?? error));
  open()
    .then((database) => {
      const transaction = database.transaction(STORE, mode);
      const pending = request(transaction.objectStore(STORE));
      transaction.oncomplete = () => done(pending.result);
      transaction.onabort = () => failed(transaction.error ?? "aborted");
    })
    .catch(failed);
}

export function all(found, fail) {
  run("readonly", (store) => store.getAll(), found, fail);
}

export function get(key, found, missing, fail) {
  const done = (record) => (record === undefined ? missing() : found(record));
  run("readonly", (store) => store.get(key), done, fail);
}

export function put(key, title, body, done, fail) {
  const record = { key, title, body, modified: Date.now() };
  run("readwrite", (store) => store.put(record), () => done(), fail);
}

export function add(added, fail) {
  let record;
  const request = (store) => {
    const key = newKey();
    record = { key, title: "", body: "", modified: Date.now() };
    return store.add(record);
  };
  run("readwrite", request, () => added(record), fail);
}

// randomUUID only exists on https and localhost. A phone reaching a laptop
// by its LAN address over http gets the fallback.
function newKey() {
  const random = () => Math.random().toString(36).slice(2);
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${random()}`;
}

// Succeeds if the record is already gone.
export function remove(key, done, fail) {
  run("readwrite", (store) => store.delete(key), () => done(), fail);
}
