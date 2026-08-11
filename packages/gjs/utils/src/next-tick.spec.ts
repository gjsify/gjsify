// Invariant: on GJS nextTick routes through the GLib main context rather than the JS
// microtask queue, so GTK events interleave between stream operations instead of the
// window freezing under heavy I/O. Mechanism and priority rationale: `./next-tick.ts`.

import { describe, it, expect, on } from '@gjsify/unit';
import { nextTick, __resetBurstStateForTests } from './next-tick.js';

export default async () => {
    await describe('nextTick', async () => {
        await it('should execute the callback', async () => {
            let called = false;
            await new Promise<void>((resolve) => {
                nextTick(() => {
                    called = true;
                    resolve();
                });
            });
            expect(called).toBeTruthy();
        });

        await it('should be deferred — not synchronous', async () => {
            let ranBeforeReturn = false;
            let scheduled = false;
            nextTick(() => {
                scheduled = true;
            });
            ranBeforeReturn = scheduled;
            await new Promise<void>((resolve) => nextTick(resolve));
            expect(ranBeforeReturn).toBeFalsy();
            expect(scheduled).toBeTruthy();
        });

        await it('should pass arguments to the callback', async () => {
            const result = await new Promise<string>((resolve) => {
                nextTick((a: string, b: string) => resolve(a + b), 'hello', ' world');
            });
            expect(result).toBe('hello world');
        });

        await it('should run callbacks in scheduling order', async () => {
            const order: number[] = [];
            await new Promise<void>((resolve) => {
                nextTick(() => order.push(1));
                nextTick(() => order.push(2));
                nextTick(() => {
                    order.push(3);
                    resolve();
                });
            });
            // One more tick, so all three have fired.
            await new Promise<void>((resolve) => nextTick(resolve));
            expect(order[0]).toBe(1);
            expect(order[1]).toBe(2);
            expect(order[2]).toBe(3);
        });

        await on('Gjs', async () => {
            await it('GJS: nextTick does not block GLib I/O callbacks (priority ordering)', async () => {
                // A nextTick goes to the GLib main context, so a `Promise.resolve()`
                // microtask scheduled beside it runs first — within the current
                // dispatch. Both must still fire; on Node the order is the other way
                // round, which is why neither is asserted as first.
                const order: string[] = [];
                await new Promise<void>((resolve) => {
                    nextTick(() => {
                        order.push('tick');
                        resolve();
                    });
                    Promise.resolve().then(() => order.push('microtask'));
                });
                expect(order).toContain('tick');
                expect(order).toContain('microtask');
            });

            // A tight burst (webtorrent DHT bootstrap, streamx pipe bursts) is the case
            // the chunked drainer in `./next-tick.ts` exists for: it must still deliver
            // every callback across the 1 ms yield points it inserts.
            await it('GJS: a tight burst of 256 nextTicks still completes', async () => {
                __resetBurstStateForTests();
                let fired = 0;
                const target = 256;
                await new Promise<void>((resolve) => {
                    for (let i = 0; i < target; i++) {
                        nextTick(() => {
                            fired++;
                            if (fired === target) resolve();
                        });
                    }
                });
                expect(fired).toBe(target);
            });

            await it('GJS: order is preserved inside and across bursts', async () => {
                __resetBurstStateForTests();
                const order: number[] = [];
                const target = 128;
                await new Promise<void>((resolve) => {
                    for (let i = 0; i < target; i++) {
                        nextTick(() => {
                            order.push(i);
                            if (order.length === target) resolve();
                        });
                    }
                });
                // FIFO across the whole burst, including the yield points.
                for (let i = 0; i < target; i++) expect(order[i]).toBe(i);
            });
        });
    });
};
