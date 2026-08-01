// SPDX-License-Identifier: MIT
// node-sqlite3 consumer workout — ONE source, Node (golden) + GJS-shim.
//
// node-sqlite3 (v5) is node-addon-api based and fundamentally ASYNCHRONOUS:
// EVERY operation (even opening `:memory:`) is dispatched through a
// `Napi::AsyncWorker`, i.e. napi_create_async_work + napi_queue_async_work +
// the libuv event loop. In @gjsify/napi those four functions are a LOUD STUB
// (napi_generic_failure). This workout is the empirical probe of whether the
// async_work stub actually blocks a common real addon:
//
//   Phase A (sync)  — module load + sync constants/prototypes. Should be
//                     byte-identical: proves the addon LOADS and the sync
//                     N-API surface works under the shim.
//   Phase B (async) — open :memory:, create/insert/select, close, all via
//                     callbacks. On Node this yields real rows; under the shim
//                     it must fail at the first async_work call. The gate
//                     (sqlite3 is flagged `async`) reports the divergence as a
//                     FINDING, capturing exactly where/how it breaks.

import sqlite3 from 'sqlite3';

const out = [];
const log = (...p) => out.push(p.join(' '));

// --- Phase A: sync surface (must match) ---
log('=== node-sqlite3 workout ===');
log('sqlite3.VERSION', sqlite3.VERSION);
log('sqlite3.VERSION_NUMBER', sqlite3.VERSION_NUMBER);
log(
    'OPEN_READONLY',
    sqlite3.OPEN_READONLY,
    'OPEN_READWRITE',
    sqlite3.OPEN_READWRITE,
    'OPEN_CREATE',
    sqlite3.OPEN_CREATE,
);
log('OK', sqlite3.OK, 'CONSTRAINT', sqlite3.CONSTRAINT);
log(
    'Database is fn',
    typeof sqlite3.Database === 'function',
    'Statement is fn',
    typeof sqlite3.Statement === 'function',
);
log('Database.prototype.run is fn', typeof sqlite3.Database.prototype.run === 'function');

// --- Phase B: async surface (the async_work probe) ---
// NB: node-sqlite3's Database extends EventEmitter; `db.on(...)` is deliberately
// NOT used here — the gjsify `events` polyfill's EventEmitter is missing
// `_addListener`, an UNRELATED polyfill gap that would mask the async_work
// signature. We drive purely through operation callbacks, which is the real
// async_work path (napi_create_async_work + napi_queue_async_work + libuv).
function asyncFlow() {
    return new Promise((resolve, reject) => {
        let db;
        try {
            db = new sqlite3.Database(':memory:', (err) => {
                if (err) return reject(new Error(`open-callback: ${err.message}`));
                db.serialize(() => {
                    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)');
                    db.run('INSERT INTO t (id, name, qty) VALUES (?, ?, ?)', 1, 'alpha', 10);
                    db.run('INSERT INTO t (id, name, qty) VALUES (?, ?, ?)', 2, 'beta', 20);
                    db.all('SELECT id, name, qty FROM t ORDER BY id', (e, rows) => {
                        if (e) return reject(new Error(`query: ${e.message}`));
                        db.close((ce) => {
                            if (ce) return reject(new Error(`close: ${ce.message}`));
                            resolve(JSON.stringify(rows));
                        });
                    });
                });
            });
        } catch (e) {
            // Construction itself does NOT throw under the shim (async_work fails
            // silently at queue time); this branch is Node-golden defensiveness.
            reject(new Error(`construct-threw: ${e && e.message ? e.message : e}`));
        }
    });
}

// Bound so a shim that neither throws NOR ever completes can't hang the gate.
function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: async work never completed')), ms)),
    ]);
}

let phaseB;
try {
    const rows = await withTimeout(asyncFlow(), 5000);
    phaseB = `OK rows=${rows}`;
} catch (e) {
    // Normalize to a stable marker: we care THAT/WHERE it failed, not the exact
    // napi error text (which may carry runtime-specific detail).
    phaseB = `ASYNC-UNAVAILABLE (${e.message.split(':')[0]})`;
}
log('asyncFlow:', phaseB);
log('=== workout complete ===');
console.log(out.join('\n'));
