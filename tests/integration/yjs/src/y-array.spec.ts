// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/y-array.tests.js (testBasicUpdate, testSlice,
// testArrayFrom, testLengthIssue, testDeleteInsert, testInsertAndDeleteEvents,
// testIteratingArrayContainingTypes). Multi-user TestConnector cases are
// reduced to single-doc + applyUpdate round-trips.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.Array — ordered list type', async () => {
        await it('basic insert + applyUpdate round-trips a single string', async () => {
            const doc1 = new Y.Doc();
            const doc2 = new Y.Doc();
            doc1.getArray('array').insert(0, ['hi']);
            const update = Y.encodeStateAsUpdate(doc1);
            Y.applyUpdate(doc2, update);
            expect(doc2.getArray('array').toArray()).toStrictEqual(['hi']);
        });

        await it('slice() returns the requested range, including negative indices', async () => {
            const doc1 = new Y.Doc();
            const arr = doc1.getArray<number>('array');
            arr.insert(0, [1, 2, 3]);
            expect(arr.slice(0)).toStrictEqual([1, 2, 3]);
            expect(arr.slice(1)).toStrictEqual([2, 3]);
            expect(arr.slice(0, -1)).toStrictEqual([1, 2]);
            arr.insert(0, [0]);
            expect(arr.slice(0)).toStrictEqual([0, 1, 2, 3]);
            expect(arr.slice(0, 2)).toStrictEqual([0, 1]);
        });

        await it('Y.Array.from() seeds a nested array and reads back via map', async () => {
            const doc1 = new Y.Doc();
            const root = doc1.getMap('root');
            const nestedArray = Y.Array.from([0, 1, 2]);
            root.set('array', nestedArray);
            expect(nestedArray.toArray()).toStrictEqual([0, 1, 2]);
        });

        await it('push + delete keep length consistent (regression for yjs#297 search-marker)', async () => {
            const doc1 = new Y.Doc();
            const arr = doc1.getArray<number>('array');
            arr.push([0, 1, 2, 3]);
            arr.delete(0);
            expect(arr.length).toBe(3);
            expect(arr.toArray()).toStrictEqual([1, 2, 3]);
        });

        await it('delete(idx, 0) is a no-op; out-of-range delete throws', async () => {
            const doc = new Y.Doc();
            const arr = doc.getArray<string>('array');
            // Zero-length delete at position 0 on an empty array.
            arr.delete(0, 0);
            // Out-of-range delete on an empty array throws.
            expect(() => arr.delete(1, 1)).toThrow();
            arr.insert(0, ['A']);
            // Zero-length delete at the array's tail boundary.
            arr.delete(1, 0);
            expect(arr.toArray()).toStrictEqual(['A']);
        });

        await it('observe() fires on every insert + delete (testInsertAndDeleteEvents)', async () => {
            const doc = new Y.Doc();
            const arr = doc.getArray<number>('array');
            let event: any = null;
            arr.observe((e) => {
                event = e;
            });
            arr.insert(0, [0, 1, 2]);
            expect(event).not.toBe(null);
            event = null;
            arr.delete(0);
            expect(event).not.toBe(null);
            event = null;
            arr.delete(0, 2);
            expect(event).not.toBe(null);
        });

        await it('iterates contained Y types via Symbol.iterator', async () => {
            // testIteratingArrayContainingTypes (simplified): the array
            // exposes a working `Symbol.iterator` that walks all items in
            // order. SpiderMonkey 140 ships Symbol.iterator natively;
            // this guards against accidental breakage in the GJS path.
            const doc = new Y.Doc();
            const arr = doc.getArray<Y.Map<unknown>>('array');
            for (let i = 0; i < 4; i++) {
                const m = new Y.Map();
                m.set('i', i);
                arr.push([m]);
            }
            const collected: number[] = [];
            for (const m of arr) {
                collected.push(m.get('i') as number);
            }
            expect(collected).toStrictEqual([0, 1, 2, 3]);
            // And the materialized toArray() agrees.
            const viaToArray = arr.toArray().map((m) => m.get('i') as number);
            expect(viaToArray).toStrictEqual([0, 1, 2, 3]);
        });

        await it('toJSON() returns deeply unwrapped primitives', async () => {
            const doc = new Y.Doc();
            const arr = doc.getArray<unknown>('array');
            arr.insert(0, [1, true, false, 'x', null]);
            expect(arr.toJSON()).toStrictEqual([1, true, false, 'x', null]);
        });

        await it('insert + applyUpdate carries nested primitive values', async () => {
            const doc1 = new Y.Doc();
            doc1.getArray('a').insert(0, [1, true, 'x', { k: 'v' }]);
            const update = Y.encodeStateAsUpdate(doc1);
            const doc2 = new Y.Doc();
            Y.applyUpdate(doc2, update);
            expect(doc2.getArray('a').toJSON()).toStrictEqual([1, true, 'x', { k: 'v' }]);
        });
    });
};
