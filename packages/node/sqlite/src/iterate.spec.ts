// StatementSync.prototype.iterate() — node:sqlite ≥ 22.13.
//
// The iterator is ONE execution of one statement: rows are stepped lazily, the column
// names are read once at creation, and the statement is reset the moment the iteration
// ends — whether it ran out of rows or the consumer walked away from it. That reset is
// the load-bearing part: a statement left mid-cursor holds a read lock, so a `break`
// out of a `for … of` has to leave the statement as reusable as exhausting it does.

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-iterate-test-' + Date.now());

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
}

function seeded(rows = 3): DatabaseSync {
    const db = new DatabaseSync(nextDb());
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');
    for (let i = 1; i <= rows; i++) insert.run(i, `row ${i}`);
    return db;
}

export default async () => {
    mkdirSync(testDir, { recursive: true });

    await describe('StatementSync.prototype.iterate()', async () => {
        await it('yields every row as an object, in order', async () => {
            const db = seeded();
            const seen = [...db.prepare('SELECT id, v FROM t ORDER BY id').iterate()] as Record<string, unknown>[];
            expect(seen.length).toBe(3);
            expect(seen[0].id).toBe(1);
            expect(seen[0].v).toBe('row 1');
            expect(seen[2].id).toBe(3);
            expect(seen[2].v).toBe('row 3');
            db.close();
        });

        await it('is iterable with for … of and binds its parameters', async () => {
            const db = seeded(5);
            const ids: unknown[] = [];
            for (const row of db.prepare('SELECT id FROM t WHERE id > ? ORDER BY id').iterate(3)) {
                ids.push((row as Record<string, unknown>).id);
            }
            expect(ids).toStrictEqual([4, 5]);
            db.close();
        });

        await it('yields nothing for a statement that matches no rows', async () => {
            const db = seeded();
            expect([...db.prepare('SELECT id FROM t WHERE id > 100').iterate()]).toStrictEqual([]);
            db.close();
        });

        await it('steps lazily rather than reading the rows up front', async () => {
            // The second row must not exist yet when the iterator is created, and must be
            // read anyway — an implementation that collects the rows at iterate() time
            // sees only the first.
            const db = seeded(1);
            const iterator = db.prepare('SELECT id FROM t ORDER BY id').iterate();
            const first = iterator.next();
            expect((first.value as Record<string, unknown>).id).toBe(1);

            db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(2, 'row 2');
            const second = iterator.next();
            expect(second.done).toBe(false);
            expect((second.value as Record<string, unknown>).id).toBe(2);
            db.close();
        });

        await it('reports done once exhausted and stays done', async () => {
            const db = seeded(1);
            const iterator = db.prepare('SELECT id FROM t').iterate();
            expect(iterator.next().done).toBe(false);

            const end = iterator.next();
            expect(end.done).toBe(true);
            expect(end.value).toBeNull();

            const again = iterator.next();
            expect(again.done).toBe(true);
            expect(again.value).toBeNull();
            db.close();
        });

        await it('leaves the statement reusable after the rows run out', async () => {
            const db = seeded();
            const select = db.prepare('SELECT id FROM t ORDER BY id');
            expect([...select.iterate()].length).toBe(3);
            // Both of these need the statement reset: a cursor left open answers neither.
            expect(select.all().length).toBe(3);
            expect([...select.iterate()].length).toBe(3);
            db.close();
        });

        await it('resets the statement when the consumer breaks out early', async () => {
            const db = seeded(10);
            const select = db.prepare('SELECT id FROM t ORDER BY id');
            for (const row of select.iterate()) {
                if ((row as Record<string, unknown>).id === 2) break;
            }
            // The break reached the iterator's return(); without the reset the statement
            // is still mid-cursor and this read starts where that one stopped.
            expect((select.all() as Record<string, unknown>[]).map((r) => r.id)).toStrictEqual([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            ]);
            db.close();
        });

        await it('reports done after an explicit return()', async () => {
            const db = seeded();
            const iterator = db.prepare('SELECT id FROM t ORDER BY id').iterate();
            expect(iterator.next().done).toBe(false);

            const closed = iterator.return?.();
            expect(closed?.done).toBe(true);
            expect(closed?.value).toBeNull();
            expect(iterator.next().done).toBe(true);
            db.close();
        });

        await it('releases the write lock the iteration held', async () => {
            // A statement left mid-cursor keeps a read transaction open, which a write on
            // the same connection then fails. Exhausting the iterator has to clear it.
            const db = seeded();
            for (const _row of db.prepare('SELECT id FROM t ORDER BY id').iterate()) {
                // read all of them
            }
            db.exec('DROP TABLE t');
            db.close();
        });
    });

    await describe('iterate() honours the statement settings', async () => {
        await it('yields BigInts with setReadBigInts(true)', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER)');
            db.prepare('INSERT INTO t (id, big) VALUES (?, ?)').run(1, 2n ** 62n);

            const select = db.prepare('SELECT big FROM t');
            select.setReadBigInts(true);
            const rows = [...select.iterate()] as Record<string, unknown>[];
            expect(rows.length).toBe(1);
            expect(rows[0].big).toBe(2n ** 62n);
            db.close();
        });

        await it('yields arrays with setReturnArrays(true)', async () => {
            const db = seeded(2);
            const select = db.prepare('SELECT id, v FROM t ORDER BY id');
            select.setReturnArrays(true);
            const rows = [...select.iterate()] as unknown as unknown[][];
            expect(rows.length).toBe(2);
            expect(rows[0]).toStrictEqual([1, 'row 1']);
            expect(rows[1]).toStrictEqual([2, 'row 2']);
            db.close();
        });
    });

    rmSync(testDir, { recursive: true, force: true });
};
