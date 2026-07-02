// Unit tests for the shared npm 2FA/OTP helper (`utils/npm-otp.ts`) — the
// cache-first, refresh-on-reject retry logic that `gjsify publish` / `trust` /
// `onboard` share so one OTP can serve a whole sweep.

import { describe, expect, it } from '@gjsify/unit';
import { OtpProvider, withOtpRetry, isOtpChallenge } from './npm-otp.js';

/** An OTP challenge (401 + www-authenticate: OTP). */
function challenge(): Response {
    return new Response(JSON.stringify({ error: 'OTP required' }), {
        status: 401,
        headers: { 'www-authenticate': 'OTP' },
    });
}

/** A success response. */
function ok(): Response {
    return new Response('{"ok":true}', { status: 200 });
}

/**
 * A fake registry: any request WITHOUT the correct code is challenged; the
 * correct code succeeds. Records the OTP passed on every attempt.
 */
function fakeRegistry(good: string): { doFetch: (otp?: string) => Promise<Response>; codes: (string | undefined)[] } {
    const codes: (string | undefined)[] = [];
    return {
        codes,
        doFetch: async (otp?: string) => {
            codes.push(otp);
            return otp === good ? ok() : challenge();
        },
    };
}

/** A promptFn that hands out queued codes and counts how many times it was called. */
function scriptedPrompt(codes: string[]): { fn: (q: string) => Promise<string>; count: () => number } {
    let i = 0;
    let calls = 0;
    return {
        count: () => calls,
        fn: async () => {
            calls++;
            return codes[i++] ?? '';
        },
    };
}

export default async () => {
    await describe('isOtpChallenge', async () => {
        await it('is true for 401 + www-authenticate: otp', async () => {
            expect(await isOtpChallenge(challenge())).toBeTruthy();
        });
        await it('is false for a 200', async () => {
            expect(await isOtpChallenge(ok())).toBeFalsy();
        });
        await it('is true for a 401 body mentioning a one-time password (no header)', async () => {
            const res = new Response('you need a one-time password', { status: 401 });
            expect(await isOtpChallenge(res)).toBeTruthy();
        });
        await it('is false for a 401 that is not an OTP challenge', async () => {
            const res = new Response('bad credentials', { status: 401 });
            expect(await isOtpChallenge(res)).toBeFalsy();
        });
    });

    await describe('OtpProvider', async () => {
        await it('exposes the seeded code via current()', async () => {
            const p = new OtpProvider('111111');
            expect(p.current()).toBe('111111');
        });
        await it('treats an empty seed as no code', async () => {
            const p = new OtpProvider('');
            expect(p.current()).toBe(undefined);
        });
        await it('refresh() caches the prompted code', async () => {
            const prompt = scriptedPrompt(['222222']);
            const p = new OtpProvider(undefined, prompt.fn);
            const code = await p.refresh();
            expect(code).toBe('222222');
            expect(p.current()).toBe('222222');
        });
    });

    await describe('withOtpRetry — cache-first', async () => {
        await it('uses the cached code on a challenge without prompting', async () => {
            const reg = fakeRegistry('333333');
            const prompt = scriptedPrompt([]);
            const p = new OtpProvider('333333', prompt.fn);
            const res = await withOtpRetry(reg.doFetch, p);
            expect(res.status).toBe(200);
            expect(prompt.count()).toBe(0); // never prompted — cache covered it
            // First attempt without OTP, then the cached code.
            expect(reg.codes).toStrictEqual([undefined, '333333']);
        });

        await it('prompts once when there is no cached code, then caches it', async () => {
            const reg = fakeRegistry('444444');
            const prompt = scriptedPrompt(['444444']);
            const p = new OtpProvider(undefined, prompt.fn);
            const res = await withOtpRetry(reg.doFetch, p);
            expect(res.status).toBe(200);
            expect(prompt.count()).toBe(1);
            expect(p.current()).toBe('444444'); // cached for the next call
        });

        await it('re-prompts when the cached code is rejected/expired', async () => {
            const reg = fakeRegistry('555555');
            const prompt = scriptedPrompt(['555555']);
            const p = new OtpProvider('stale', prompt.fn); // stale seed
            const res = await withOtpRetry(reg.doFetch, p);
            expect(res.status).toBe(200);
            expect(prompt.count()).toBe(1);
            // no-otp → stale → fresh.
            expect(reg.codes).toStrictEqual([undefined, 'stale', '555555']);
        });

        await it('reuses ONE prompt across multiple operations via a shared provider', async () => {
            const good = '666666';
            const prompt = scriptedPrompt([good]);
            const p = new OtpProvider(undefined, prompt.fn);
            // Three independent operations sharing one provider.
            for (let n = 0; n < 3; n++) {
                const reg = fakeRegistry(good);
                const res = await withOtpRetry(reg.doFetch, p);
                expect(res.status).toBe(200);
            }
            expect(prompt.count()).toBe(1); // one prompt for three operations
        });

        await it('seedFirstAttempt sends the cached code on the FIRST request', async () => {
            const reg = fakeRegistry('777777');
            const prompt = scriptedPrompt([]);
            const p = new OtpProvider('777777', prompt.fn);
            const res = await withOtpRetry(reg.doFetch, p, { seedFirstAttempt: true });
            expect(res.status).toBe(200);
            expect(reg.codes).toStrictEqual(['777777']); // no unauth probe first
            expect(prompt.count()).toBe(0);
        });

        await it('surfaces the challenge (no throw) when the user declines to enter a code', async () => {
            const reg = fakeRegistry('888888');
            const prompt = scriptedPrompt([]); // always returns ''
            const p = new OtpProvider(undefined, prompt.fn);
            const res = await withOtpRetry(reg.doFetch, p);
            expect(await isOtpChallenge(res)).toBeTruthy();
        });
    });
};
