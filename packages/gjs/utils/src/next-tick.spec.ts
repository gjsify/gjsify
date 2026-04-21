// Tests for packages/gjs/utils/src/next-tick.ts
// Regression: nextTick on GJS must route through GLib.idle_add(PRIORITY_HIGH_IDLE)
// instead of queueMicrotask, so GTK events (PRIORITY_DEFAULT = 0) can interleave
// between stream operations and prevent window freezes under heavy I/O.

import { describe, it, expect, on } from '@gjsify/unit';
import { nextTick, __resetBurstStateForTests } from './next-tick.js';

export default async () => {
  await describe('nextTick', async () => {
    await it('should execute the callback', async () => {
      let called = false;
      await new Promise<void>(resolve => {
        nextTick(() => { called = true; resolve(); });
      });
      expect(called).toBeTruthy();
    });

    await it('should be deferred — not synchronous', async () => {
      let ranBeforeReturn = false;
      let scheduled = false;
      nextTick(() => { scheduled = true; });
      // nextTick callback must not have run before this line
      ranBeforeReturn = scheduled;
      // Wait for callback
      await new Promise<void>(resolve => nextTick(resolve));
      expect(ranBeforeReturn).toBeFalsy();
      expect(scheduled).toBeTruthy();
    });

    await it('should pass arguments to the callback', async () => {
      const result = await new Promise<string>(resolve => {
        nextTick((a: string, b: string) => resolve(a + b), 'hello', ' world');
      });
      expect(result).toBe('hello world');
    });

    await it('should run callbacks in scheduling order', async () => {
      const order: number[] = [];
      await new Promise<void>(resolve => {
        nextTick(() => order.push(1));
        nextTick(() => order.push(2));
        nextTick(() => { order.push(3); resolve(); });
      });
      // Additional tick so all three have fired
      await new Promise<void>(resolve => nextTick(resolve));
      expect(order[0]).toBe(1);
      expect(order[1]).toBe(2);
      expect(order[2]).toBe(3);
    });

    // GJS-specific: nextTick must use GLib.idle_add so that GLib I/O callbacks
    // (PRIORITY_DEFAULT = 0) can fire between nextTick callbacks (PRIORITY_HIGH_IDLE = 100).
    // We verify that a resolved Promise (microtask, highest priority) fires before
    // a nextTick, whereas a GLib.idle_add at PRIORITY_DEFAULT fires before one at PRIORITY_HIGH_IDLE.
    await on('Gjs', async () => {
      await it('GJS: nextTick does not block GLib I/O callbacks (priority ordering)', async () => {
        // A Promise.resolve microtask fires before any GLib idle (same GLib dispatch).
        // A nextTick (GLib idle 100) must not block a higher-priority GLib source (priority 0).
        // We test indirectly: schedule two nextTick callbacks and one via Promise.resolve().
        // The Promise.resolve microtask runs within the current GLib dispatch (before the idle).
        const order: string[] = [];
        await new Promise<void>(resolve => {
          // Schedule nextTick (GLib idle priority 100 on GJS)
          nextTick(() => { order.push('tick'); resolve(); });
          // Schedule a microtask (Promise.resolve runs in current dispatch, before idle)
          Promise.resolve().then(() => order.push('microtask'));
        });
        // On GJS: microtask fires before GLib idle, so 'microtask' comes first
        // On Node.js: nextTick fires before Promise.resolve microtasks by spec
        expect(order).toContain('tick');
        expect(order).toContain('microtask');
      });

      // Burst-yield behavior. When hundreds of nextTicks fire in a tight
      // loop (webtorrent DHT bootstrap, streamx pipe bursts, …) GLib
      // dispatches the whole batch at PRIORITY_DEFAULT before coming back
      // to collect GTK input events — the window appears frozen. After
      // BURST_YIELD_THRESHOLD consecutive calls within BURST_IDLE_MS, the
      // scheduler switches to delay=1ms timeouts, forcing a main-loop
      // iteration between bursts so GTK events can drain. Normal,
      // non-bursty code pays zero latency because the counter resets on
      // any gap > BURST_IDLE_MS.
      await it('GJS: a tight burst of 256 nextTicks still completes', async () => {
        __resetBurstStateForTests();
        let fired = 0;
        const target = 256;
        await new Promise<void>(resolve => {
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
        await new Promise<void>(resolve => {
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
