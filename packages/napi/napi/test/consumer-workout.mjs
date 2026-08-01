// SPDX-License-Identifier: MIT
// @gjsify/napi — better-sqlite3 CONSUMER WORKOUT (plan §12 / §11 milestone 3).
//
// ONE source file, run identically on:
//   - Node.js         (golden)   — real better-sqlite3 + its compiled .node
//   - GJS-under-shim  (must match)— same .node loaded via @gjsify/napi loadAddon
//
// The gate (test/consumer-gate.mjs) byte-diffs the two stdouts. Every line is
// pre-formatted deterministically and emitted in ONE console.log at the end so
// no console.* inspection difference between the runtimes can leak in.
//
// Exercises the full better-sqlite3 JS API the plan calls out: bound params
// (text/int/real/null/blob), prepared-statement reuse, .get/.all, BigInt via
// .safeIntegers(), BLOB->Buffer round-trip, stmt.iterate() (Symbol.iterator),
// db.transaction(), a custom scalar function + an aggregate (synchronous JS
// callbacks during sqlite3_step + string-primitive refs), a constraint
// violation (SqliteError + .code), and a user function that throws `null`
// (the must-not-abort exception contract, plan §6).

import Database from 'better-sqlite3';

const out = [];
const log = (...parts) => out.push(parts.join(' '));

// Deterministic hex of a Buffer/Uint8Array (avoids any inspect divergence).
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

log('=== better-sqlite3 consumer workout ===');

const db = new Database(':memory:');
log('open :memory: ok, better-sqlite3', Database.prototype.constructor.name);

// --- schema + typed columns (text/int/real/null/blob) ---
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, price REAL, note TEXT, data BLOB)');

const blobIn = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x7f]);

// prepared statement REUSED across inserts, mixed bound param types incl. null + blob
const ins = db.prepare('INSERT INTO t (id, name, qty, price, note, data) VALUES (?, ?, ?, ?, ?, ?)');
const r1 = ins.run(1, 'alpha', 10, 3.5, null, blobIn);
const r2 = ins.run(2, 'beta', 20, 1.25, 'hello', null);
const r3 = ins.run(3, 'gamma', 0, 0.0, null, Buffer.from('gjs'));
log('insert changes', r1.changes, r2.changes, r3.changes, 'lastRowid', Number(r3.lastInsertRowid));

// --- SELECT back: .get and .all ---
const getOne = db.prepare('SELECT id, name, qty, price, note FROM t WHERE id = ?');
const row1 = getOne.get(1);
log('get id=1', JSON.stringify(row1));
const row2 = getOne.get(2);
log('get id=2', JSON.stringify(row2));

const all = db.prepare('SELECT id, name, qty FROM t ORDER BY id').all();
log('all', JSON.stringify(all));

// --- BLOB -> Buffer round-trip ---
const blobBack = db.prepare('SELECT data FROM t WHERE id = ?').get(1).data;
log('blob isBuffer', Buffer.isBuffer(blobBack), 'hex', hex(blobBack), 'match', hex(blobBack) === hex(blobIn));
const blobBack3 = db.prepare('SELECT data FROM t WHERE id = ?').get(3).data;
log('blob3 utf8', Buffer.from(blobBack3).toString('utf8'));

// --- BigInt round-trip via .safeIntegers() ---
db.prepare('INSERT INTO t (id, name, qty, price) VALUES (?, ?, ?, ?)').run(
    4,
    'big',
    // 2^53 + 1 as a JS NUMBER literal is deliberately lossy — this seed row is the
    // contrast the exact-BigInt bind + read-back below is measured against, and the
    // workout's transcript is golden-diffed against Node, so the value must not change.
    // oxlint-disable-next-line eslint/no-loss-of-precision -- the lossy literal is the fixture
    9007199254740993,
    0.0,
);
// bind an exact BigInt beyond 2^53 and read it back losslessly
const bigStmt = db.prepare('UPDATE t SET qty = ? WHERE id = 4');
bigStmt.run(9007199254740993n);
const safe = db.prepare('SELECT qty FROM t WHERE id = 4').safeIntegers();
const bigVal = safe.get().qty;
log('bigint typeof', typeof bigVal, 'value', bigVal.toString(), 'exact', bigVal === 9007199254740993n);

// --- stmt.iterate() exercises Symbol.iterator ---
const iterated = [];
for (const r of db.prepare('SELECT id, name FROM t WHERE id <= 3 ORDER BY id').iterate()) {
    iterated.push(`${r.id}:${r.name}`);
}
log('iterate', iterated.join(','));

// --- db.transaction(...) ---
const bump = db.transaction((rows) => {
    const st = db.prepare('UPDATE t SET qty = qty + ? WHERE id = ?');
    let n = 0;
    for (const [id, delta] of rows) n += st.run(delta, id).changes;
    return n;
});
const bumped = bump([
    [1, 5],
    [2, 5],
]);
log('transaction changed', bumped, 'qty1', db.prepare('SELECT qty FROM t WHERE id=1').get().qty);

// --- custom scalar function (sync JS callback during step) ---
db.function('add_tax', (price) => Math.round(price * 100) + 7);
const taxed = db.prepare('SELECT add_tax(price) AS v FROM t WHERE id = 1').get().v;
log('scalar add_tax(3.5)', taxed);

// --- custom aggregate (sync JS callbacks + string-primitive refs via names) ---
db.aggregate('concat_names', {
    start: '',
    step: (acc, name) => (acc === '' ? String(name) : acc + '|' + String(name)),
});
const cat = db.prepare('SELECT concat_names(name) AS v FROM t WHERE id <= 3 ORDER BY id').get().v;
log('aggregate concat_names', cat);

db.aggregate('sum_qty', {
    start: 0,
    step: (acc, q) => acc + q,
    result: (acc) => acc,
});
const sq = db.prepare('SELECT sum_qty(qty) AS v FROM t WHERE id <= 3').get().v;
log('aggregate sum_qty', sq);

// --- error path: constraint violation -> SqliteError with .code ---
let ce = 'none';
try {
    ins.run(1, 'dup', 1, 1.0, null, null); // id=1 already exists (PRIMARY KEY)
} catch (e) {
    ce = `${e instanceof Database.SqliteError ? 'SqliteError' : e && e.constructor && e.constructor.name}:${e.code}`;
}
log('constraint', ce);

// --- must-not-abort: a user function that throws `null` ---
db.function('boom', () => {
    throw null;
});
let boom = 'no-throw';
try {
    db.prepare('SELECT boom()').get();
} catch (e) {
    boom = `threw isNull=${e === null} type=${typeof e} isError=${e instanceof Error}`;
}
log('boom', boom);

// still alive + usable after the thrown-null (proves no abort / clean pending state)
const aliveCount = db.prepare('SELECT COUNT(*) AS c FROM t').get().c;
log('alive after boom, rows', aliveCount);

db.close();
log('closed ok');
log('=== workout complete ===');

console.log(out.join('\n'));
