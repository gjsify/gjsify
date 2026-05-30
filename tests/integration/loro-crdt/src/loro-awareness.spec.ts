// SPDX-License-Identifier: MIT
// Ported from refs/loro/crates/loro-wasm/tests/awareness.test.ts.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.
//
// Awareness is the ephemeral-state channel siblings to LoroDoc — used
// for collaborator presence (cursor positions, "X is typing", …) that
// expires automatically and is NOT persisted with the document state.

import { describe, expect, it } from '@gjsify/unit';
import { Awareness, AwarenessWasm } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('AwarenessWasm — raw ephemeral state', async () => {
        await it('setLocalState updates the local record', async () => {
            const awareness = new AwarenessWasm('123', 30_000);
            awareness.setLocalState({ foo: 'bar' });
            expect(awareness.getState('123')).toStrictEqual({ foo: 'bar' });
            expect(awareness.getAllStates()).toStrictEqual({ '123': { foo: 'bar' } });
        });

        await it('sync via encode/apply propagates state to peers', async () => {
            const awareness = new AwarenessWasm('123', 30_000);
            awareness.setLocalState({ foo: 'bar' });

            const awarenessB = new AwarenessWasm('223', 30_000);
            const changed = awarenessB.apply(awareness.encode(['123']));

            expect(changed).toStrictEqual({ added: ['123'], updated: [] });
            expect(awarenessB.getState('123')).toStrictEqual({ foo: 'bar' });
            expect(awarenessB.getAllStates()).toStrictEqual({ '123': { foo: 'bar' } });
        });

        await it('peers not in the sync list are filtered out by encode([peers])', async () => {
            const awareness = new AwarenessWasm('123', 30_000);
            awareness.setLocalState({ foo: 'bar' });

            const awarenessB = new AwarenessWasm('223', 30_000);
            awarenessB.apply(awareness.encode(['123']));
            awarenessB.setLocalState({ new: 'bee' });

            const awarenessC = new AwarenessWasm('323', 30_000);
            // encode(['223']) excludes the '123' state — only '223' should propagate
            const changed = awarenessC.apply(awarenessB.encode(['223']));
            expect(changed).toStrictEqual({ added: ['223'], updated: [] });
            expect(awarenessC.getState('223')).toStrictEqual({ new: 'bee' });
            expect(awarenessC.getAllStates()).toStrictEqual({ '223': { new: 'bee' } });
        });

        await it('removeOutdated drops entries past their timeout', async () => {
            // 5 ms timeout — should expire in the 10 ms sleep below
            const awareness = new AwarenessWasm('123', 5);
            awareness.setLocalState({ foo: 'bar' });
            await new Promise((r) => setTimeout(r, 10));
            const outdated = awareness.removeOutdated();
            expect(outdated).toStrictEqual(['123']);
            expect(awareness.getAllStates()).toStrictEqual({});
        });

        await it('consistency: older encoded bytes do NOT overwrite newer state', async () => {
            const a = new AwarenessWasm('1', 10_000);
            const b = new AwarenessWasm('2', 10_000);
            a.setLocalState(0);
            const oldBytes = a.encode(['1']);
            a.setLocalState(1);
            const newBytes = a.encode(['1']);
            // Apply NEW first, then OLD — OLD must not regress the state to 0
            b.apply(newBytes);
            b.apply(oldBytes);
            expect(a.getState('1')).toBe(1);
            expect(b.getState('1')).toBe(1);
            expect(b.peers()).toStrictEqual(['1']);
            b.setLocalState(2);
            expect(b.peers()).toStrictEqual(['2', '1']);
        });

        await it('encodes/decodes binary (Uint8Array) state values', async () => {
            const a = new AwarenessWasm('1', 10_000);
            const b = new AwarenessWasm('2', 10_000);
            a.setLocalState({
                a: Uint8Array.from([1, 2, 3, 4]),
                b: Uint8Array.from([5, 6, 7, 8]),
            });
            const bytes = a.encodeAll();
            b.apply(bytes);
            expect(b.getState('1')).toStrictEqual({
                a: Uint8Array.from([1, 2, 3, 4]),
                b: Uint8Array.from([5, 6, 7, 8]),
            });
        });
    });

    await describe('Awareness (wrapper) — listener + timeout-driven removal', async () => {
        await it('fires listener for local / remote / timeout origins', async () => {
            const awareness = new Awareness('1', 10);
            let local = 0;
            let remote = 0;
            let timeout = 0;
            const removed: string[] = [];
            awareness.addListener((arg, origin) => {
                if (origin === 'local') local += 1;
                if (origin === 'remote') remote += 1;
                if (origin === 'timeout') {
                    timeout += 1;
                    for (const r of arg.removed) removed.push(r);
                }
            });

            awareness.setLocalState('123');
            const b = new Awareness('2', 10);
            b.setLocalState('223');
            const bytes = b.encode(['2']);
            awareness.apply(bytes);
            expect(awareness.getAllStates()).toStrictEqual({ '1': '123', '2': '223' });

            // Sleep past the 10 ms timeout — listener should fire with origin 'timeout'
            await new Promise((r) => setTimeout(r, 30));
            expect(awareness.getAllStates()).toStrictEqual({});
            // Both states should be reported as removed (order doesn't matter; sort+dedupe to verify)
            const dedup = Array.from(new Set(removed)).sort();
            expect(dedup).toStrictEqual(['1', '2']);
            expect(local).toBeGreaterThanOrEqual(1);
            expect(remote).toBeGreaterThanOrEqual(1);
            expect(timeout).toBeGreaterThanOrEqual(1);
        });
    });
};
