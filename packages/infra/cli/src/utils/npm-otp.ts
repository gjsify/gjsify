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
 * The question for every prompt AFTER the first one in a run.
 *
 * A long sweep outlives a TOTP window (npm codes last ~30 s), so it legitimately
 * asks again — but repeating the first-time wording makes that read as "it did
 * not take my code" rather than "that code has aged out". The user then retypes
 * the SAME digits, which is the one answer guaranteed not to work.
 */
const RENEW_QUESTION =
    'The previous one-time password is no longer valid (npm codes last about 30 seconds).\nEnter a NEW OTP: ';

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
     * Bumped every time a NEW code becomes current. Concurrent callers compare the
     * epoch they last saw against this one to tell "my code was rejected" from
     * "somebody already replaced it while I was waiting" — the second needs no
     * prompt, it needs the other one's code.
     */
    private generation = 0;
    /**
     * The prompt currently on screen, if any. THE fix for a sweep that probes with
     * concurrency > 1: `promptLine` puts the terminal in RAW mode and echoes each
     * keystroke by hand (utils/prompt.ts), so two live prompts mean two `data`
     * listeners on the same stdin and every digit is echoed TWICE. Measured on a
     * real 703-package sweep at the default concurrency of 4: five prompts stacked
     * up and the typed code came back as `666644440000999944444444` — four echoes
     * per keystroke. Whoever arrives second awaits this promise instead.
     */
    private pending: Promise<string> | undefined;

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
     * How many times a new code has become current. Capture it before an attempt
     * and hand it back to {@link refresh} / {@link invalidate} so a concurrent
     * caller neither prompts for a code somebody already typed nor throws that
     * code away on its own stale rejection.
     */
    epoch(): number {
        return this.generation;
    }

    /**
     * Prompt for a fresh code, cache it (in-process + file cache), and return the
     * trimmed input — `''` when nothing was entered, which callers read as "give up".
     */
    async refresh(question?: string, sinceEpoch?: number): Promise<string> {
        // Somebody supplied a newer code than this caller last saw. Its own attempt
        // failed against the OLD code, so the answer is that code, not a prompt.
        if (sinceEpoch !== undefined && this.generation > sinceEpoch && this.cached) {
            return this.cached;
        }
        // Single-flight: one prompt at a time, ever. Two raw-mode prompts on one
        // stdin double every echoed keystroke, and the user is being asked twice
        // for a code that is shared anyway.
        if (this.pending) return this.pending;
        // The provider is the only thing that knows whether a code has already
        // been supplied in this run, so it owns the wording. An explicit
        // `question` from the caller always wins.
        this.pending = this.promptOnce(question ?? (this.generation > 0 ? RENEW_QUESTION : DEFAULT_QUESTION));
        try {
            return await this.pending;
        } finally {
            this.pending = undefined;
        }
    }

    private async promptOnce(question: string): Promise<string> {
        const code = (await this.promptFn(question)).trim();
        if (code) {
            this.cached = code;
            this.generation++;
            if (this.registry) writeCachedOtp(this.registry, code);
        }
        return code;
    }

    /**
     * Drop the cached code (in-process AND the cross-invocation file entry) after npm
     * rejects it, so the NEXT command re-prompts instead of replaying a single-use
     * code the registry already burned.
     */
    invalidate(sinceEpoch?: number): void {
        // Only the caller whose own code was rejected may clear it. Without this
        // guard the first rejection in a concurrent burst wipes a code another
        // worker just typed, and every remaining worker prompts again — the same
        // stacked-prompt pile-up from the other direction.
        if (sinceEpoch !== undefined && this.generation !== sinceEpoch) return;
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
    // Deliberately NOT defaulted here: `undefined` is what lets the provider pick
    // between the first-time wording and the "your previous code aged out" one.
    const question = opts.question;
    const cached = provider.current();
    const seededFirst = opts.seedFirstAttempt === true && cached !== undefined;

    // Every invalidate/refresh below is scoped to the epoch of the code THIS call
    // actually tried. Concurrent callers share the provider, so an unscoped
    // `invalidate()` discards a code a sibling typed a millisecond ago and sends
    // everyone back to the prompt.
    let epoch = provider.epoch();
    let res = await doFetch(seededFirst ? cached : undefined);
    if (!(await isOtpChallenge(res))) return res;
    // The seeded code was rejected/consumed — drop it so it is not replayed and the
    // cross-invocation cache entry is cleared.
    if (seededFirst) provider.invalidate(epoch);

    if (!seededFirst && provider.current() !== undefined) {
        epoch = provider.epoch();
        res = await doFetch(provider.current());
        if (!(await isOtpChallenge(res))) return res;
        // Stale seed, or a sibling command already burned the file-cached single-use
        // code.
        provider.invalidate(epoch);
    }

    for (let i = 0; i < maxPrompts; i++) {
        // `refresh` with the epoch: if another concurrent caller has already typed a
        // newer code, this returns THAT code and shows no prompt.
        const fresh = await provider.refresh(question, epoch);
        if (!fresh) return res; // no input — hand the challenge back to the caller
        epoch = provider.epoch();
        res = await doFetch(fresh);
        if (!(await isOtpChallenge(res))) return res;
        // Clear a rejected fresh code before re-prompting, so a wedged sequence never
        // leaves a burned code in the file cache.
        provider.invalidate(epoch);
    }
    return res;
}
