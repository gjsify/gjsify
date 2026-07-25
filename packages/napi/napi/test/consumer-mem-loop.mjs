// SPDX-License-Identifier: MIT
// @gjsify/napi — better-sqlite3 MEMORY LEG loop (plan §10 memory leg / §11
// milestone 3). GJS-only stress driver run under valgrind by
// test/consumer-mem.sh: repeatedly load→exercise→drop→GC→drain, then exit.
//
// better-sqlite3 hammers the crash-class paths: every Database/Statement is a
// Napi::ObjectWrap (reserved-slot wrap + type-tag), custom functions/aggregates
// hold string-primitive references and call back into JS synchronously during
// sqlite3_step, and closing a DB + dropping refs + a forced full GC runs our
// finalizer pipeline. The final process exit runs env teardown — exactly where
// a wrap/ref/finalizer UAF surfaces. GJS-only: uses `imports.system.gc()` +
// a GLib main-context pump to force deterministic finalizer drains.

import Database from 'better-sqlite3';

const GLib = imports.gi.GLib;
const system = imports.system;

const ctx = GLib.MainContext.default();
const pump = () => {
    while (ctx.pending()) ctx.iteration(false);
};

function exercise(i) {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, v REAL, data BLOB)');
    const ins = db.prepare('INSERT INTO t (id, name, v, data) VALUES (?, ?, ?, ?)');
    for (let k = 0; k < 20; k++) {
        ins.run(k, `row-${i}-${k}`, k + 0.5, Buffer.from([k & 0xff, (k * 3) & 0xff, i & 0xff]));
    }
    // wraps: many prepared statements
    const sel = db.prepare('SELECT id, name, v, data FROM t WHERE id = ?');
    let acc = 0;
    for (let k = 0; k < 20; k++) {
        const r = sel.get(k);
        acc += r.id + r.data.length;
    }
    // custom scalar + aggregate (sync JS callbacks + string-primitive refs)
    db.function('tag', (s) => `<${s}>`);
    db.aggregate('joiner', { start: '', step: (a, s) => (a ? a + ',' + s : String(s)) });
    void db.prepare('SELECT tag(name) AS t FROM t WHERE id = 0').get().t;
    void db.prepare('SELECT joiner(name) AS j FROM t').get().j;
    // BigInt path
    void db.prepare('SELECT id FROM t WHERE id = 5').safeIntegers().get().id;
    // iterator (Symbol.iterator wrap)
    for (const _ of db.prepare('SELECT id FROM t').iterate()) acc++;
    db.close();
    return acc;
}

const ITER = Number(ARGV[0] || 25);
let total = 0;
for (let i = 0; i < ITER; i++) {
    total += exercise(i);
    if (i % 5 === 0) {
        system.gc(); // force full GC → weak sweep → queue finalizers
        pump(); // run the idle finalizer drain
    }
}
system.gc();
pump();
print(`MEM LOOP: ${ITER} iterations ok, checksum ${total}`);
