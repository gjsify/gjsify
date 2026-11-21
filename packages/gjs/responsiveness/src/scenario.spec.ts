import { describe, expect, it } from '@gjsify/unit';
import { monotonicMs } from '@gjsify/utils/main-loop';
import { measureScenario, median, percentile, thresholdFromNoise } from './index.js';
import { scenario } from './scenario-test.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async () => {
    await describe('scenario helpers', async () => {
        await it('should take the median, even and odd', async () => {
            expect(median([5, 1, 3])).toBe(3);
            expect(median([4, 1, 3, 2])).toBe(2.5);
            expect(median([])).toBe(0);
        });

        await it('should calibrate to at least 50 ms and 3 x p99 noise', async () => {
            expect(thresholdFromNoise([0.1, 0.2, 0.3])).toBe(50);
            expect(thresholdFromNoise([5, 10, 40])).toBe(120);
            expect(percentile([1, 2, 3, 4], 50)).toBe(2);
        });
    });

    await describe('measureScenario', async () => {
        await it('should measure a yielding action without stalls', async () => {
            const result = await measureScenario('yields', { budgetMs: 100, runs: 3 }, () => sleep(20));
            expect(result.runsMs.length).toBe(3);
            expect(result.medianMs >= 15).toBe(true);
            expect(result.stalls).toBe(0);
            expect(result.thresholdMs >= 50).toBe(true);
        });

        await it('should report a synchronous block as a stall named by its span', async () => {
            const { mark } = await import('./index.js');
            const result = await measureScenario('blocks', { budgetMs: 1000, runs: 2, warmup: 0 }, async () => {
                const handle = mark('block');
                const end = monotonicMs() + Math.max(200, 0);
                while (monotonicMs() < end) {
                    /* hold the thread */
                }
                handle.end();
            });
            expect(result.stalls > 0).toBe(true);
            expect(result.bySpan.block > 0).toBe(true);
        });

        await it('should discard warmup runs', async () => {
            let calls = 0;
            const result = await measureScenario('warm', { budgetMs: 100, runs: 2, warmup: 2 }, () => {
                calls += 1;
            });
            expect(calls).toBe(4);
            expect(result.runsMs.length).toBe(2);
        });
    });

    await describe('scenario', async () => {
        await scenario('an action inside its budget', { budgetMs: 200, runs: 3 }, () => sleep(10));
    });
};
