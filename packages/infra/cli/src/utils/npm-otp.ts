// Shared npm 2FA / OTP handling for the auth-aware CLI commands
// (`gjsify publish`, `gjsify trust`, `gjsify onboard`).
//
// npm signals "OTP required" via HTTP 401 + a `www-authenticate` header
// containing `otp` (or, for malformed responses, a body mentioning
// "one-time pass" / `EOTP`) — see
// refs/npm-cli/node_modules/npm-registry-fetch/lib/check-response.js.
//
// Two pieces were previously duplicated in `publish.ts` and `trust.ts`:
//   1. detecting the challenge (`isOtpChallenge`);
//   2. prompting for a code, then retrying the request with it.
//
// They are centralised here so a single `OtpProvider` can be injected across
// MANY operations in one run. `gjsify onboard` sweeps ~110 packages and would
// otherwise prompt once per package; with one shared provider the user types
// an OTP once — the cached code is tried first on every subsequent challenge,
// and a fresh prompt only happens when npm actually rejects/expires it.
//
// Standalone `publish`/`trust` keep their existing single-command UX: each
// still constructs its own provider and prompts on demand.

import { promptLine } from './prompt.js';

/** A function that prompts the user for one line (an OTP code). */
export type OtpPromptFn = (question: string) => Promise<string>;

const DEFAULT_QUESTION = 'This operation requires a one-time password.\nEnter OTP: ';

/**
 * True when a response is an npm OTP / 2FA challenge (401 + a `www-authenticate`
 * header naming `otp`, or a body mentioning a one-time password / `EOTP`).
 * Unifies the detection logic previously inlined in both publish.ts and trust.ts.
 */
export async function isOtpChallenge(res: Response): Promise<boolean> {
    if (res.status !== 401) return false;
    const wwwAuth = (res.headers.get('www-authenticate') ?? '').toLowerCase();
    if (wwwAuth.includes('otp')) return true;
    const text = await res
        .clone()
        .text()
        .catch(() => '');
    return /one-time pass/i.test(text) || /\bEOTP\b/.test(text);
}

/**
 * Holds ONE OTP code across a run and knows how to prompt for a fresh one.
 *
 * `current()` returns the cached code (seeded from `--otp`, or the last one the
 * user typed). `refresh()` prompts for a new code and caches it. A single
 * provider instance shared across many publish + trust operations is what makes
 * `gjsify onboard` need only one OTP entry for the whole sweep.
 */
export class OtpProvider {
    private cached: string | undefined;
    private readonly promptFn: OtpPromptFn;

    /**
     * @param seed     Initial cached code (from `--otp`), or undefined.
     * @param promptFn How to read a fresh code. Defaults to the TTY-aware
     *                 `promptLine`. Non-interactive callers pass a function that
     *                 returns `''` so a challenge surfaces instead of hanging.
     */
    constructor(seed?: string, promptFn: OtpPromptFn = promptLine) {
        this.cached = seed && seed.length > 0 ? seed : undefined;
        this.promptFn = promptFn;
    }

    /** The currently cached OTP code, if any. */
    current(): string | undefined {
        return this.cached;
    }

    /**
     * Prompt for a fresh code, cache it, and return it (the trimmed input, or
     * `''` when nothing was entered — the caller treats empty as "give up").
     */
    async refresh(question: string = DEFAULT_QUESTION): Promise<string> {
        const code = (await this.promptFn(question)).trim();
        if (code) this.cached = code;
        return code;
    }
}

export interface OtpRetryOptions {
    /**
     * Send the cached code on the FIRST attempt instead of trying without an OTP
     * first. `gjsify publish --otp <code>` uses this so the PUT carries the
     * `npm-otp` header immediately (matching npm's `--otp` behaviour). The
     * cache-first flows (`trust`, `onboard`) leave it false so the first attempt
     * exploits npm's ~5-min 2FA-skip window and only sends a code when actually
     * challenged.
     */
    seedFirstAttempt?: boolean;
    /** Max fresh prompts after the cached code is exhausted. Default 2. */
    maxPrompts?: number;
    /** Prompt text. Default: the standard npm one-time-password question. */
    question?: string;
}

/**
 * Run `doFetch` with cache-first OTP retry against a shared {@link OtpProvider}.
 *
 * Flow:
 *   1. First attempt — without an OTP (or WITH the cached code when
 *      `seedFirstAttempt` is set).
 *   2. On a 2FA challenge, retry with the currently-cached code (unless step 1
 *      already sent it).
 *   3. If still challenged (cache empty/rejected/expired), prompt for a fresh
 *      code — caching it on the provider so the NEXT operation tries it first —
 *      and retry, up to `maxPrompts` times.
 *   4. Return the last response (a challenge the caller must handle) when the
 *      user declines to enter a code.
 *
 * The caller owns the actual fetch + all response interpretation; this only
 * owns the OTP dance.
 */
export async function withOtpRetry(
    doFetch: (otp?: string) => Promise<Response>,
    provider: OtpProvider,
    opts: OtpRetryOptions = {},
): Promise<Response> {
    const maxPrompts = opts.maxPrompts ?? 2;
    const question = opts.question ?? DEFAULT_QUESTION;
    const cached = provider.current();
    const seededFirst = opts.seedFirstAttempt === true && cached !== undefined;

    let res = await doFetch(seededFirst ? cached : undefined);
    if (!(await isOtpChallenge(res))) return res;

    // Try the cached code if we haven't already sent it.
    if (!seededFirst && provider.current() !== undefined) {
        res = await doFetch(provider.current());
        if (!(await isOtpChallenge(res))) return res;
    }

    // Cache empty, rejected, or expired → prompt for a fresh code and retry.
    for (let i = 0; i < maxPrompts; i++) {
        const fresh = await provider.refresh(question);
        if (!fresh) return res; // no input — hand the challenge back to the caller
        res = await doFetch(fresh);
        if (!(await isOtpChallenge(res))) return res;
    }
    return res;
}
