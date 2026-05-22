// SPDX-License-Identifier: MIT
// Inspired by refs/loro LoroList API tests.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroList — ordered list of CRDT values', async () => {
        await it('pushes primitive values and reports correct length', async () => {
            const doc = new LoroDoc();
            const list = doc.getList('items');
            list.push('first');
            list.push(42);
            list.push(true);
            list.push(null);
            expect(list.length).toBe(4);
            expect(list.get(0)).toBe('first');
            expect(list.get(1)).toBe(42);
            expect(list.get(2)).toBe(true);
            expect(list.get(3)).toBe(null);
        });

        await it('insert places values at arbitrary positions', async () => {
            const doc = new LoroDoc();
            const list = doc.getList('items');
            list.push('a');
            list.push('c');
            list.insert(1, 'b');
            expect(list.toArray()).toStrictEqual(['a', 'b', 'c']);
        });

        await it('delete removes a range of values', async () => {
            const doc = new LoroDoc();
            const list = doc.getList('items');
            for (const v of ['a', 'b', 'c', 'd', 'e']) list.push(v);
            list.delete(1, 3);
            expect(list.toArray()).toStrictEqual(['a', 'e']);
        });

        await it('toArray returns the current value sequence', async () => {
            const doc = new LoroDoc();
            const list = doc.getList('items');
            list.push(1);
            list.push(2);
            list.push(3);
            expect(list.toArray()).toStrictEqual([1, 2, 3]);
        });

        await it('survives a commit round-trip', async () => {
            const doc = new LoroDoc();
            const list = doc.getList('items');
            list.push('alpha');
            list.push('beta');
            doc.commit();
            list.push('gamma');
            doc.commit();
            expect(list.toArray()).toStrictEqual(['alpha', 'beta', 'gamma']);
        });
    });
};
