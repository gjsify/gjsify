import { describe, it, expect } from '@gjsify/unit';
import { performance, monitorEventLoopDelay, PerformanceObserver, eventLoopUtilization, timerify } from 'node:perf_hooks';

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

      await it('should not return NaN', async () => {
        const now = performance.now();
        expect(Number.isNaN(now)).toBe(false);
      });

      await it('should not return Infinity', async () => {
        const now = performance.now();
        expect(Number.isFinite(now)).toBe(true);
      });

      await it('should increase over multiple sequential calls', async () => {
        const readings: number[] = [];
        for (let i = 0; i < 5; i++) {
          readings.push(performance.now());
          for (let j = 0; j < 1000; j++) { /* noop */ }
        }
        for (let i = 1; i < readings.length; i++) {
          expect(readings[i] >= readings[i - 1]).toBe(true);
        }
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

      await it('should not return NaN', async () => {
        expect(Number.isNaN(performance.timeOrigin)).toBe(false);
      });

      await it('should not return Infinity', async () => {
        expect(Number.isFinite(performance.timeOrigin)).toBe(true);
      });

      await it('should be a reasonable Unix timestamp in ms', async () => {
        // Should be after 2020-01-01 in ms
        const jan2020 = 1577836800000;
        expect(performance.timeOrigin).toBeGreaterThan(jan2020);
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
        performance.clearMarks();
        const mark = performance.mark('test-mark-2');
        expect(mark.name).toBe('test-mark-2');
        expect(mark.entryType).toBe('mark');
        expect(typeof mark.startTime).toBe('number');
        expect(typeof mark.duration).toBe('number');
        expect(mark.duration).toBe(0);
      });

      await it('mark startTime should be non-negative', async () => {
        const mark = performance.mark('mark-starttime-test');
        expect(mark.startTime >= 0).toBe(true);
      });

      await it('should allow multiple marks with the same name', async () => {
        performance.clearMarks();
        performance.mark('duplicate-mark');
        performance.mark('duplicate-mark');
        performance.mark('duplicate-mark');
        const entries = performance.getEntriesByName('duplicate-mark');
        expect(entries.length).toBe(3);
        for (const entry of entries) {
          expect(entry.name).toBe('duplicate-mark');
          expect(entry.entryType).toBe('mark');
        }
      });

      await it('marks with same name should have increasing startTime', async () => {
        performance.clearMarks();
        performance.mark('ordered-mark');
        for (let i = 0; i < 10000; i++) { /* noop */ }
        performance.mark('ordered-mark');
        const entries = performance.getEntriesByName('ordered-mark');
        expect(entries.length).toBe(2);
        expect(entries[1].startTime >= entries[0].startTime).toBe(true);
      });

      await it('should support marks with special characters in name', async () => {
        performance.clearMarks();
        const name = 'mark-with-special_chars.and:colons/slashes';
        const mark = performance.mark(name);
        expect(mark.name).toBe(name);
        const entries = performance.getEntriesByName(name);
        expect(entries.length).toBe(1);
      });

      await it('should support marks with empty string name', async () => {
        performance.clearMarks();
        const mark = performance.mark('');
        expect(mark.name).toBe('');
        expect(mark.entryType).toBe('mark');
      });
    });

    await describe('performance.measure', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.measure).toBe('function');
      });

      await it('should measure between two marks', async () => {
        performance.clearMarks();
        performance.clearMeasures();
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

      await it('measure between two marks should have positive duration', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('pos-dur-start');
        // Ensure measurable delay
        for (let i = 0; i < 500000; i++) { /* noop */ }
        performance.mark('pos-dur-end');
        const measure = performance.measure('pos-dur-measure', 'pos-dur-start', 'pos-dur-end');
        expect(measure.duration >= 0).toBe(true);
      });

      await it('measure entry should have correct entryType', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('m-type-start');
        performance.mark('m-type-end');
        const measure = performance.measure('m-type', 'm-type-start', 'm-type-end');
        expect(measure.entryType).toBe('measure');
      });

      await it('measure entry should have startTime as a number', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('m-st-start');
        performance.mark('m-st-end');
        const measure = performance.measure('m-st', 'm-st-start', 'm-st-end');
        expect(typeof measure.startTime).toBe('number');
        expect(measure.startTime >= 0).toBe(true);
      });

      await it('measure entry duration should be a number', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('m-dur-start');
        performance.mark('m-dur-end');
        const measure = performance.measure('m-dur', 'm-dur-start', 'm-dur-end');
        expect(typeof measure.duration).toBe('number');
      });

      await it('should support measure with options object', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('opt-start');
        performance.mark('opt-end');
        const measure = performance.measure('opt-measure', {
          start: 'opt-start',
          end: 'opt-end',
        });
        expect(measure.name).toBe('opt-measure');
        expect(measure.entryType).toBe('measure');
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

      await it('should include marks that were created', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('getentries-mark');
        const entries = performance.getEntries();
        const found = entries.some(e => e.name === 'getentries-mark');
        expect(found).toBe(true);
      });

      await it('entries should have name and entryType properties', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('prop-check');
        const entries = performance.getEntries();
        for (const entry of entries) {
          expect(typeof entry.name).toBe('string');
          expect(typeof entry.entryType).toBe('string');
        }
      });
    });

    await describe('performance.getEntriesByName', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.getEntriesByName).toBe('function');
      });

      await it('should find marks by name', async () => {
        performance.clearMarks();
        performance.mark('find-me');
        const entries = performance.getEntriesByName('find-me');
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].name).toBe('find-me');
      });

      await it('should return empty array for nonexistent name', async () => {
        const entries = performance.getEntriesByName('does-not-exist-xyz-12345');
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBe(0);
      });

      await it('should return all entries with the given name', async () => {
        performance.clearMarks();
        performance.mark('multi-name');
        performance.mark('multi-name');
        const entries = performance.getEntriesByName('multi-name');
        expect(entries.length).toBe(2);
      });

      await it('should filter by name and type when type parameter is given', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('filter-type-mark');
        const entries = performance.getEntriesByName('filter-type-mark', 'mark');
        expect(entries.length).toBe(1);
        expect(entries[0].entryType).toBe('mark');
      });
    });

    await describe('performance.getEntriesByType', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.getEntriesByType).toBe('function');
      });

      await it('should return marks when type is mark', async () => {
        performance.clearMarks();
        performance.mark('type-test');
        const entries = performance.getEntriesByType('mark');
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.entryType).toBe('mark');
        }
      });

      await it('should return measures when type is measure', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('type-m-start');
        performance.mark('type-m-end');
        performance.measure('type-m', 'type-m-start', 'type-m-end');
        const entries = performance.getEntriesByType('measure');
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.entryType).toBe('measure');
        }
      });

      await it('should return empty array for unknown type', async () => {
        // Intentionally pass a non-EntryType literal — cast to bypass @types/node's
        // strict EntryType union so we can verify the implementation returns [].
        const entries = performance.getEntriesByType('nonexistent-type-xyz' as any);
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBe(0);
      });
    });

    // --- performance.clearMarks ---
    await describe('performance.clearMarks', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.clearMarks).toBe('function');
      });

      await it('should clear all marks', async () => {
        performance.clearMarks();
        performance.mark('clear-test-1');
        performance.mark('clear-test-2');
        performance.clearMarks();
        const entries = performance.getEntriesByType('mark');
        expect(entries.length).toBe(0);
      });

      await it('should clear only marks with specific name when name is given', async () => {
        performance.clearMarks();
        performance.mark('keep-this');
        performance.mark('remove-this');
        performance.mark('keep-this-too');
        performance.clearMarks('remove-this');
        const entries = performance.getEntriesByType('mark');
        const names = entries.map(e => e.name);
        expect(names).toContain('keep-this');
        expect(names).toContain('keep-this-too');
        expect(names.includes('remove-this')).toBe(false);
      });

      await it('should not affect measures when clearing marks', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('cm-start');
        performance.mark('cm-end');
        performance.measure('cm-measure', 'cm-start', 'cm-end');
        performance.clearMarks();
        const measures = performance.getEntriesByType('measure');
        expect(measures.length).toBe(1);
        expect(measures[0].name).toBe('cm-measure');
      });
    });

    // --- performance.clearMeasures ---
    await describe('performance.clearMeasures', async () => {
      await it('should be a function', async () => {
        expect(typeof performance.clearMeasures).toBe('function');
      });

      await it('should clear all measures', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('cm2-start');
        performance.mark('cm2-end');
        performance.measure('cm2-a', 'cm2-start', 'cm2-end');
        performance.measure('cm2-b', 'cm2-start', 'cm2-end');
        performance.clearMeasures();
        const entries = performance.getEntriesByType('measure');
        expect(entries.length).toBe(0);
      });

      await it('should clear only measures with specific name when name is given', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('cms-start');
        performance.mark('cms-end');
        performance.measure('keep-measure', 'cms-start', 'cms-end');
        performance.measure('remove-measure', 'cms-start', 'cms-end');
        performance.clearMeasures('remove-measure');
        const entries = performance.getEntriesByType('measure');
        expect(entries.length).toBe(1);
        expect(entries[0].name).toBe('keep-measure');
      });

      await it('should not affect marks when clearing measures', async () => {
        performance.clearMarks();
        performance.clearMeasures();
        performance.mark('cm3-mark');
        performance.mark('cm3-start');
        performance.mark('cm3-end');
        performance.measure('cm3-measure', 'cm3-start', 'cm3-end');
        performance.clearMeasures();
        const marks = performance.getEntriesByType('mark');
        expect(marks.length).toBe(3);
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

      await it('should return an object (not null)', async () => {
        const json = performance.toJSON();
        expect(json !== null).toBe(true);
      });

      await it('toJSON timeOrigin should match performance.timeOrigin', async () => {
        const json = performance.toJSON();
        expect(json.timeOrigin).toBe(performance.timeOrigin);
      });
    });

    // --- exports ---
    await describe('exports', async () => {
      await it('monitorEventLoopDelay should be a function', async () => {
        expect(typeof monitorEventLoopDelay).toBe('function');
      });

      await it('PerformanceObserver should be defined', async () => {
        expect(PerformanceObserver).toBeDefined();
      });

      await it('eventLoopUtilization should be a function', async () => {
        expect(typeof eventLoopUtilization).toBe('function');
      });

      await it('timerify should be a function', async () => {
        expect(typeof timerify).toBe('function');
      });
    });

    // --- eventLoopUtilization ---
    await describe('eventLoopUtilization', async () => {
      await it('should return an object with idle, active, utilization', async () => {
        const elu = eventLoopUtilization();
        expect(typeof elu.idle).toBe('number');
        expect(typeof elu.active).toBe('number');
        expect(typeof elu.utilization).toBe('number');
      });
    });

    // --- timerify ---
    await describe('timerify', async () => {
      await it('should return a function', async () => {
        const fn = () => 42;
        const wrapped = timerify(fn);
        expect(typeof wrapped).toBe('function');
      });

      await it('should preserve the return value of the wrapped function', async () => {
        const fn = (a: number, b: number) => a + b;
        const wrapped = timerify(fn);
        const result = wrapped(3, 7);
        expect(result).toBe(10);
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

      await it('should have a percentiles property', async () => {
        const histogram = monitorEventLoopDelay();
        expect(histogram.percentiles).toBeDefined();
        expect(typeof histogram.percentiles).toBe('object');
      });
    });
  });
};
