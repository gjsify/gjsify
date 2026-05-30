// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/y-text.tests.js (testBasicInsertAndDelete,
// testBasicFormat, testToJson, testFalsyFormats, testMultilineFormat).
// The upstream `init(tc, { users })` TestConnector is replaced with a
// single `Y.Doc` — these cases assert local-side semantics rather than
// multi-user convergence. Multi-doc sync is exercised by
// `updates-sync.spec.ts` instead.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.Text — collaborative text type', async () => {
        await it('inserts and deletes characters with correct toString()', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('greeting');
            // Delete-zero at position 0 on an empty type is a no-op.
            text.delete(0, 0);
            text.insert(0, 'abc');
            expect(text.toString()).toBe('abc');
            text.delete(0, 1);
            expect(text.toString()).toBe('bc');
            text.delete(1, 1);
            expect(text.toString()).toBe('b');
        });

        await it('emits a delta event with insert/retain/delete ops', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            let delta: any = null;
            text.observe((event) => {
                delta = event.delta;
            });
            text.insert(0, 'abc');
            expect(delta).toStrictEqual([{ insert: 'abc' }]);
            text.delete(0, 1);
            expect(delta).toStrictEqual([{ delete: 1 }]);
            text.delete(1, 1);
            expect(delta).toStrictEqual([{ retain: 1 }, { delete: 1 }]);
        });

        await it('an insert + delete in the same transaction emits an empty delta', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            // Seed the observer with a non-empty delta first so we can
            // distinguish "observer didn't fire" (delta stays seeded)
            // from "observer fired with []" (delta becomes []).
            let delta: any = [{ sentinel: true }];
            text.observe((event) => {
                delta = event.delta;
            });
            doc.transact(() => {
                text.insert(0, '1');
                text.delete(0, 1);
            });
            expect(delta).toStrictEqual([]);
        });

        await it('basic formatting via insert(idx, str, attrs) and format(idx, len, attrs)', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            text.insert(0, 'abc', { bold: true });
            expect(text.toString()).toBe('abc');
            expect(text.toDelta()).toStrictEqual([
                { insert: 'abc', attributes: { bold: true } },
            ]);
            text.delete(0, 1);
            expect(text.toString()).toBe('bc');
            expect(text.toDelta()).toStrictEqual([
                { insert: 'bc', attributes: { bold: true } },
            ]);
            // Mixing a plain insert in front of the formatted run.
            text.insert(0, 'y');
            expect(text.toDelta()).toStrictEqual([
                { insert: 'y' },
                { insert: 'bc', attributes: { bold: true } },
            ]);
            // Removing the bold attribute on a range produces an
            // attributes: { bold: null } retain op.
            text.format(1, 2, { bold: null });
            expect(text.toString()).toBe('ybc');
            expect(text.toDelta()).toStrictEqual([{ insert: 'ybc' }]);
        });

        await it('preserves falsy attribute values (testFalsyFormats)', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            text.insert(0, 'abcde', { falsy: false });
            expect(text.toDelta()).toStrictEqual([
                { insert: 'abcde', attributes: { falsy: false } },
            ]);
        });

        await it('multiline format applies attributes to every newline run', async () => {
            // testMultilineFormat (simplified): formats spanning newlines
            // produce a single delta op per contiguous attribute run.
            const doc = new Y.Doc();
            const text = doc.getText('t');
            text.insert(0, 'Hello\nWorld');
            text.format(0, 11, { bold: true });
            expect(text.toDelta()).toStrictEqual([
                { insert: 'Hello\nWorld', attributes: { bold: true } },
            ]);
        });

        await it('toJSON returns the visible text', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            text.insert(0, 'Hello, world');
            expect(text.toJSON()).toBe('Hello, world');
        });

        await it('supports unicode (multi-byte) inserts at UTF-16 indices', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            text.insert(0, 'Café ☕');
            // Yjs counts in UTF-16 code units, matching JS string semantics.
            expect(text.length).toBe(6);
            expect(text.toString()).toBe('Café ☕');
        });
    });
};
