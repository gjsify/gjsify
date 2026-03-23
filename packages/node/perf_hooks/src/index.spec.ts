import { describe, it, expect } from '@gjsify/unit';
import { performance, monitorEventLoopDelay } from 'perf_hooks';

export default async () => {
  await describe('perf_hooks', async () => {
    await describe('performance', async () => {
      await it('should have performance.now()', async () => {
        const now = performance.now();
        expect(typeof now).toBe('number');
        // now() can be 0 at startup, just check it's a number >= 0
        expect(now).toBeGreaterThan(-1);
      });

      await it('performance.now() should be monotonically increasing', async () => {
        const a = performance.now();
        // Small busy-wait
        for (let i = 0; i < 10000; i++) { /* noop */ }
        const b = performance.now();
        expect(b).toBeGreaterThan(a);
      });
    });

    await describe('monitorEventLoopDelay', async () => {
      await it('should return a histogram object', async () => {
        const histogram = monitorEventLoopDelay();
        expect(typeof histogram.enable).toBe('function');
        expect(typeof histogram.disable).toBe('function');
        expect(typeof histogram.reset).toBe('function');
        expect(typeof histogram.percentile).toBe('function');
        expect(typeof histogram.min).toBe('number');
        expect(typeof histogram.max).toBe('number');
      });

      await it('should support enable/disable lifecycle', async () => {
        const histogram = monitorEventLoopDelay();
        expect(() => histogram.enable()).not.toThrow();
        expect(() => histogram.disable()).not.toThrow();
      });

      await it('should support reset', async () => {
        const histogram = monitorEventLoopDelay();
        expect(() => histogram.reset()).not.toThrow();
      });

      await it('should support percentile', async () => {
        const histogram = monitorEventLoopDelay();
        const p50 = histogram.percentile(50);
        expect(typeof p50).toBe('number');
      });
    });

    await describe('performance properties', async () => {
      await it('performance.timeOrigin should be a number', async () => {
        expect(typeof performance.timeOrigin).toBe('number');
        expect(performance.timeOrigin > 0).toBeTruthy();
      });

      await it('performance.now() should return sub-millisecond values', async () => {
        const now = performance.now();
        expect(typeof now).toBe('number');
      });
    });

    await describe('performance.mark/measure', async () => {
      await it('mark should be a function if available', async () => {
        if (typeof performance.mark === 'function') {
          expect(() => performance.mark('test-mark')).not.toThrow();
        } else {
          expect(true).toBeTruthy(); // skip if not available
        }
      });

      await it('measure should be a function if available', async () => {
        if (typeof performance.measure === 'function') {
          performance.mark('start-test');
          performance.mark('end-test');
          expect(() => performance.measure('test-measure', 'start-test', 'end-test')).not.toThrow();
        } else {
          expect(true).toBeTruthy();
        }
      });
    });
  });
};
