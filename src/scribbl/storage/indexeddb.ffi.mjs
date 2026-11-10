// IndexedDB, callback style: database "scribbl", store "notes", records
// { key, title, body, modified } where title is a string or null.
// Opened on first use. Each function calls exactly one of its callbacks,
// once. `fail` receives a message string.

// all(each, done, fail): each(key, title, body, modified) per record, then done()
// get(key, found, missing, fail): found(title, body, modified) or missing()
// put(key, title, body, done, fail): upsert with modified = Date.now()
// add(done, fail): new empty record under crypto.randomUUID(); done(key, modified)
// remove(key, done, fail): delete; succeeds if already gone
