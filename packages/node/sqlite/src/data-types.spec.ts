// Ported from refs/node-test/parallel/test-sqlite-data-types.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-types-test-' + Date.now());

/**
 * Is the `node:sqlite` imported above the HOST'S OWN binding, or `@gjsify/sqlite`?
 *
 * This is the question the gate below has to ask, and it is NOT "which host is this?".
 * The package declares `runtimes.node: "none"`, so on Node the specs import Node's own
 * module — but `test:gjs-on-node` builds the very same specs with
 * `--alias node:sqlite=@gjsify/sqlite` and runs OUR implementation on a Node host
 * (the node-gi consumer legs, node/bun/deno). Host and implementation come apart there,
 * and only the implementation decides what `stmt.run(1, undefined)` does.
 *
 * `[native code]` is what ECMA-262 renders for a function with no ECMAScript source, so a
 * true answer means the binding came from the host, not from a bundle of our TypeScript.
 * It cannot mask a regression in the direction that matters: were `@gjsify/sqlite` to go
 * back to refusing `undefined`, this stays false and the test still demands NULL.
 */
const SQLITE_IS_HOST_BUILTIN = /\[native code\]/.test(Function.prototype.toString.call(DatabaseSync));

/**
 * The host's own node:sqlite before v26.10.0 — the one implementation that still refuses
 * an explicitly-passed `undefined`.
 *
 * nodejs/node#65709 ("sqlite: bind undefined to NULL") binds an explicit `undefined` to NULL so
 * that passing a parameter as `undefined` agrees with omitting it — which bound NULL already, on
 * both implementations. It is a deliberate contract change, not a defect: it updated
 * `doc/api/sqlite.md` ("`undefined` is written as `NULL` … `NULL` always reads back as {null},
 * never `undefined`") and dropped `undefined` from the very "unsupported data types" list this
 * file ports. `@gjsify/sqlite` follows it unconditionally, so this constant never describes OUR
 * implementation — only a host binding the `test:node` leg reaches, and the two hosts a
 * contributor meets disagree: `.nvmrc` says 24, `main.yml` runs 26.x. Measured on these
 * binaries — 24.19.0, 25.2.1, 26.4.0, 26.8.2 and 26.9.0 throw `ERR_INVALID_ARG_TYPE`;
 * 26.10.0 stores NULL.
 *
 * THE VERSION IS READ ONLY AFTER THE IMPLEMENTATION IS, and the ordering is the whole fix.
 * A version-first gate reads any host below 26.10 as "refuses" and so excuses the old
 * behaviour on the legs that run our own code: `@gjsify/process` reports
 * `process.versions.node === '20.0.0'` under GJS (the same trap is written up in
 * `packages/node/url/src/index.spec.ts`), Bun and Deno report their own compat versions, and
 * the node-gi consumer jobs run on Node 22 while testing `@gjsify/sqlite`. Measured: gating on
 * `process.versions.gjs` first fixed the GJS leg and left the Node-hosted ones asserting a
 * throw against an implementation that binds NULL — "sqlite suite as node-gi consumer" and
 * "node-gi consumer harness" went red with `Expected [anonymous function] to throw an
 * exception`. Asking which implementation is under test answers all four hosts at once.
 */
const HOST_SQLITE_REFUSES_UNDEFINED = (() => {
    if (!SQLITE_IS_HOST_BUILTIN) return false;
    const version = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    if (typeof version !== 'string') return false;
    const [major = 0, minor = 0] = version.split('.').map(Number);
    return major < 26 || (major === 26 && minor < 10);
})();

function setup() {
    // recursive:true already makes an existing dir a no-op — any other
    // failure (EACCES) should fail the suite loudly, not vanish.
    mkdirSync(testDir, { recursive: true });
}

function cleanup() {
    // force:true already makes a missing dir a no-op — any other failure
    // (EACCES) should fail the suite loudly, not vanish.
    rmSync(testDir, { recursive: true, force: true });
}

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
}

export default async () => {
    setup();

    await describe('sqlite data types', async () => {
        await it('supports INTEGER, REAL, TEXT, BLOB, and NULL', async () => {
            const u8a = new TextEncoder().encode('a☃b☃c');
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE types(
                    key INTEGER PRIMARY KEY,
                    int INTEGER,
                    double REAL,
                    text TEXT,
                    buf BLOB
                ) STRICT;
            `);
            const stmt = db.prepare('INSERT INTO types (key, int, double, text, buf) VALUES (?, ?, ?, ?, ?)');

            const r1 = stmt.run(1, 42, 3.14159, 'foo', u8a);
            expect(r1.changes).toBe(1);
            expect(r1.lastInsertRowid).toBe(1);

            const r2 = stmt.run(2, null, null, null, null);
            expect(r2.changes).toBe(1);
            expect(r2.lastInsertRowid).toBe(2);

            const query = db.prepare('SELECT * FROM types WHERE key = ?');

            const row1 = query.get(1) as Record<string, unknown>;
            expect(row1.key).toBe(1);
            expect(row1.int).toBe(42);
            expect(row1.double).toBe(3.14159);
            expect(row1.text).toBe('foo');

            const row2 = query.get(2) as Record<string, unknown>;
            expect(row2.key).toBe(2);
            expect(row2.int).toBeNull();
            expect(row2.double).toBeNull();
            expect(row2.text).toBeNull();
            expect(row2.buf).toBeNull();

            db.close();
        });

        await it('rejects unsupported data types', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');

            // `undefined` is NOT in this list: it binds NULL, and has its own test below.
            // Upstream removed it from the same list in nodejs/node#65709.
            const unsupported = [() => {}, Symbol(), /foo/, Promise.resolve(), new Map(), new Set()];

            for (const val of unsupported) {
                expect(() => {
                    // Intentionally pass non-SQLInputValue values to verify runtime rejection.
                    // oxlint-disable-next-line typescript/no-explicit-any -- spec passes a deliberately-varied union of SQL input values (BigInt, Date, Buffer, …) into a parameterized query to verify the SQL-value conversion path
                    db.prepare('INSERT INTO types (key, val) VALUES (?, ?)').run(1, val as any);
                }).toThrow();
            }

            db.close();
        });

        await it('binds undefined as NULL, exactly like an omitted parameter', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');

            if (HOST_SQLITE_REFUSES_UNDEFINED) {
                // The host's own node:sqlite before 26.10 refuses the value outright.
                // Asserted rather than skipped: the answer is stated on both sides of the
                // boundary, so the day CI's Node moves, the divergence is a fact this file
                // already records.
                expect(() => stmt.run(1, undefined)).toThrow();
                db.close();
                return;
            }

            expect(stmt.run(1, undefined).changes).toBe(1);
            // The agreement the change is for: explicit `undefined` and an absent argument
            // reach SQLite as the same value.
            expect(stmt.run(2).changes).toBe(1);

            const query = db.prepare('SELECT val FROM types WHERE key = ?');
            // NULL reads back as `null`, never as `undefined` — the round trip is not symmetric.
            expect((query.get(1) as Record<string, unknown>).val).toBeNull();
            expect((query.get(2) as Record<string, unknown>).val).toBeNull();

            db.close();
        });

        await it('supports BigInt binding', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');
            const result = stmt.run(4, 99n);
            expect(result.changes).toBe(1);

            const query = db.prepare('SELECT * FROM types WHERE key = ?');
            const row = query.get(4) as Record<string, unknown>;
            expect(row.val).toBe(99);
            db.close();
        });

        await it('throws when binding a BigInt that is too large', async () => {
            const max = 9223372036854775807n;
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');

            // Max should succeed
            stmt.run(1, max);

            // Max + 1 should throw
            expect(() => {
                stmt.run(2, max + 1n);
            }).toThrow();
            db.close();
        });

        await it('statements are unbound on each call', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO data (key, val) VALUES (?, ?)');

            const r1 = stmt.run(1, 5);
            expect(r1.changes).toBe(1);

            // Second call without params — params should be unbound (NULL)
            const r2 = stmt.run();
            expect(r2.changes).toBe(1);

            const rows = db.prepare('SELECT * FROM data ORDER BY key').all() as Record<string, unknown>[];
            expect(rows.length).toBe(2);
            expect(rows[0].key).toBe(1);
            expect(rows[0].val).toBe(5);
            expect(rows[1].val).toBeNull();
            db.close();
        });
    });

    // SQLite's INTEGER is 64 bits wide. libgda typed such a column gint and refused every
    // value outside 32 bits, which failed the SELECT (on 0.49.0 it read back as no rows) —
    // a millisecond timestamp was enough. node:sqlite's contract: a Number while it is
    // safe, a BigInt with readBigInts, and ERR_OUT_OF_RANGE past Number.MAX_SAFE_INTEGER.
    await describe('64-bit integers', async () => {
        const safe = [2 ** 31, 2 ** 32, 2 ** 53 - 1, -(2 ** 31) - 1, -(2 ** 53 - 1)];
        // -(2^63) is left out of the throwing case on purpose: node:sqlite tests
        // `std::abs(val) <= kMaxSafeJsInteger`, and abs(INT64_MIN) overflows, so Node
        // returns it as a rounded Number. That is undefined behaviour, not a contract.
        const unsafe = [2n ** 53n + 1n, -(2n ** 53n), 2n ** 63n - 1n];

        await it('reads safe values back as Numbers, bound as Number and as BigInt', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, seq INTEGER, loose)');
            const insert = db.prepare('INSERT INTO t (seq, loose) VALUES (?, ?)');
            for (const value of safe) {
                insert.run(value, BigInt(value));
            }
            const rows = db.prepare('SELECT seq, loose FROM t ORDER BY id').all() as {
                seq: number;
                loose: number;
            }[];
            expect(rows.length).toBe(safe.length);
            for (let i = 0; i < safe.length; i++) {
                expect(rows[i].seq).toBe(safe[i]);
                expect(rows[i].loose).toBe(safe[i]);
            }
            const one = db.prepare('SELECT seq FROM t WHERE seq = ?').get(2 ** 32) as { seq: number };
            expect(one.seq).toBe(2 ** 32);
            db.close();
        });

        await it('reads every value back exactly with readBigInts', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, seq INTEGER)');
            const insert = db.prepare('INSERT INTO t (seq) VALUES (?)');
            const all = [...safe.map((v) => BigInt(v)), ...unsafe, -(2n ** 63n)];
            for (const value of all) insert.run(value);
            const select = db.prepare('SELECT seq FROM t ORDER BY id');
            select.setReadBigInts(true);
            const rows = select.all() as { seq: bigint }[];
            expect(rows.length).toBe(all.length);
            for (let i = 0; i < all.length; i++) {
                expect(rows[i].seq).toBe(all[i]);
            }
            const lookup = db.prepare('SELECT seq FROM t WHERE seq = ?');
            lookup.setReadBigInts(true);
            expect((lookup.get(2n ** 63n - 1n) as { seq: bigint }).seq).toBe(2n ** 63n - 1n);
            db.close();
        });

        await it('throws ERR_OUT_OF_RANGE past MAX_SAFE_INTEGER without readBigInts', async () => {
            for (const value of unsafe) {
                const db = new DatabaseSync(':memory:');
                db.exec('CREATE TABLE t(seq INTEGER)');
                db.prepare('INSERT INTO t (seq) VALUES (?)').run(value);
                let code: unknown = 'nothing was thrown';
                try {
                    db.prepare('SELECT seq FROM t').all();
                } catch (e) {
                    code = (e as { code?: unknown }).code;
                }
                expect(code).toBe('ERR_OUT_OF_RANGE');
                db.close();
            }
        });

        await it('reads a large integer from an expression and a NULL-first column', async () => {
            const db = new DatabaseSync(':memory:');
            expect((db.prepare('SELECT 2147483648 AS v').get() as { v: number }).v).toBe(2147483648);
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, ts)');
            db.exec('INSERT INTO t (ts) VALUES (NULL)');
            const select = db.prepare('SELECT ts FROM t ORDER BY id');
            expect((select.all() as { ts: unknown }[])[0].ts).toBeNull();
            db.exec('INSERT INTO t (ts) VALUES (1727280000000)');
            const rows = select.all() as { ts: unknown }[];
            expect(rows.length).toBe(2);
            expect(rows[1].ts).toBe(1727280000000);
            db.close();
        });

        await it('returns a rowid past 2^31 as lastInsertRowid', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');
            expect(insert.run(2 ** 32, 'a').lastInsertRowid).toBe(2 ** 32);
            expect(insert.run(2 ** 53 - 1, 'b').lastInsertRowid).toBe(2 ** 53 - 1);
            insert.setReadBigInts(true);
            expect(insert.run(2n ** 63n - 1n, 'c').lastInsertRowid).toBe(2n ** 63n - 1n);
            db.close();
        });
    });

    cleanup();
};
