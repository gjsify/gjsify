// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/doc.tests.js (testOriginInTransaction,
// testClientIdDuplicateChange, testGetTypeEmptyId, testToJSON,
// testSubdocLoadEdgeCases). Subdoc tests use a single Y.Doc + subdoc
// reference — the upstream multi-user TestConnector is irrelevant for
// asserting that the subdocs event fires with the right add/load arrays.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.Doc — top-level document + transactions + subdocs', async () => {
        await it('toJSON of an empty doc yields {}', async () => {
            const doc = new Y.Doc();
            expect(doc.toJSON()).toStrictEqual({});
        });

        await it('toJSON walks every shared type (array, map, nested map)', async () => {
            const doc = new Y.Doc();
            const arr = doc.getArray('array');
            arr.push(['test1']);
            const map = doc.getMap('map');
            map.set('k1', 'v1');
            const inner = new Y.Map();
            map.set('k2', inner);
            inner.set('m2k1', 'm2v1');
            expect(doc.toJSON()).toStrictEqual({
                array: ['test1'],
                map: { k1: 'v1', k2: { m2k1: 'm2v1' } },
            });
        });

        await it('transact origin propagates to afterTransaction listeners', async () => {
            const doc = new Y.Doc();
            const ytext = doc.getText();
            const origins: unknown[] = [];
            doc.on('afterTransaction', (tr) => {
                origins.push(tr.origin);
            });
            doc.transact(() => {
                ytext.insert(0, 'hi');
            }, 'first');
            doc.transact(() => {
                ytext.insert(0, 'a');
            }, 'second');
            expect(origins).toStrictEqual(['first', 'second']);
        });

        await it('transactions coalesce multiple ops into a single update event', async () => {
            const doc = new Y.Doc();
            const ytext = doc.getText('t');
            let updateCount = 0;
            doc.on('update', () => {
                updateCount += 1;
            });
            doc.transact(() => {
                ytext.insert(0, 'a');
                ytext.insert(1, 'b');
                ytext.insert(2, 'c');
            });
            expect(updateCount).toBe(1);
            expect(ytext.toString()).toBe('abc');
        });

        await it('clientID is auto-rerolled on duplicate-id apply (testClientIdDuplicateChange)', async () => {
            const doc1 = new Y.Doc();
            doc1.clientID = 0;
            const doc2 = new Y.Doc();
            doc2.clientID = 0;
            expect(doc2.clientID).toBe(doc1.clientID);
            doc1.getArray('a').insert(0, [1, 2]);
            Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
            // Yjs detects the clientID collision on apply and assigns a new one.
            expect(doc2.clientID).not.toBe(doc1.clientID);
        });

        await it('empty-id getText() aliases the default text type (testGetTypeEmptyId)', async () => {
            const doc1 = new Y.Doc();
            doc1.getText('').insert(0, 'h');
            doc1.getText().insert(1, 'i');
            const doc2 = new Y.Doc();
            Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
            expect(doc2.getText().toString()).toBe('hi');
            expect(doc2.getText('').toString()).toBe('hi');
        });

        await it('subdocs fire add + load events on insert into a Y.Array', async () => {
            // testSubdocLoadEdgeCases (subset).
            const doc = new Y.Doc();
            const arr = doc.getArray<Y.Doc>();
            const sub = new Y.Doc();
            let lastEvent: any = null;
            doc.on('subdocs', (ev) => {
                lastEvent = ev;
            });
            arr.insert(0, [sub]);
            expect(sub.shouldLoad).toBe(true);
            expect(sub.autoLoad).toBe(false);
            expect(lastEvent !== null).toBe(true);
            expect(lastEvent.loaded.has(sub)).toBe(true);
            expect(lastEvent.added.has(sub)).toBe(true);
        });

        await it('getSubdocs() / getSubdocGuids() enumerate every attached subdoc', async () => {
            const doc = new Y.Doc();
            const mp = doc.getMap<Y.Doc>('mysubdocs');
            const a = new Y.Doc({ guid: 'a' });
            a.load();
            mp.set('a', a);
            const c = new Y.Doc({ guid: 'c' });
            c.load();
            mp.set('c', c);
            expect([...doc.getSubdocGuids()].sort()).toStrictEqual(['a', 'c']);
            expect([...doc.getSubdocs()].length).toBe(2);
        });
    });
};
