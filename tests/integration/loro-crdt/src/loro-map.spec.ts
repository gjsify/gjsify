// SPDX-License-Identifier: MIT
// Inspired by refs/loro LoroMap API tests.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroMap — string-keyed CRDT object', async () => {
        await it('sets and reads primitive values', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('age', 30);
            map.set('active', true);
            expect(map.get('name')).toBe('Alice');
            expect(map.get('age')).toBe(30);
            expect(map.get('active')).toBe(true);
        });

        await it('overwrites an existing key', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('name', 'Bob');
            expect(map.get('name')).toBe('Bob');
        });

        await it('delete removes a key', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('age', 30);
            map.delete('age');
            expect(map.get('name')).toBe('Alice');
            expect(map.get('age')).toBe(undefined);
        });

        await it('toJSON returns the current contents as a plain object', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            map.set('tags', ['admin', 'beta']);
            const json = map.toJSON();
            expect(json.name).toBe('Alice');
            expect(json.tags).toStrictEqual(['admin', 'beta']);
        });

        await it('handles nested data (array values, object values)', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('config');
            map.set('limits', { max: 10, min: 0 });
            map.set('flags', ['a', 'b', 'c']);
            const json = map.toJSON();
            expect(json.limits).toStrictEqual({ max: 10, min: 0 });
            expect(json.flags).toStrictEqual(['a', 'b', 'c']);
        });

        await it('survives a commit round-trip', async () => {
            const doc = new LoroDoc();
            const map = doc.getMap('user');
            map.set('name', 'Alice');
            doc.commit();
            map.set('age', 30);
            doc.commit();
            expect(map.toJSON()).toStrictEqual({ name: 'Alice', age: 30 });
        });
    });
};
