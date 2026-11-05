import { describe, it, expect } from '@gjsify/unit';

import { probeBackends, type BackendCandidate, type ProbeOptions } from './index.js';

/**
 * An injected clock and timers: a candidate "takes" its time by advancing the clock, and a
 * candidate that hangs is cut off by the fake deadline. No real GPU, no real waiting.
 */
function fakeTime() {
    let clock = 0;
    const timers: { at: number; callback: () => void }[] = [];
    const options: Required<Pick<ProbeOptions, 'now' | 'setTimer' | 'clearTimer' | 'onBattery'>> = {
        now: () => clock,
        setTimer: (callback, ms) => {
            const timer = { at: clock + ms, callback };
            timers.push(timer);
            return timer;
        },
        clearTimer: (handle) => {
            const index = timers.indexOf(handle as (typeof timers)[number]);
            if (index >= 0) timers.splice(index, 1);
        },
        onBattery: () => false,
    };
    /** Advance past every timer that is due; candidates "take" `ms` this way. */
    const advance = (ms: number) => {
        clock += ms;
        for (const timer of [...timers].filter((t) => t.at <= clock)) {
            timers.splice(timers.indexOf(timer), 1);
            timer.callback();
        }
    };
    return { options, advance };
}

const takes = (id: string, ms: number, advance: (ms: number) => void): BackendCandidate => ({
    id,
    run: async () => advance(ms),
});

export default async () => {
    await describe('probeBackends', async () => {
        await it('takes the first candidate within budget and does not try the rest', async () => {
            const time = fakeTime();
            let cpuRan = false;
            const result = await probeBackends(
                [takes('vulkan', 120, time.advance), { id: 'cpu', run: async () => (cpuRan = true) }],
                500,
                time.options,
            );
            expect(result.chosen).toBe('vulkan');
            expect(result.reason).toBe('fits');
            expect(result.attempts).toStrictEqual([{ id: 'vulkan', outcome: 'fits', ms: 120 }]);
            expect(cpuRan).toBe(false);
        });

        await it('moves past a candidate that is too slow and one that throws', async () => {
            const time = fakeTime();
            const result = await probeBackends(
                [
                    takes('vulkan-big', 900, time.advance),
                    { id: 'cuda', run: async () => Promise.reject(new Error('no device')) },
                    takes('cpu', 300, time.advance),
                ],
                500,
                time.options,
            );
            expect(result.chosen).toBe('cpu');
            expect(result.attempts.map((a) => `${a.id}:${a.outcome}`)).toStrictEqual([
                'vulkan-big:too-slow',
                'cuda:failed',
                'cpu:fits',
            ]);
        });

        await it('cuts off a candidate that hangs, and aborts it', async () => {
            const time = fakeTime();
            let aborted = false;
            const hangs: BackendCandidate = {
                id: 'gpu',
                run: (signal) =>
                    new Promise((_, reject) => {
                        signal.addEventListener('abort', () => {
                            aborted = true;
                            reject(new Error('aborted'));
                        });
                        time.advance(600);
                    }),
            };
            const result = await probeBackends([hangs, takes('cpu', 10, time.advance)], 500, time.options);
            expect(aborted).toBe(true);
            expect(result.attempts[0]).toStrictEqual({ id: 'gpu', outcome: 'too-slow', ms: 600 });
            expect(result.chosen).toBe('cpu');
        });

        await it('reports none-fit when nothing does', async () => {
            const time = fakeTime();
            const result = await probeBackends([takes('cpu', 2000, time.advance)], 500, time.options);
            expect(result.chosen).toBe(undefined);
            expect(result.reason).toBe('none-fit');
        });

        await it('lets an explicit setting win without measuring', async () => {
            const time = fakeTime();
            let ran = false;
            const result = await probeBackends(
                [{ id: 'vulkan', run: async () => (ran = true) }, takes('cpu', 1, time.advance)],
                500,
                { ...time.options, setting: 'cpu' },
            );
            expect(result).toStrictEqual({ chosen: 'cpu', reason: 'setting', attempts: [] });
            expect(ran).toBe(false);
        });

        await it('refuses a setting that names no candidate', async () => {
            const time = fakeTime();
            let error: unknown;
            await probeBackends([takes('cpu', 1, time.advance)], 500, { ...time.options, setting: 'cdua' }).catch(
                (err) => (error = err),
            );
            expect(error instanceof RangeError).toBe(true);
        });

        await it('never probes on battery', async () => {
            const time = fakeTime();
            let ran = false;
            const result = await probeBackends([{ id: 'cpu', run: async () => (ran = true) }], 500, {
                ...time.options,
                onBattery: () => true,
            });
            expect(result).toStrictEqual({ chosen: undefined, reason: 'on-battery', attempts: [] });
            expect(ran).toBe(false);
        });
    });
};
