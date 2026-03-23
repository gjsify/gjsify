import { describe, it, expect } from '@gjsify/unit';
import { performance, monitorEventLoopDelay } from 'perf_hooks';

export default async () => {
  await describe('perf_hooks', async () => {

    // --- performance.now ---
    await describe('performance.now', async () => {
      await it('should return a number', async () => {
        const now = performance.now();
        expect(typeof now).toBe('number');
      });

      await it('should return a non-negative value', async () => {
        const now = performance.now();
        expect(now >= 0).toBe(true);
      });

      await it('should be monotonically increasing', async () => {
        const a = performance.now();
        for (let i = 0; i < 10000; i++) { /* noop */ }
        const b = performance.now();
        expect(b).toBeGreaterThan(a);
      });

      await it('should return sub-millisecond precision', async () => {
        // Successive calls should be different (not rounded to ms)
        const values = new Set<number>();
        for (let i = 0; i < 100; i++) {
          values.add(performance.now());
        }
        // With sub-ms precision, we should get multiple distinct values
        expect(values.size).toBeGreaterThan(1);
      });

      await it('should be less than Date.now()', async () => {
        // performance.now() is relative to timeOrigin, not epoch
        const now = performance.now();
        expect(now).toBeLessThan(Date.now());
      });
    });

    // --- performance.timeOrigin ---
    await describe('performance.timeOrigin', async () => {
      await it('should be a number', async () => {
        expect(typeof performance.timeOrigin).toBe('number');
      });

      await it('should be a positive value', async () => {
        expect(performance.timeOrigin > 0).toBe(true);
      });

      await it('should be close to process start time', async () => {
        // timeOrigin should be a Unix timestamp in milliseconds
        // It should be before the current time
        expect(performance.timeOrigin).toBeLessThan(Date.now());
      });

      await it('timeOrigin + now() should approximate Date.now()', async () => {
        const approx = performance.timeOrigin + performance.now();
        const actual = Date.now();
        // Should be within 100ms
        expect(Math.abs(approx - actual)).toBeLessThan(100);
      });
    });

    // --- performance.mark / measure ---
    await describe('performance.mark', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.mark).toBe('function');
      });

      await it('should not throw when creating a mark', async () => {
        expect(() => performance.mark('test-mark-1')).not.toThrow();
      });

      await it('should return a PerformanceMark', async () => {
        const mark = performance.mark('test-mark-2');
        expect(mark.name).toBe('test-mark-2');
        expect(mark.entryType).toBe('mark');
        expect(typeof mark.startTime).toBe('number');
        expect(typeof mark.duration).toBe('number');
        expect(mark.duration).toBe(0);
      });
    });

    await describe('performance.measure', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.measure).toBe('function');
      });

      await it('should measure between two marks', async () => {
        performance.mark('measure-start');
        // Small delay
        for (let i = 0; i < 100000; i++) { /* noop */ }
        performance.mark('measure-end');
        const measure = performance.measure('test-measure', 'measure-start', 'measure-end');
        expect(measure.name).toBe('test-measure');
        expect(measure.entryType).toBe('measure');
        expect(typeof measure.duration).toBe('number');
        expect(measure.duration >= 0).toBe(true);
      });
    });

    // --- performance.getEntries ---
    await describe('performance.getEntries', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.getEntries).toBe('function');
      });

      await it('should return an array', async () => {
        const entries = performance.getEntries();
        expect(Array.isArray(entries)).toBe(true);
      });
    });

    await describe('performance.getEntriesByName', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.getEntriesByName).toBe('function');
      });

      await it('should find marks by name', async () => {
        performance.mark('find-me');
        const entries = performance.getEntriesByName('find-me');
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].name).toBe('find-me');
      });
    });

    await describe('performance.getEntriesByType', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.getEntriesByType).toBe('function');
      });

      await it('should return marks when type is mark', async () => {
        performance.mark('type-test');
        const entries = performance.getEntriesByType('mark');
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.entryType).toBe('mark');
        }
      });
    });

    // --- performance.clearMarks ---
    await describe('performance.clearMarks', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.clearMarks).toBe('function');
      });

      await it('should clear all marks', async () => {
        performance.mark('clear-test-1');
        performance.mark('clear-test-2');
        performance.clearMarks();
        const entries = performance.getEntriesByType('mark');
        expect(entries.length).toBe(0);
      });
    });

    // --- performance.toJSON ---
    await describe('performance.toJSON', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.toJSON).toBe('function');
      });

      await it('should return an object with timeOrigin', async () => {
        const json = performance.toJSON();
        expect(typeof json).toBe('object');
        expect(typeof json.timeOrigin).toBe('number');
      });
    });

    // --- monitorEventLoopDelay ---
    await describe('monitorEventLoopDelay', async () => {
      await it('should be a function', async () => {
        expect(typeof monitorEventLoopDelay).toBe('function');
      });

      await it('should return a histogram object', async () => {
        const histogram = monitorEventLoopDelay();
        expect(typeof histogram.enable).toBe('function');
        expect(typeof histogram.disable).toBe('function');
        expect(typeof histogram.reset).toBe('function');
        expect(typeof histogram.percentile).toBe('function');
      });

      await it('should have numeric properties', async () => {
        const histogram = monitorEventLoopDelay();
        expect(typeof histogram.min).toBe('number');
        expect(typeof histogram.max).toBe('number');
        expect(typeof histogram.mean).toBe('number');
        expect(typeof histogram.stddev).toBe('number');
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

      await it('should accept options with resolution', async () => {
        const histogram = monitorEventLoopDelay({ resolution: 20 });
        expect(histogram).toBeDefined();
        expect(typeof histogram.enable).toBe('function');
      });
    });
  });
};
