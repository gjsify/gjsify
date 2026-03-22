import { describe, it, expect } from '@gjsify/unit';
import { performance, monitorEventLoopDelay } from 'perf_hooks';

export default async () => {
  await describe('perf_hooks', async () => {
    await describe('performance', async () => {
      await it('should have performance.now()', async () => {
        const now = performance.now();
        expect(typeof now).toBe('number');
        expect(now).toBeGreaterThan(0);
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
        expect(histogram.min).toBe(0);
        expect(histogram.max).toBe(0);
      });
    });
  });
};
