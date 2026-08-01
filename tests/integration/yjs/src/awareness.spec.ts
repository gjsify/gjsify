// SPDX-License-Identifier: MIT
// Ported from y-protocols upstream tests
// Original: Copyright (c) 2014 Kevin Jahns and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Source: y-protocols/src/awareness.test.js (testAwareness).
// Awareness is the Yjs companion protocol that every collaborative
// editor uses for "who's online and where is their cursor". Updates are
// exchanged as the same bit-packed Uint8Array format as document
// updates — so this suite ALSO exercises the encode/decode wire path.

import { describe, expect, it } from '@gjsify/unit';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

export default async () => {
    await describe('y-protocols/awareness — peer presence protocol', async () => {
        await it('setLocalState publishes to remote via encode/apply round-trip', async () => {
            const doc1 = new Y.Doc();
            doc1.clientID = 0;
            const doc2 = new Y.Doc();
            doc2.clientID = 1;
            const aw1 = new Awareness(doc1);
            const aw2 = new Awareness(doc2);
            // Wire aw1 → aw2: every update on aw1 gets encoded + applied to aw2.
            aw1.on(
                'update',
                ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
                    const enc = encodeAwarenessUpdate(aw1, added.concat(updated).concat(removed));
                    applyAwarenessUpdate(aw2, enc, 'custom');
                },
            );
            let lastChangeLocal: any = null;
            aw1.on('change', (change: any) => {
                lastChangeLocal = change;
            });
            let lastChange: any = null;
            aw2.on('change', (change: any) => {
                lastChange = change;
            });
            aw1.setLocalState({ x: 3 });
            expect(aw2.getStates().get(0)).toStrictEqual({ x: 3 });
            // aw2 just observed client 0 for the first time → added.
            expect(lastChange.added).toStrictEqual([0]);
            // aw1 only emits 'updated' for its OWN local state (already present at construction).
            expect(lastChangeLocal).toStrictEqual({
                added: [],
                updated: [0],
                removed: [],
            });

            // Update local state to a different value.
            lastChange = null;
            lastChangeLocal = null;
            aw1.setLocalState({ x: 4 });
            expect(aw2.getStates().get(0)).toStrictEqual({ x: 4 });
            expect(lastChangeLocal).toStrictEqual({
                added: [],
                updated: [0],
                removed: [],
            });
            expect(lastChangeLocal).toStrictEqual(lastChange);

            // Setting the same value emits a meta clock bump but no 'change'.
            lastChange = null;
            lastChangeLocal = null;
            aw1.setLocalState({ x: 4 });
            expect(lastChange).toBe(null);
            expect(lastChangeLocal).toStrictEqual(lastChange);

            // Clearing local state emits 'removed'.
            aw1.setLocalState(null);
            expect(lastChange.removed.length).toBe(1);
            expect(aw1.getStates().get(0)).toBe(undefined);
        });

        await it('removeAwarenessStates explicitly drops a peer', async () => {
            const doc1 = new Y.Doc();
            doc1.clientID = 0;
            const doc2 = new Y.Doc();
            doc2.clientID = 1;
            const aw1 = new Awareness(doc1);
            const aw2 = new Awareness(doc2);
            // Plant a remote state on aw1 representing peer 99.
            aw1.setLocalState({ cursor: { x: 1 } });
            const enc = encodeAwarenessUpdate(aw1, [0]);
            applyAwarenessUpdate(aw2, enc, 'remote');
            expect(aw2.getStates().has(0)).toBe(true);
            // Now explicitly remove client 0 from aw2.
            removeAwarenessStates(aw2, [0], 'remote');
            expect(aw2.getStates().has(0)).toBe(false);
        });

        await it('encode/apply preserves arbitrary state JSON values', async () => {
            const doc1 = new Y.Doc();
            doc1.clientID = 100;
            const doc2 = new Y.Doc();
            doc2.clientID = 200;
            const aw1 = new Awareness(doc1);
            const aw2 = new Awareness(doc2);
            const richState = {
                name: 'Alice',
                cursor: { line: 4, column: 12 },
                color: '#ff8800',
                tags: ['admin', 'beta'],
            };
            aw1.setLocalState(richState);
            const enc = encodeAwarenessUpdate(aw1, [100]);
            applyAwarenessUpdate(aw2, enc, 'remote');
            expect(aw2.getStates().get(100)).toStrictEqual(richState);
        });

        await it('encodeAwarenessUpdate produces a Uint8Array', async () => {
            const doc = new Y.Doc();
            doc.clientID = 7;
            const aw = new Awareness(doc);
            aw.setLocalState({ ping: true });
            const enc = encodeAwarenessUpdate(aw, [7]);
            expect(enc).toBeInstanceOf(Uint8Array);
            expect(enc.length).toBeGreaterThan(0);
        });

        await it('destroy() clears the local state', async () => {
            const doc = new Y.Doc();
            const aw = new Awareness(doc);
            aw.setLocalState({ x: 1 });
            expect(aw.getStates().size).toBe(1);
            aw.destroy();
            expect(aw.getStates().size).toBe(0);
        });
    });
};
