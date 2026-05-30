// Regression tests for per-request timeout + RegistryTimeoutError.
//
// Validates the fix for the `gjsify install` hang root cause: a slow
// (reachable but never-responding) registry CDN previously caused
// fetchPackument/fetchTarball to await indefinitely with no progress.
// The fix gives every fetch a per-request timeout (default 30s, override
// via opts.timeoutMs), treats timeout-from-here as transient (retries),
// and throws a typed RegistryTimeoutError when ALL retries exhaust.

import { describe, it, expect } from '@gjsify/unit';
import { fetchPackument, RegistryTimeoutError } from './index.js';

function makeMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
    return ((url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        return handler(u, init);
    }) as typeof fetch;
}

function fastPackumentResponse(name: string): Response {
    return new Response(JSON.stringify({ name, 'dist-tags': {}, versions: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

/** Resolve after `ms`, but reject early via init.signal if it aborts. */
function delayedResolve<T>(value: T, ms: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signalToError(signal));
            return;
        }
        const id = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
        }, ms);
        const onAbort = () => {
            clearTimeout(id);
            reject(signalToError(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function signalToError(signal: AbortSignal | undefined): Error {
    const reason = signal && 'reason' in signal ? (signal as { reason?: unknown }).reason : undefined;
    if (reason instanceof Error) return reason;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

export default async () => {
    await describe('@gjsify/npm-registry — per-request timeout', async () => {
        await it('completes fast call before timeout (no retry, no error)', async () => {
            let calls = 0;
            const mock = makeMockFetch(async (_url, init) => {
                calls++;
                // 5ms delay — well below our 200ms timeout.
                return await delayedResolve(fastPackumentResponse('lodash'), 5, init?.signal as AbortSignal);
            });
            const p = await fetchPackument('lodash', {
                fetch: mock,
                timeoutMs: 200,
                retries: 0,
            });
            expect(p.name).toBe('lodash');
            expect(calls).toBe(1);
        });

        await it('throws RegistryTimeoutError after all retries exhaust on persistent timeout', async () => {
            let calls = 0;
            const mock = makeMockFetch(async (_url, init) => {
                calls++;
                // Never resolves until the per-request timeout aborts the fetch.
                // Mirrors a registry CDN that opens the TCP connection but
                // never streams the response body.
                return await delayedResolve(fastPackumentResponse('lodash'), 1_000_000, init?.signal as AbortSignal);
            });
            let caught: Error | null = null;
            try {
                await fetchPackument('lodash', {
                    fetch: mock,
                    timeoutMs: 25,
                    retries: 2,
                    retryDelayMs: 1,
                });
            } catch (e) {
                caught = e as Error;
            }
            expect(caught).toBeTruthy();
            expect(caught instanceof RegistryTimeoutError).toBe(true);
            // 1 initial + 2 retries = 3 attempts, each timing out.
            expect(calls).toBe(3);
            // Error mentions the URL, the timeout duration, and the attempt
            // count — the actionable diagnostic the user sees.
            const msg = caught?.message ?? '';
            expect(msg).toContain('timed out');
            expect(msg).toContain('lodash');
            expect(msg).toContain('3 attempt');
        });

        await it('retries timeout then succeeds on a later attempt', async () => {
            let calls = 0;
            const mock = makeMockFetch(async (_url, init) => {
                calls++;
                if (calls === 1) {
                    // First attempt: never returns until aborted by the timeout.
                    return await delayedResolve(
                        fastPackumentResponse('lodash'),
                        1_000_000,
                        init?.signal as AbortSignal,
                    );
                }
                // Second attempt: fast success — CDN recovered.
                return fastPackumentResponse('lodash');
            });
            const p = await fetchPackument('lodash', {
                fetch: mock,
                timeoutMs: 25,
                retries: 3,
                retryDelayMs: 1,
            });
            expect(p.name).toBe('lodash');
            expect(calls).toBe(2);
        });

        await it('timeoutMs: 0 disables the per-request timeout', async () => {
            let calls = 0;
            const mock = makeMockFetch(async () => {
                calls++;
                return fastPackumentResponse('lodash');
            });
            const p = await fetchPackument('lodash', {
                fetch: mock,
                timeoutMs: 0,
                retries: 0,
            });
            expect(p.name).toBe('lodash');
            expect(calls).toBe(1);
        });

        await it('CALLER-aborted signal does NOT count as timeout (no retry, no RegistryTimeoutError)', async () => {
            const ctrl = new AbortController();
            let calls = 0;
            const mock = makeMockFetch(async (_url, init) => {
                calls++;
                return await delayedResolve(fastPackumentResponse('lodash'), 1_000_000, init?.signal as AbortSignal);
            });
            setTimeout(() => ctrl.abort(), 10);
            let caught: Error | null = null;
            try {
                await fetchPackument('lodash', {
                    fetch: mock,
                    signal: ctrl.signal,
                    timeoutMs: 5_000,
                    retries: 3,
                    retryDelayMs: 1,
                });
            } catch (e) {
                caught = e as Error;
            }
            expect(caught).toBeTruthy();
            // Caller-abort must surface as plain AbortError, not RegistryTimeoutError.
            expect(caught instanceof RegistryTimeoutError).toBe(false);
            expect(caught?.name).toBe('AbortError');
            // No retry on caller-abort.
            expect(calls).toBe(1);
        });

        await it('default timeoutMs is 30000ms (sanity — no timeout fires for fast calls)', async () => {
            // Validates we did not regress to a too-short default. Fast call
            // completes well below the 30s default, no retry path entered.
            let calls = 0;
            const mock = makeMockFetch(async () => {
                calls++;
                return fastPackumentResponse('lodash');
            });
            const p = await fetchPackument('lodash', { fetch: mock, retries: 0 });
            expect(p.name).toBe('lodash');
            expect(calls).toBe(1);
        });
    });
};
