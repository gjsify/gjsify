import { describe, expect, it } from '@gjsify/unit';
import { monotonicMs } from '@gjsify/utils/main-loop';
import {
    armStallWatchdog,
    disarmStallWatchdog,
    getStallCounters,
    isStallWatchdogArmed,
    mark,
    resetStallCounters,
    span,
    type StallRecord,
} from './index.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function busyWait(ms: number): void {
    const end = monotonicMs() + ms;
    while (monotonicMs() < end) {
        /* hold the thread */
    }
}

const blockOnce = (ms: number) =>
    new Promise<void>((resolve) =>
        setTimeout(() => {
            busyWait(ms);
            resolve();
        }, 0),
    );

export default async () => {
    await describe('stall watchdog', async () => {
        await it('should be inert and cost nothing when unarmed', async () => {
            disarmStallWatchdog();
            expect(isStallWatchdogArmed()).toBe(false);
            const a = mark('a');
            expect(mark('b')).toBe(a); // one shared inert handle
            expect(a.end()).toBe(0);
            expect(span('x', () => 7)).toBe(7);
        });

        await it('should name the innermost open span of a stall', async () => {
            const records: StallRecord[] = [];
            armStallWatchdog({ thresholdMs: 50, onStall: (r) => records.push(r) });
            resetStallCounters();
            await sleep(30);
            const outer = mark('outer');
            await blockOnce(0);
            await span('inner', () => blockOnce(120));
            outer.end();
            await sleep(40);
            disarmStallWatchdog();

            const counters = getStallCounters();
            expect(counters.stalls).toBe(1);
            expect(counters.bySpan).toStrictEqual({ inner: 1 });
            expect(counters.worstMs > 90).toBe(true);
            expect(counters.totalMs).toBe(counters.worstMs);
            expect(records[0].span).toBe('inner');
            expect(records[0].depth).toBe(2);
        });

        await it('should say so when no span was open', async () => {
            armStallWatchdog({ thresholdMs: 50 });
            resetStallCounters();
            await sleep(30);
            await blockOnce(100);
            await sleep(40);
            disarmStallWatchdog();
            expect(getStallCounters().bySpan).toStrictEqual({ '(none)': 1 });
        });

        await it('should record a stack at span open only when asked', async () => {
            const records: StallRecord[] = [];
            armStallWatchdog({ thresholdMs: 50, stacks: true, onStall: (r) => records.push(r) });
            await sleep(30);
            const handle = mark('stacked');
            await blockOnce(100);
            handle.end();
            await sleep(40);
            disarmStallWatchdog();
            expect(typeof records[0].stack).toBe('string');
        });

        await it('should close a span once and survive out-of-order ends', async () => {
            armStallWatchdog({ thresholdMs: 50 });
            const a = mark('a');
            const b = mark('b');
            expect(a.end() >= 0).toBe(true);
            expect(a.end()).toBe(0);
            b.end();
            disarmStallWatchdog();
        });

        await it('should close a span when the function throws', async () => {
            armStallWatchdog({ thresholdMs: 50 });
            expect(() =>
                span('boom', () => {
                    throw new Error('x');
                }),
            ).toThrow();
            disarmStallWatchdog();
        });

        await it('should reset counters', async () => {
            armStallWatchdog({ thresholdMs: 50 });
            await sleep(30);
            await blockOnce(100);
            await sleep(40);
            expect(getStallCounters().stalls > 0).toBe(true);
            resetStallCounters();
            expect(getStallCounters()).toStrictEqual({ stalls: 0, worstMs: 0, totalMs: 0, bySpan: {} });
            disarmStallWatchdog();
        });
    });
};
