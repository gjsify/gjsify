// Shared npm 2FA / OTP handling for the auth-aware CLI commands
// (`gjsify publish`, `gjsify trust`, `gjsify onboard`).
//
// npm signals "OTP required" via HTTP 401 + a `www-authenticate` header containing
// `otp` (or, for malformed responses, a body mentioning "one-time pass" / `EOTP`) —
// see refs/npm-cli/node_modules/npm-registry-fetch/lib/check-response.js.
//
// Detection and prompt-then-retry live here so ONE `OtpProvider` can be injected
// across many operations in a single run: `gjsify onboard` sweeps every publishable
// package and would otherwise prompt per package, whereas a shared provider tries the cached
// code first on every subsequent challenge and only re-prompts when npm actually
// rejects or expires it. Standalone `publish`/`trust` each construct their own
// provider and prompt on demand.

import { promptLine } from './prompt.js';
import { clearCachedOtp, readCachedOtp, writeCachedOtp } from './npm-otp-cache.js';

/** A function that prompts the user for one line (an OTP code). */
export type OtpPromptFn = (question: string) => Promise<string>;

const DEFAULT_QUESTION = 'This operation requires a one-time password.\nEnter OTP: ';

/**
 * True when a response is an npm OTP / 2FA challenge (401 + a `www-authenticate`
 * header naming `otp`, or a body mentioning a one-time password / `EOTP`).
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

/** Options controlling the cross-invocation file cache an {@link OtpProvider} rides on top of. */
export interface OtpProviderOptions {
    /**
     * Registry URL scoping the SHORT-LIVED cross-invocation OTP cache
     * (`utils/npm-otp-cache.ts`). When set, a provider constructed WITHOUT an
     * explicit seed reads the file-cached code first (so a sibling `gjsify`
     * command's typed OTP is reused within its ~30 s TOTP window), and every newly
     * typed/seeded code is written back for the next command. Omit for an
     * in-process-only provider.
     */
    registry?: string;
}

/**
 * Holds ONE OTP code across a run and knows how to prompt for a fresh one.
 *
 * `current()` returns the cached code (seeded from `--otp`, the cross-invocation
 * file cache, or the last one typed); `refresh()` prompts for a new one and caches
 * it in-process AND — when a `registry` is set — in the short-lived file cache. One
 * shared instance is what makes `gjsify onboard` need a single OTP entry for a whole
 * sweep; the file cache extends that reuse across SEPARATE invocations
 * (`login → onboard → publish → trust`).
 */
export class OtpProvider {
    private cached: string | undefined;
    private readonly promptFn: OtpPromptFn;
    private readonly registry: string | undefined;

    /**
     * @param seed     Initial cached code (from `--otp`), or undefined.
     * @param promptFn How to read a fresh code. Defaults to the TTY-aware
     *                 `promptLine`. Non-interactive callers pass a function that
     *                 returns `''` so a challenge surfaces instead of hanging.
     * @param options  Optional cross-invocation file-cache scoping (`registry`).
     */
    constructor(seed?: string, promptFn: OtpPromptFn = promptLine, options: OtpProviderOptions = {}) {
        this.promptFn = promptFn;
        this.registry = options.registry;
        const explicit = seed && seed.length > 0 ? seed : undefined;
        if (explicit) {
            this.cached = explicit;
            // An explicit --otp seeds the cross-invocation cache too, so a
            // sibling command in the same window reuses it without a prompt.
            if (this.registry) writeCachedOtp(this.registry, explicit);
        } else {
            // No explicit code — fall back to the short-lived file cache.
            this.cached = this.registry ? readCachedOtp(this.registry) : undefined;
        }
    }

    /** The currently cached OTP code, if any. */
    current(): string | undefined {
        return this.cached;
    }

    /**
     * Prompt for a fresh code, cache it (in-process + file cache), and return the
     * trimmed input — `''` when nothing was entered, which callers read as "give up".
     */
    async refresh(question: string = DEFAULT_QUESTION): Promise<string> {
        const code = (await this.promptFn(question)).trim();
        if (code) {
            this.cached = code;
            if (this.registry) writeCachedOtp(this.registry, code);
        }
        return code;
    }

    /**
     * Drop the cached code (in-process AND the cross-invocation file entry) after npm
     * rejects it, so the NEXT command re-prompts instead of replaying a single-use
     * code the registry already burned.
     */
    invalidate(): void {
        this.cached = undefined;
        if (this.registry) clearCachedOtp(this.registry);
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
 * Run `doFetch` with cache-first OTP retry against a shared {@link OtpProvider}:
 * attempt without an OTP (or with the cached code under `seedFirstAttempt`), retry
 * with the cached code on a challenge, then prompt for fresh codes up to
 * `maxPrompts` times. A declined prompt returns the last challenge response for the
 * caller to handle.
 *
 * The caller owns the fetch and all response interpretation; this owns only the OTP
 * dance.
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
    // The seeded code was rejected/consumed — drop it so it is not replayed and the
    // cross-invocation cache entry is cleared.
    if (seededFirst) provider.invalidate();

    if (!seededFirst && provider.current() !== undefined) {
        res = await doFetch(provider.current());
        if (!(await isOtpChallenge(res))) return res;
        // Stale seed, or a sibling command already burned the file-cached single-use
        // code.
        provider.invalidate();
    }

    for (let i = 0; i < maxPrompts; i++) {
        const fresh = await provider.refresh(question);
        if (!fresh) return res; // no input — hand the challenge back to the caller
        res = await doFetch(fresh);
        if (!(await isOtpChallenge(res))) return res;
        // Clear a rejected fresh code before re-prompting, so a wedged sequence never
        // leaves a burned code in the file cache.
        provider.invalidate();
    }
    return res;
}
