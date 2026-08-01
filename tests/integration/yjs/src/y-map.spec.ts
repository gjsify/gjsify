// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/y-map.tests.js (testIterators, testBasicMapTests,
// testGetAndSetOfMapProperty, testYmapSetsYmap, testYmapSetsYarray,
// testSizeAndDeleteOfMapProperty, testSetAndClearOfMapProperties).
// Single-doc + applyUpdate round-trips replace the upstream init().

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.Map — string-keyed CRDT object', async () => {
        await it('basic set + get over primitive values', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('age', 30);
            map.set('active', true);
            map.set('tag', null);
            expect(map.get('name')).toBe('Alice');
            expect(map.get('age')).toBe(30);
            expect(map.get('active')).toBe(true);
            expect(map.get('tag')).toBe(null);
        });

        await it('set() overwrites an existing key', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('name', 'Bob');
            expect(map.get('name')).toBe('Bob');
            expect(map.size).toBe(1);
        });

        await it('size + delete + has reflect the current key set', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('user');
            map.set('a', 1);
            map.set('b', 2);
            map.set('c', 3);
            expect(map.size).toBe(3);
            expect(map.has('b')).toBe(true);
            map.delete('b');
            expect(map.size).toBe(2);
            expect(map.has('b')).toBe(false);
            expect(map.get('b')).toBe(undefined);
        });

        await it('clear() removes every key', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('user');
            map.set('a', 1);
            map.set('b', 2);
            map.clear();
            expect(map.size).toBe(0);
            expect(map.has('a')).toBe(false);
            expect(map.toJSON()).toStrictEqual({});
        });

        await it('keys() / values() / entries() iterate the current state', async () => {
            // testIterators (simplified). Yjs's iterators don't promise
            // a sort order; we collect into Sets / sorted arrays for the
            // assertion.
            const doc = new Y.Doc();
            const map = doc.getMap<number>('m');
            map.set('a', 1);
            map.set('b', 2);
            map.set('c', 3);
            const keys = [...map.keys()].sort();
            const values = [...map.values()].sort((a, b) => a - b);
            const entries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
            expect(keys).toStrictEqual(['a', 'b', 'c']);
            expect(values).toStrictEqual([1, 2, 3]);
            expect(entries).toStrictEqual([
                ['a', 1],
                ['b', 2],
                ['c', 3],
            ]);
        });

        await it('nested Y.Map → recursive toJSON()', async () => {
            // testYmapSetsYmap (simplified).
            const doc = new Y.Doc();
            const outer = doc.getMap('outer');
            const inner = new Y.Map<number>();
            outer.set('child', inner);
            inner.set('x', 1);
            inner.set('y', 2);
            expect(outer.toJSON()).toStrictEqual({ child: { x: 1, y: 2 } });
        });

        await it('nested Y.Array inside a map → recursive toJSON()', async () => {
            // testYmapSetsYarray (simplified).
            const doc = new Y.Doc();
            const map = doc.getMap('m');
            const list = new Y.Array<number>();
            map.set('items', list);
            list.push([1, 2, 3]);
            expect(map.toJSON()).toStrictEqual({ items: [1, 2, 3] });
        });

        await it('observe() fires with keysChanged describing add/update/delete', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('m');
            const events: any[] = [];
            map.observe((event) => {
                events.push({
                    changedKeys: [...event.keysChanged].sort(),
                    transactions: Array.from(event.changes.keys).keys ? null : null,
                });
            });
            map.set('a', 1);
            map.set('b', 2);
            map.delete('a');
            expect(events.length).toBe(3);
            expect(events[0].changedKeys).toStrictEqual(['a']);
            expect(events[1].changedKeys).toStrictEqual(['b']);
            expect(events[2].changedKeys).toStrictEqual(['a']);
        });

        await it('round-trips through applyUpdate including nested types', async () => {
            const doc1 = new Y.Doc();
            const map = doc1.getMap('config');
            map.set('name', 'Alice');
            const limits = new Y.Map<number>();
            limits.set('min', 0);
            limits.set('max', 10);
            map.set('limits', limits);
            const flags = new Y.Array<string>();
            flags.push(['a', 'b']);
            map.set('flags', flags);
            const update = Y.encodeStateAsUpdate(doc1);
            const doc2 = new Y.Doc();
            Y.applyUpdate(doc2, update);
            expect(doc2.getMap('config').toJSON()).toStrictEqual({
                name: 'Alice',
                limits: { min: 0, max: 10 },
                flags: ['a', 'b'],
            });
        });
    });
};
