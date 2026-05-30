// SPDX-License-Identifier: MIT
// Ported from yjs 13.6.31 upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: yjs/tests/undo-redo.tests.js (testEmptyTypeScope, testGlobalScope,
// testDoubleUndo, testUndoMap, testInfiniteCaptureTimeout subset).
// Single-doc UndoManager scenarios — every Yjs editor (TipTap, ProseMirror,
// BlockNote, …) uses UndoManager for the local undo/redo stack.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';

export default async () => {
    await describe('Y.UndoManager — undo/redo stack', async () => {
        await it('undo() on an empty-scope manager rolls back a single op', async () => {
            // testEmptyTypeScope.
            const ydoc = new Y.Doc();
            const um = new Y.UndoManager([], { doc: ydoc });
            const yarray = ydoc.getArray();
            um.addToScope(yarray);
            yarray.insert(0, [1]);
            um.undo();
            expect(yarray.length).toBe(0);
        });

        await it('undo() works when the manager is scoped to the whole doc', async () => {
            // testGlobalScope.
            const ydoc = new Y.Doc();
            const um = new Y.UndoManager(ydoc);
            const yarray = ydoc.getArray();
            yarray.insert(0, [1]);
            um.undo();
            expect(yarray.length).toBe(0);
        });

        await it('two undos rewind two captures (testDoubleUndo)', async () => {
            const doc = new Y.Doc();
            const text = doc.getText();
            text.insert(0, '1221');
            const manager = new Y.UndoManager(text);
            text.insert(2, '3');
            text.insert(3, '3');
            manager.undo();
            manager.undo();
            text.insert(2, '3');
            expect(text.toString()).toBe('12321');
        });

        await it('undo / redo on Y.Map (testUndoMap subset)', async () => {
            const doc = new Y.Doc();
            const map = doc.getMap('m');
            map.set('a', 0);
            const um = new Y.UndoManager(map);
            map.set('a', 1);
            um.undo();
            expect(map.get('a')).toBe(0);
            um.redo();
            expect(map.get('a')).toBe(1);
            // Nested type restore.
            const sub = new Y.Map();
            map.set('a', sub);
            sub.set('x', 42);
            expect(map.toJSON()).toStrictEqual({ a: { x: 42 } });
            um.undo();
            expect(map.get('a')).toBe(1);
            um.redo();
            expect(map.toJSON()).toStrictEqual({ a: { x: 42 } });
        });

        await it('stopCapturing() splits a single user action into discrete undo steps', async () => {
            // testUndoMap second half (simplified).
            const doc = new Y.Doc();
            const map = doc.getMap('m');
            const um = new Y.UndoManager(map);
            map.set('b', 'initial');
            um.stopCapturing();
            map.set('b', 'val1');
            map.set('b', 'val2');
            um.stopCapturing();
            um.undo();
            expect(map.get('b')).toBe('initial');
        });

        await it('undo + redo emit stack-item-added / stack-item-popped events', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            const um = new Y.UndoManager(text);
            let added = 0;
            let popped = 0;
            um.on('stack-item-added', () => {
                added += 1;
            });
            um.on('stack-item-popped', () => {
                popped += 1;
            });
            text.insert(0, 'abc');
            // stack-item-added once for the captured insert.
            expect(added).toBe(1);
            um.undo();
            // stack-item-popped fires for the undo + stack-item-added
            // for the redo entry.
            expect(popped).toBe(1);
            um.redo();
            expect(popped).toBe(2);
        });

        await it('respects trackedOrigins — only ops with a matching origin enter the stack', async () => {
            const doc = new Y.Doc();
            const text = doc.getText('t');
            const um = new Y.UndoManager(text, {
                trackedOrigins: new Set(['user']),
            });
            // 'remote' origin — not tracked.
            doc.transact(() => {
                text.insert(0, 'remote-');
            }, 'remote');
            // 'user' origin — tracked.
            doc.transact(() => {
                text.insert(text.length, 'local');
            }, 'user');
            expect(text.toString()).toBe('remote-local');
            um.undo();
            // Only the 'local' insert is rolled back; the remote part stays.
            expect(text.toString()).toBe('remote-');
        });
    });
};
