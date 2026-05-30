// SPDX-License-Identifier: MIT
// Ported from refs/loro/crates/loro-wasm/tests/counter.test.ts.
// Original: Copyright (c) 2023 Loro authors. MIT.
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted.

import { describe, expect, it } from '@gjsify/unit';
import { LoroDoc } from 'loro-crdt/base64/index.js';

const oneMs = (): Promise<void> => new Promise((r) => setTimeout(r));

export default async () => {
    await describe('LoroCounter — i64 monotonic counter', async () => {
        await it('increment + decrement accumulate', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            counter.increment(1);
            counter.increment(2);
            counter.decrement(1);
            expect(counter.value).toBe(2);
        });

        await it('survives snapshot round-trip (full snapshot)', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            counter.increment(1);
            counter.increment(2);
            counter.decrement(4);

            const snapshot = doc.export({ mode: 'snapshot' });
            const doc2 = new LoroDoc();
            doc2.import(snapshot);
            expect(doc2.toJSON()).toStrictEqual(doc.toJSON());
            expect(doc2.getCounter('counter').value).toBe(-1);
        });

        await it('survives update-mode round-trip', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            counter.increment(1);
            counter.increment(2);
            counter.decrement(4);

            const updates = doc.export({ mode: 'update' });
            const doc2 = new LoroDoc();
            doc2.import(updates);
            expect(doc2.toJSON()).toStrictEqual(doc.toJSON());
            expect(doc2.getCounter('counter').value).toBe(-1);
        });

        await it('survives JSON-updates round-trip', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            counter.increment(1);
            counter.increment(2);
            counter.decrement(4);

            const json = doc.exportJsonUpdates();
            const doc2 = new LoroDoc();
            doc2.importJsonUpdates(json);
            expect(doc2.toJSON()).toStrictEqual(doc.toJSON());
            expect(doc2.getCounter('counter').value).toBe(-1);
        });

        await it('two docs sync via snapshot exchange', async () => {
            const a = new LoroDoc();
            a.setPeerId('1');
            a.getCounter('counter').increment(5);
            a.commit();

            const b = new LoroDoc();
            b.setPeerId('2');
            b.getCounter('counter').decrement(2);
            b.commit();

            // Cross-import snapshots
            const aSnapshot = a.export({ mode: 'snapshot' });
            const bSnapshot = b.export({ mode: 'snapshot' });
            a.import(bSnapshot);
            b.import(aSnapshot);

            // Both should converge to (+5 -2 = +3)
            expect(a.getCounter('counter').value).toBe(3);
            expect(b.getCounter('counter').value).toBe(3);
            expect(a.toJSON()).toStrictEqual(b.toJSON());
        });

        await it('fires a counter event on subscribe', async () => {
            const doc = new LoroDoc();
            let triggered = false;
            let totalIncrement = 0;
            doc.subscribe((e) => {
                triggered = true;
                const diff = e.events[0].diff;
                if (diff.type === 'counter') {
                    totalIncrement = diff.increment;
                }
            });
            const counter = doc.getCounter('counter');
            counter.increment(1);
            counter.increment(2);
            counter.decrement(4);
            doc.commit();
            await oneMs();
            expect(triggered).toBe(true);
            // Net increment: +1 +2 -4 = -1
            expect(totalIncrement).toBe(-1);
        });

        await it('value persists across commits', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            counter.increment(10);
            doc.commit();
            expect(counter.value).toBe(10);
            counter.increment(5);
            doc.commit();
            expect(counter.value).toBe(15);
        });

        await it('starts at zero', async () => {
            const doc = new LoroDoc();
            const counter = doc.getCounter('counter');
            expect(counter.value).toBe(0);
        });
    });
};
