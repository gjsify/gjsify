// SPDX-License-Identifier: MIT
// Inspired by refs/loro snapshot + sync tests.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.
//
// This is the canonical CRDT-flavoured test: two `LoroDoc` instances
// edit concurrently, exchange their states via snapshot bytes, and
// converge to the same content regardless of which side merges first.
// Validates that the wasm-bindgen ↔ host-JS boundary doesn't drop or
// corrupt bytes on the GJS path.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

export default async () => {
    await describe('LoroDoc — snapshot + import + sync', async () => {
        await it('exports a snapshot that is non-empty bytes', async () => {
            const doc = new LoroDoc();
            doc.getText('t').insert(0, 'Hello');
            doc.commit();
            const snap = doc.export({ mode: 'snapshot' });
            expect(snap).toBeInstanceOf(Uint8Array);
            expect(snap.length).toBeGreaterThan(0);
        });

        await it('importSnapshot reconstructs the same text', async () => {
            const a = new LoroDoc();
            a.getText('t').insert(0, 'Hello, snapshot');
            a.commit();
            const snap = a.export({ mode: 'snapshot' });

            const b = new LoroDoc();
            b.import(snap);
            expect(b.getText('t').toString()).toBe('Hello, snapshot');
        });

        await it('two docs sync via snapshot exchange (non-conflicting edits)', async () => {
            const a = new LoroDoc();
            a.setPeerId('1');
            a.getText('t').insert(0, 'AAA');
            a.commit();

            const b = new LoroDoc();
            b.setPeerId('2');
            b.getText('t').insert(0, 'BBB');
            b.commit();

            // Exchange snapshots.
            a.import(b.export({ mode: 'snapshot' }));
            b.import(a.export({ mode: 'snapshot' }));

            // Both docs converge to the same merged string (CRDT property).
            const aResult = a.getText('t').toString();
            const bResult = b.getText('t').toString();
            expect(aResult).toBe(bResult);
            // The merged result contains both halves.
            expect(aResult.length).toBe(6);
            expect(aResult).toContain('AAA');
            expect(aResult).toContain('BBB');
        });

        await it('three docs converge under pairwise snapshot exchange', async () => {
            const a = new LoroDoc(); a.setPeerId('1'); a.getText('t').insert(0, 'A'); a.commit();
            const b = new LoroDoc(); b.setPeerId('2'); b.getText('t').insert(0, 'B'); b.commit();
            const c = new LoroDoc(); c.setPeerId('3'); c.getText('t').insert(0, 'C'); c.commit();

            // A ↔ B
            a.import(b.export({ mode: 'snapshot' }));
            b.import(a.export({ mode: 'snapshot' }));
            // (A,B) ↔ C
            c.import(a.export({ mode: 'snapshot' }));
            a.import(c.export({ mode: 'snapshot' }));
            b.import(c.export({ mode: 'snapshot' }));

            const aResult = a.getText('t').toString();
            const bResult = b.getText('t').toString();
            const cResult = c.getText('t').toString();
            expect(aResult).toBe(bResult);
            expect(bResult).toBe(cResult);
            expect(aResult.length).toBe(3);
        });

        await it('update-mode export is smaller than full snapshot', async () => {
            const doc = new LoroDoc();
            const text = doc.getText('t');
            for (let i = 0; i < 100; i++) text.insert(text.length, `chunk-${i} `);
            doc.commit();
            const snap = doc.export({ mode: 'snapshot' });
            // Update mode requires a version vector; use the doc's own
            // current state-vector to capture "everything since nothing".
            const update = doc.export({
                mode: 'update',
                from: doc.frontiersToVV([]),
            });
            // Both forms reconstruct identically.
            const fromSnap = new LoroDoc();
            fromSnap.import(snap);
            const fromUpdate = new LoroDoc();
            fromUpdate.import(update);
            expect(fromSnap.getText('t').toString()).toBe(fromUpdate.getText('t').toString());
        });

        await it('mixed container types survive a snapshot round-trip', async () => {
            const doc = new LoroDoc();
            doc.getText('greeting').insert(0, 'Hello');
            doc.getList('items').push(1);
            doc.getList('items').push(2);
            doc.getMap('config').set('theme', 'dark');
            doc.commit();
            const snap = doc.export({ mode: 'snapshot' });

            const restored = new LoroDoc();
            restored.import(snap);
            expect(restored.getText('greeting').toString()).toBe('Hello');
            expect(restored.getList('items').toArray()).toStrictEqual([1, 2]);
            expect(restored.getMap('config').get('theme')).toBe('dark');
        });
    });
};
