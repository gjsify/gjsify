// SPDX-License-Identifier: MIT
// Ported from refs/loro/crates/loro-wasm/tests/movable_list.test.ts.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroMovableList — list with O(1) move semantics', async () => {
        await it('behaves like a regular list (push/pop)', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            expect(list.length).toBe(0);
            list.push('a');
            expect(list.length).toBe(1);
            expect(list.get(0)).toBe('a');
            const v = list.pop();
            expect(list.length).toBe(0);
            expect(v).toBe('a');
        });

        await it('move(from, to) reorders elements without re-creation', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            expect(list.toArray()).toStrictEqual(['a', 'b', 'c']);
            list.move(0, 1);
            expect(list.toArray()).toStrictEqual(['b', 'a', 'c']);
        });

        await it('set(index, value) replaces element in place', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            list.set(1, 'd');
            expect(list.toArray()).toStrictEqual(['a', 'd', 'c']);
        });

        await it('sync via snapshot preserves move + set state', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            list.set(2, 'd');
            list.move(0, 1);

            const doc2 = new LoroDoc();
            const list2 = doc2.getMovableList('list');
            expect(list2.length).toBe(0);
            doc2.import(doc.export({ mode: 'update' }));
            expect(list2.length).toBe(3);
            expect(list2.get(0)).toBe('b');
            expect(list2.get(1)).toBe('a');
            expect(list2.get(2)).toBe('d');
        });

        await it('insertContainer creates a sub-container at index', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            const subList = list.insertContainer(1, new LoroList());
            subList.push('d');
            subList.push('e');
            subList.push('f');
            expect(list.toJSON()).toStrictEqual(['a', ['d', 'e', 'f'], 'b', 'c']);
            list.move(1, 0);
            expect(list.toJSON()).toStrictEqual([['d', 'e', 'f'], 'a', 'b', 'c']);
            list.move(0, 3);
            expect(list.toJSON()).toStrictEqual(['a', 'b', 'c', ['d', 'e', 'f']]);
        });

        await it('setContainer replaces a primitive with a sub-container', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.insert(0, 100);
            const text = list.setContainer(0, new LoroText());
            text.insert(0, 'Hello');
            expect(list.toJSON()).toStrictEqual(['Hello']);
        });

        await it('length stays correct under concurrent moves', async () => {
            const docA = new LoroDoc();
            const list = docA.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            const docB = new LoroDoc();
            const listB = docB.getMovableList('list');
            docB.import(docA.export({ mode: 'update' }));
            listB.move(0, 1);
            list.move(0, 1);
            docB.import(docA.export({ mode: 'update' }));
            expect(listB.toJSON()).toStrictEqual(['b', 'a', 'c']);
            expect(listB.length).toBe(3);
        });

        await it('concurrent set: larger peer-id wins', async () => {
            const docA = new LoroDoc();
            docA.setPeerId(0n);
            const listA = docA.getMovableList('list');
            listA.push('a');
            listA.push('b');
            listA.push('c');
            const docB = new LoroDoc();
            docB.setPeerId(1n);
            const listB = docB.getMovableList('list');
            docB.import(docA.export({ mode: 'update' }));
            listA.set(1, 'fromA');
            listB.set(1, 'fromB');
            docB.import(docA.export({ mode: 'update' }));
            docA.import(docB.export({ mode: 'update' }));
            expect(listA.toJSON()).toStrictEqual(['a', 'fromB', 'c']);
            expect(listA.length).toBe(3);
            expect(listB.toJSON()).toStrictEqual(['a', 'fromB', 'c']);
            expect(listB.length).toBe(3);
        });

        await it('subscribe fires on commit with the diff payload', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.push('a');
            list.push('b');
            list.push('c');
            let called = false;
            let calledTimes = 0;
            const unsub = list.subscribe((event) => {
                expect(event.by).toBe('local');
                for (const e of event.events) {
                    expect(e.target).toBe(list.id);
                }
                called = true;
                calledTimes += 1;
            });
            await new Promise((r) => setTimeout(r, 1));
            expect(called).toBeFalsy();
            doc.commit();
            await new Promise((r) => setTimeout(r, 1));
            expect(called).toBeTruthy();
            expect(calledTimes).toBe(1);
            unsub();
            list.push('d');
            doc.commit();
            await new Promise((r) => setTimeout(r, 1));
            expect(calledTimes).toBe(1);
        });

        await it('can be attached as a value of an outer list', async () => {
            const doc = new LoroDoc();
            const inner = doc.getMovableList('inner');
            inner.push('a');
            inner.push('b');
            inner.push('c');
            const outer = doc.getList('outer');
            const attached = outer.insertContainer(0, inner);
            expect(outer.toJSON()).toStrictEqual([['a', 'b', 'c']]);
            attached.move(0, 1);
            expect(outer.toJSON()).toStrictEqual([['b', 'a', 'c']]);
            // change on the detached `inner` should NOT affect the attached copy
            inner.move(0, 2);
            expect(outer.toJSON()).toStrictEqual([['b', 'a', 'c']]);
        });

        await it('supports nested LoroMap container value', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            const map = list.insertContainer(0, new LoroMap());
            map.set('name', 'Alice');
            expect(list.toJSON()).toStrictEqual([{ name: 'Alice' }]);
        });

        await it('insert + delete keep length consistent', async () => {
            const doc = new LoroDoc();
            const list = doc.getMovableList('list');
            list.insert(0, 'a');
            list.insert(1, 'b');
            list.insert(2, 'c');
            expect(list.length).toBe(3);
            list.delete(1, 1);
            expect(list.length).toBe(2);
            expect(list.toArray()).toStrictEqual(['a', 'c']);
        });
    });
};
