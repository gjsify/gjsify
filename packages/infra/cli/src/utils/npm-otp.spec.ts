// Unit tests for the shared npm 2FA/OTP helper (`utils/npm-otp.ts`) — the
// cache-first, refresh-on-reject retry logic that `gjsify publish` / `trust` /
// `onboard` share so one OTP can serve a whole sweep.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

        await it('invalidates a rejected seeded code, then recovers with a fresh prompt', async () => {
            const reg = fakeRegistry('999999');
            const prompt = scriptedPrompt(['999999']);
            const p = new OtpProvider('wrong', prompt.fn); // stale seed, sent first
            const res = await withOtpRetry(reg.doFetch, p, { seedFirstAttempt: true });
            expect(res.status).toBe(200);
            // seeded 'wrong' rejected → invalidate → prompt 'good'.
            expect(reg.codes).toStrictEqual(['wrong', '999999']);
            expect(p.current()).toBe('999999'); // the good code stays cached
        });
    });

    await describe('OtpProvider — invalidate()', async () => {
        await it('drops the in-process cached code', async () => {
            const p = new OtpProvider('123456');
            expect(p.current()).toBe('123456');
            p.invalidate();
            expect(p.current()).toBe(undefined);
        });
    });

    await describe('OtpProvider — cross-invocation file cache (registry-scoped)', async () => {
        await it('seeds a later provider from the earlier one, and invalidate() clears it', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-otp-provider-'));
            const prevXdg = process.env.XDG_RUNTIME_DIR;
            const prevOptOut = process.env.GJSIFY_NO_OTP_CACHE;
            const registry = 'https://registry.npmjs.org/';
            try {
                process.env.XDG_RUNTIME_DIR = dir; // redirect the real cache dir
                delete process.env.GJSIFY_NO_OTP_CACHE;

                // First command types (seeds) an --otp scoped to the registry.
                const first = new OtpProvider('246810', undefined, { registry });
                expect(first.current()).toBe('246810');

                // A SEPARATE command (fresh provider, no seed) reads it back.
                const second = new OtpProvider(undefined, undefined, { registry });
                expect(second.current()).toBe('246810');

                // Invalidating clears the file → the next command misses.
                second.invalidate();
                const third = new OtpProvider(undefined, undefined, { registry });
                expect(third.current()).toBe(undefined);
            } finally {
                if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
                else process.env.XDG_RUNTIME_DIR = prevXdg;
                if (prevOptOut === undefined) delete process.env.GJSIFY_NO_OTP_CACHE;
                else process.env.GJSIFY_NO_OTP_CACHE = prevOptOut;
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('a different registry does not reuse the cached code', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-otp-provider-'));
            const prevXdg = process.env.XDG_RUNTIME_DIR;
            const prevOptOut = process.env.GJSIFY_NO_OTP_CACHE;
            try {
                process.env.XDG_RUNTIME_DIR = dir;
                delete process.env.GJSIFY_NO_OTP_CACHE;
                new OtpProvider('135790', undefined, { registry: 'https://registry.npmjs.org/' });
                const other = new OtpProvider(undefined, undefined, { registry: 'https://npm.pkg.github.com/' });
                expect(other.current()).toBe(undefined);
            } finally {
                if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
                else process.env.XDG_RUNTIME_DIR = prevXdg;
                if (prevOptOut === undefined) delete process.env.GJSIFY_NO_OTP_CACHE;
                else process.env.GJSIFY_NO_OTP_CACHE = prevOptOut;
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
