// The SECOND connection is the whole subject of this file.
//
// libgda's SQLite provider leaves a dangling GWeakRef on the session-wide
// `GdaSqliteProvider` for every connection it frees (see connection-pool.ts for
// the two upstream source coordinates), so the next connection's `cdata` gets
// the same malloc block back and GLib aborts the PROCESS on the duplicate
// registration. Every other spec in this package opens many databases, and none
// of them caught it: each one closes before the next opens, which is exactly the
// shape that aborts — the suite died at its second test rather than failing one,
// and a dead runner reports nothing. So the assertions here are deliberately
// trivial; what they prove is that the process is still alive to make them.
//
// `.gjs.spec.ts` is load-bearing: `scripts/audit-runtimes.mjs` skips that suffix
// and scans every other `.ts`, so the `system` import below would otherwise be
// read as a source signal and drift this package's declared triplet. The file
// runs on BOTH legs — the reopen cases are ordinary node:sqlite behaviour and
// prove the TEST is right — and only the forced-GC case sits behind `on('Gjs')`.

import { describe, expect, it, on } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const testDir = join(realpathSync(tmpdir()), 'gjsify-sqlite-lifetime-' + Date.now());

let cnt = 0;
function nextDb(): string {
    return join(testDir, `lifetime-${cnt++}.db`);
}

export default async () => {
    mkdirSync(testDir, { recursive: true });

    await describe('DatabaseSync connection lifetime', async () => {
        await it('opens a second file database after the first was closed', async () => {
            const first = new DatabaseSync(nextDb());
            first.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
            first.close();

            const second = new DatabaseSync(nextDb());
            second.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
            second.exec('INSERT INTO t (id) VALUES (1)');
            expect((second.prepare('SELECT id FROM t').get() as { id: number }).id).toBe(1);
            second.close();
        });

        await it('reopens the same file database five times', async () => {
            // Five because the abort is at the SECOND connection and a fix that
            // only parks one connection per key would pass with two.
            const dbPath = nextDb();
            for (let i = 0; i < 5; i++) {
                const db = new DatabaseSync(dbPath);
                db.exec(`CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)`);
                db.exec(`INSERT INTO t (id) VALUES (${i + 1})`);
                expect((db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }).n).toBe(i + 1);
                db.close();
            }
        });

        await it('hands out an EMPTY :memory: database every time', async () => {
            // A parked connection is only sound if it is indistinguishable from a
            // fresh one: `:memory:` means a private database, so the second open
            // must not see the first one's schema. Creating the SAME table is the
            // assertion — a reused dirty connection answers `table t already
            // exists` instead.
            for (let i = 0; i < 3; i++) {
                const db = new DatabaseSync(':memory:');
                // A FIELD, not the row: native node:sqlite hands back a
                // null-prototype object and `toStrictEqual` compares prototypes,
                // so a whole-row literal fails the Node leg over the shape of a
                // row rather than over its contents.
                expect((db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n).toBe(0);
                db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
                db.exec("INSERT INTO t (id, val) VALUES (1, 'x')");
                db.close();
            }
        });

        await it('keeps a file database and a :memory: one apart', async () => {
            const dbPath = nextDb();
            const file = new DatabaseSync(dbPath);
            file.exec('CREATE TABLE onfile (id INTEGER)');
            const mem = new DatabaseSync(':memory:');
            mem.exec('CREATE TABLE inmem (id INTEGER)');
            expect(mem.prepare("SELECT name FROM sqlite_master WHERE name='onfile'").get()).toBe(undefined);
            mem.close();
            file.close();

            const reopened = new DatabaseSync(dbPath);
            const row = reopened.prepare("SELECT name FROM sqlite_master WHERE name='onfile'").get() as {
                name: string;
            };
            expect(row.name).toBe('onfile');
            reopened.close();
        });

        await on('Gjs', async () => {
            await it('survives connections the garbage collector reaps', async () => {
                // Refraining from `close()` is NOT enough: the connection's own
                // finalizer frees the same `cdata`, so a database dropped on the
                // floor aborts the process just as `close()` does once the GC runs
                // (measured: 40 open-and-forget cycles aborted at the second).
                // Hence the pool registers a connection before handing it out, and
                // hence this test forces the collection instead of hoping for it.
                const system = (await import('system' as string)).default as { gc(): void };
                for (let i = 0; i < 8; i++) {
                    const db = new DatabaseSync(nextDb());
                    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
                    // No close(), no reference kept.
                    system.gc();
                }
                const survivor = new DatabaseSync(nextDb());
                expect(survivor.isOpen).toBe(true);
                survivor.close();
            });
        });
    });

    rmSync(testDir, { recursive: true, force: true });
};
