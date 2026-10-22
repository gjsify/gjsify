// Scripted-registry rows for the PUT's transient retry (release run 39737673761: a single 503
// on the first PUT stopped the sweep with 0 of 232 packages published).

import { describe, expect, it } from '@gjsify/unit';
import { acceptsRepublish } from './commands/publish.js';
import { fetchWithTransientRetry, MAX_RETRY_DELAY_MS, parseRetryAfter, retryDelayMs } from './utils/transient-retry.js';

function scripted(...steps: Array<number | Error | Response>): { run: () => Promise<Response>; calls: () => number } {
    let i = 0;
    return {
        run: async () => {
            const step = steps[Math.min(i++, steps.length - 1)]!;
            if (step instanceof Error) throw step;
            if (step instanceof Response) return step;
            return new Response('{}', { status: step });
        },
        calls: () => i,
    };
}

function sleeps(): { sleep: (ms: number) => Promise<void>; waited: number[] } {
    const waited: number[] = [];
    return { sleep: async (ms) => void waited.push(ms), waited };
}

export default async () => {
    await describe('parseRetryAfter / retryDelayMs', async () => {
        await it('reads delta-seconds and HTTP dates', async () => {
            expect(parseRetryAfter('7')).toBe(7000);
            expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4000)).toBe(6000);
            expect(parseRetryAfter('soon')).toBeUndefined();
            expect(parseRetryAfter(null)).toBeUndefined();
        });
        await it('doubles the backoff and caps every wait', async () => {
            expect(retryDelayMs(0, 2000)).toBe(2000);
            expect(retryDelayMs(2, 2000)).toBe(8000);
            expect(retryDelayMs(9, 2000)).toBe(MAX_RETRY_DELAY_MS);
            expect(retryDelayMs(0, 2000, '3')).toBe(3000);
            expect(retryDelayMs(0, 2000, '9999')).toBe(MAX_RETRY_DELAY_MS);
        });
    });

    await describe('fetchWithTransientRetry', async () => {
        await it('503 then 201: succeeds after one retry', async () => {
            const s = scripted(503, 201);
            const z = sleeps();
            const { response, retried } = await fetchWithTransientRetry(s.run, { sleep: z.sleep });
            expect(response.status).toBe(201);
            expect(retried).toBe(1);
            expect(z.waited.length).toBe(1);
        });
        await it('503 then 409: hands the conflict back, flagged as retried', async () => {
            const s = scripted(503, 409);
            const { response, retried } = await fetchWithTransientRetry(s.run, { sleep: sleeps().sleep });
            expect(response.status).toBe(409);
            expect(retried).toBe(1);
            expect(acceptsRepublish(409, '', false, retried > 0)).toBe(true);
        });
        await it('honors Retry-After', async () => {
            const s = scripted(new Response('', { status: 429, headers: { 'retry-after': '5' } }), 201);
            const z = sleeps();
            await fetchWithTransientRetry(s.run, { sleep: z.sleep });
            expect(z.waited[0]).toBe(5000);
        });
        await it('retries a network error', async () => {
            const s = scripted(new Error('ECONNRESET'), 201);
            const { response } = await fetchWithTransientRetry(s.run, { sleep: sleeps().sleep });
            expect(response.status).toBe(201);
        });
        await it('exhaustion returns the last 5xx after retries+1 attempts', async () => {
            const s = scripted(503);
            const { response, retried } = await fetchWithTransientRetry(s.run, { retries: 3, sleep: sleeps().sleep });
            expect(response.status).toBe(503);
            expect(retried).toBe(3);
            expect(s.calls()).toBe(4);
        });
        await it('exhaustion on network errors rethrows', async () => {
            const s = scripted(new Error('boom'));
            let thrown = '';
            try {
                await fetchWithTransientRetry(s.run, { retries: 1, sleep: sleeps().sleep });
            } catch (e) {
                thrown = (e as Error).message;
            }
            expect(thrown).toBe('boom');
        });
        await it('does not retry 401 or 404', async () => {
            const s = scripted(401);
            const { retried } = await fetchWithTransientRetry(s.run, { sleep: sleeps().sleep });
            expect(retried).toBe(0);
            expect(s.calls()).toBe(1);
        });
    });

    await describe('acceptsRepublish', async () => {
        await it('a conflict needs --tolerate-republish or an earlier retried PUT', async () => {
            expect(acceptsRepublish(409, '', false, false)).toBe(false);
            expect(acceptsRepublish(409, '', true, false)).toBe(true);
            expect(
                acceptsRepublish(403, 'You cannot publish over the previously published versions', false, true),
            ).toBe(true);
            expect(acceptsRepublish(403, 'forbidden', false, true)).toBe(false);
            expect(acceptsRepublish(201, '', true, true)).toBe(false);
        });
    });
};
