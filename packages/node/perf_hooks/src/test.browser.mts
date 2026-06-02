// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/perf_hooks.
//
// Uses the browser-native `performance` global + `PerformanceObserver`
// directly. The Node-only surface (`monitorEventLoopDelay`, `timerify`,
// `eventLoopUtilization`, histograms) has no browser pendant and is
// intentionally out of scope — this entry validates the W3C High Resolution
// Time / User Timing surface that our GJS polyfill mirrors.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async PerfHooksTest() {
        await describe('performance.now', async () => {
            await it('returns a finite, non-negative number', async () => {
                const now = performance.now();
                expect(typeof now).toBe('number');
                expect(now >= 0).toBe(true);
                expect(Number.isFinite(now)).toBe(true);
            });

            await it('is monotonically non-decreasing across calls', async () => {
                const readings: number[] = [];
                for (let i = 0; i < 5; i++) {
                    readings.push(performance.now());
                    for (let j = 0; j < 1000; j++) {
                        /* noop */
                    }
                }
                for (let i = 1; i < readings.length; i++) {
                    expect(readings[i] >= readings[i - 1]).toBe(true);
                }
            });
        });

        await describe('performance.timeOrigin', async () => {
            await it('is a positive number', async () => {
                expect(typeof performance.timeOrigin).toBe('number');
                expect(performance.timeOrigin > 0).toBe(true);
                expect(Number.isFinite(performance.timeOrigin)).toBe(true);
            });

            await it('timeOrigin + now() approximates Date.now()', async () => {
                const approx = performance.timeOrigin + performance.now();
                const actual = Date.now();
                expect(Math.abs(approx - actual)).toBeLessThan(1000);
            });
        });

        await describe('performance.mark', async () => {
            await it('is a function and does not throw', async () => {
                expect(typeof performance.mark).toBe('function');
                expect(() => performance.mark('test-mark-1')).not.toThrow();
            });

            await it('returns a PerformanceMark with name / entryType', async () => {
                performance.clearMarks();
                const mark = performance.mark('test-mark-2');
                expect(mark.name).toBe('test-mark-2');
                expect(mark.entryType).toBe('mark');
                expect(typeof mark.startTime).toBe('number');
                expect(mark.duration).toBe(0);
            });

            await it('allows multiple marks with the same name', async () => {
                performance.clearMarks();
                performance.mark('duplicate-mark');
                performance.mark('duplicate-mark');
                const entries = performance.getEntriesByName('duplicate-mark');
                expect(entries.length).toBe(2);
                for (const entry of entries) {
                    expect(entry.entryType).toBe('mark');
                }
            });
        });

        await describe('performance.measure', async () => {
            await it('measures between two marks', async () => {
                performance.clearMarks();
                performance.clearMeasures();
                performance.mark('measure-start');
                performance.mark('measure-end');
                const measure = performance.measure('test-measure', 'measure-start', 'measure-end');
                expect(measure.name).toBe('test-measure');
                expect(measure.entryType).toBe('measure');
                expect(typeof measure.duration).toBe('number');
                expect(measure.duration >= 0).toBe(true);
            });

            await it('supports the options-object form', async () => {
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
            });
        });

        await describe('performance.getEntries*', async () => {
            await it('getEntriesByName finds a mark', async () => {
                performance.clearMarks();
                performance.mark('find-me');
                const entries = performance.getEntriesByName('find-me');
                expect(entries.length).toBeGreaterThan(0);
                expect(entries[0].name).toBe('find-me');
            });

            await it('getEntriesByName returns [] for an unknown name', async () => {
                const entries = performance.getEntriesByName('does-not-exist-xyz-12345');
                expect(Array.isArray(entries)).toBe(true);
                expect(entries.length).toBe(0);
            });

            await it('getEntriesByType returns marks for type "mark"', async () => {
                performance.clearMarks();
                performance.mark('type-test');
                const entries = performance.getEntriesByType('mark');
                expect(entries.length).toBeGreaterThan(0);
                for (const entry of entries) {
                    expect(entry.entryType).toBe('mark');
                }
            });
        });

        await describe('performance.clearMarks / clearMeasures', async () => {
            await it('clearMarks removes all marks', async () => {
                performance.clearMarks();
                performance.mark('clear-test-1');
                performance.mark('clear-test-2');
                performance.clearMarks();
                expect(performance.getEntriesByType('mark').length).toBe(0);
            });

            await it('clearMarks(name) removes only the named mark', async () => {
                performance.clearMarks();
                performance.mark('keep-this');
                performance.mark('remove-this');
                performance.clearMarks('remove-this');
                const names = performance.getEntriesByType('mark').map((e) => e.name);
                expect(names).toContain('keep-this');
                expect(names.includes('remove-this')).toBe(false);
            });

            await it('clearMeasures removes all measures', async () => {
                performance.clearMarks();
                performance.clearMeasures();
                performance.mark('cm2-start');
                performance.mark('cm2-end');
                performance.measure('cm2-a', 'cm2-start', 'cm2-end');
                performance.clearMeasures();
                expect(performance.getEntriesByType('measure').length).toBe(0);
            });
        });

        await describe('PerformanceObserver', async () => {
            await it('is available as a global constructor', async () => {
                expect(typeof PerformanceObserver).toBe('function');
            });
        });
    },
});
