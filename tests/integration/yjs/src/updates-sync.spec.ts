// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/encoding.tests.js + updates.tests.js + snapshot.tests.js
// (testDiffStateVectorOfUpdateIsEmpty, testDiffStateVectorOfUpdateIgnoresSkips,
// testMergeUpdates, testContainsUpdate, testContainsUpdate2). Plus
// canonical Yjs two-doc / three-doc sync via the wire format every Yjs
// transport (y-websocket, y-webrtc, y-indexeddb, …) actually uses:
//   - `Y.encodeStateAsUpdate(doc)` → bytes
//   - `Y.applyUpdate(otherDoc, bytes)` → merge
//   - `Y.encodeStateVector(doc)` + `Y.encodeStateAsUpdate(doc, sv)` → diff
//
// This is the suite that exercises @gjsify/buffer's Uint8Array surface
// hardest: the wire format is dense bit-packed binary, and the Yjs
// encoder uses ArrayBuffer / DataView / TextEncoder/TextDecoder throughout.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Yjs sync wire format — applyUpdate / encodeStateAsUpdate / mergeUpdates', async () => {
        await it('encodeStateAsUpdate produces a non-empty Uint8Array', async () => {
            const doc = new Y.Doc();
            doc.getText('t').insert(0, 'Hello, sync');
            const update = Y.encodeStateAsUpdate(doc);
            expect(update).toBeInstanceOf(Uint8Array);
            expect(update.length).toBeGreaterThan(0);
        });

        await it('applyUpdate reconstructs the same text on a fresh doc', async () => {
            const a = new Y.Doc();
            a.getText('t').insert(0, 'Hello, snapshot');
            const update = Y.encodeStateAsUpdate(a);
            const b = new Y.Doc();
            Y.applyUpdate(b, update);
            expect(b.getText('t').toString()).toBe('Hello, snapshot');
        });

        await it('two docs converge under bidirectional update exchange', async () => {
            const a = new Y.Doc();
            a.getText('t').insert(0, 'AAA');
            const b = new Y.Doc();
            b.getText('t').insert(0, 'BBB');
            // Exchange full updates both ways.
            const updateA = Y.encodeStateAsUpdate(a);
            const updateB = Y.encodeStateAsUpdate(b);
            Y.applyUpdate(b, updateA);
            Y.applyUpdate(a, updateB);
            const ta = a.getText('t').toString();
            const tb = b.getText('t').toString();
            expect(ta).toBe(tb);
            expect(ta.length).toBe(6);
            expect(ta).toContain('AAA');
            expect(ta).toContain('BBB');
        });

        await it('state-vector diff is smaller than a full update', async () => {
            const a = new Y.Doc();
            const text = a.getText('t');
            for (let i = 0; i < 50; i++) {
                text.insert(text.length, `chunk-${i} `);
            }
            const full = Y.encodeStateAsUpdate(a);

            const b = new Y.Doc();
            // b has seen the first batch.
            Y.applyUpdate(b, full);
            const bSv = Y.encodeStateVector(b);

            // a writes a single extra char...
            text.insert(text.length, '!');
            const diff = Y.encodeStateAsUpdate(a, bSv);

            // The diff just for one new char is much smaller than the
            // full update — proves the state-vector path actually works.
            expect(diff.length).toBeLessThan(full.length);
            Y.applyUpdate(b, diff);
            expect(b.getText('t').toString()).toBe(a.getText('t').toString());
        });

        await it('three docs converge under pairwise update exchange', async () => {
            const a = new Y.Doc();
            a.getText('t').insert(0, 'A');
            const b = new Y.Doc();
            b.getText('t').insert(0, 'B');
            const c = new Y.Doc();
            c.getText('t').insert(0, 'C');
            // A ↔ B.
            Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
            Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
            // (A,B) ↔ C.
            Y.applyUpdate(c, Y.encodeStateAsUpdate(a));
            Y.applyUpdate(a, Y.encodeStateAsUpdate(c));
            Y.applyUpdate(b, Y.encodeStateAsUpdate(c));
            const ta = a.getText('t').toString();
            const tb = b.getText('t').toString();
            const tc = c.getText('t').toString();
            expect(ta).toBe(tb);
            expect(tb).toBe(tc);
            expect(ta.length).toBe(3);
        });

        await it('encodeStateVectorFromUpdate of a partial update is byte 0', async () => {
            // testDiffStateVectorOfUpdateIsEmpty.
            const ydoc = new Y.Doc();
            let sv: Uint8Array | null = null;
            ydoc.getText().insert(0, 'a');
            ydoc.on('update', (update) => {
                sv = Y.encodeStateVectorFromUpdate(update);
            });
            // Second insert produces an update with an empty state vector
            // (previous ops are referenced but not included).
            ydoc.getText().insert(0, 'a');
            expect(sv !== null).toBe(true);
            expect((sv as unknown as Uint8Array).byteLength).toBe(1);
            expect((sv as unknown as Uint8Array)[0]).toBe(0);
        });

        await it('mergeUpdates joins discrete updates into one (testMergeUpdates)', async () => {
            const doc = new Y.Doc();
            const updates: Uint8Array[] = [];
            doc.on('update', (u) => updates.push(u));
            doc.getText('t').insert(0, 'a');
            doc.getText('t').insert(1, 'b');
            doc.getText('t').insert(2, 'c');
            expect(updates.length).toBe(3);
            const merged = Y.mergeUpdates(updates);
            const replay = new Y.Doc();
            Y.applyUpdate(replay, merged);
            expect(replay.getText('t').toString()).toBe('abc');
        });

        await it('mixed container types survive a single applyUpdate', async () => {
            const a = new Y.Doc();
            a.getText('greeting').insert(0, 'Hello');
            a.getArray('items').push([1, 2]);
            a.getMap('config').set('theme', 'dark');
            const update = Y.encodeStateAsUpdate(a);

            const b = new Y.Doc();
            Y.applyUpdate(b, update);
            expect(b.getText('greeting').toString()).toBe('Hello');
            expect(b.getArray('items').toArray()).toStrictEqual([1, 2]);
            expect(b.getMap('config').get('theme')).toBe('dark');
        });

        await it('snapshot + snapshotContainsUpdate behave per the Yjs contract', async () => {
            // testContainsUpdate.
            const ydoc = new Y.Doc();
            const updates: Uint8Array[] = [];
            ydoc.on('update', (u) => updates.push(u));
            const yarr = ydoc.getArray();
            const snapshot1 = Y.snapshot(ydoc);
            yarr.insert(0, [1]);
            const snapshot2 = Y.snapshot(ydoc);
            yarr.delete(0, 1);
            const snapshotFinal = Y.snapshot(ydoc);
            expect(Y.snapshotContainsUpdate(snapshot1, updates[0])).toBe(false);
            expect(Y.snapshotContainsUpdate(snapshot2, updates[1])).toBe(false);
            expect(Y.snapshotContainsUpdate(snapshot2, updates[0])).toBe(true);
            expect(Y.snapshotContainsUpdate(snapshotFinal, updates[0])).toBe(true);
            expect(Y.snapshotContainsUpdate(snapshotFinal, updates[1])).toBe(true);
        });
    });
};
