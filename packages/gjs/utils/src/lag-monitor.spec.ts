// startLagMonitor on both runtimes. The busy-block fixture is the ADR 0149 measurement:
// a 120 ms synchronous slice inside one tick makes the next tick ~110 ms late
// (block − interval), and an idle loop stays within a few ms.

import { describe, expect, it, on } from '@gjsify/unit';
import { monotonicMs, startLagMonitor } from './main-loop.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function busyWait(ms: number): void {
    const end = monotonicMs() + ms;
    while (monotonicMs() < end) {
        /* hold the thread: that is the fixture */
    }
}

export default async () => {
    await describe('startLagMonitor', async () => {
        await it('should keep an idle loop within a few ms', async () => {
            // Shared CI runners (macOS above all) coalesce timers by tens of ms, so the bound
            // is the stall threshold, not the few ms a quiet desktop shows.
            const monitor = startLagMonitor({ intervalMs: 10, thresholdMs: 250 });
            await sleep(200);
            monitor.stop();
            expect(monitor.ticks > 5).toBe(true);
            expect(monitor.stalls).toBe(0);
            expect(monitor.maxMs < 250).toBe(true);
        });

        await it('should report a busy block as interval-subtracted lateness', async () => {
            const stalled: number[] = [];
            const monitor = startLagMonitor({ intervalMs: 10, thresholdMs: 80, onStall: (ms) => stalled.push(ms) });
            await sleep(40);
            await new Promise<void>((resolve) =>
                setTimeout(() => {
                    busyWait(120);
                    resolve();
                }, 0),
            );
            await sleep(60);
            monitor.stop();
            // Runner jitter may add a stall of its own; the block must still show up as one
            // ~110 ms lateness and be the worst sample.
            expect(monitor.stalls).toBe(stalled.length);
            const worst = Math.max(...stalled);
            expect(stalled.length >= 1).toBe(true);
            expect(worst > 90).toBe(true);
            expect(worst < 250).toBe(true);
            expect(monitor.maxMs).toBe(worst);
        });

        await it('should deliver every tick to onSample and keep them in order', async () => {
            const seen: number[] = [];
            const monitor = startLagMonitor({ intervalMs: 5, onSample: (ms) => seen.push(ms), maxSamples: 4 });
            await sleep(100);
            monitor.stop();
            expect(monitor.ticks).toBe(seen.length);
            expect(monitor.samples().length).toBe(Math.min(4, seen.length));
            expect(monitor.samples()).toStrictEqual(seen.slice(-4));
        });

        await it('should stop ticking after stop(), and stop() is idempotent', async () => {
            const monitor = startLagMonitor({ intervalMs: 5 });
            await sleep(40);
            monitor.stop();
            monitor.stop();
            const after = monitor.ticks;
            await sleep(60);
            expect(monitor.ticks).toBe(after);
        });
    });

    await on('Gjs', async () => {
        await describe('startLagMonitor under GJS', async () => {
            await it('should read the same monotonic clock the source uses', async () => {
                const a = monotonicMs();
                busyWait(5);
                expect(monotonicMs() - a >= 5).toBe(true);
            });
        });
    });
};
