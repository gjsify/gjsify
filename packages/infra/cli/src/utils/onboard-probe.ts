// Trusted-Publisher STATE-READ path for `gjsify onboard`, extracted so it can be
// unit-tested against a mocked requester (no live npm).
//
// Onboard MUST read through the same `TrustRequester` as `gjsify trust`, never a
// plain authenticated `fetch`. It once used the latter, in a wide concurrent burst:
// every one of ~127 reads came back `401 → auth-required → unreadable` and the
// sweep planned `0 to publish+trust, 0 to trust, 127 unreadable`, while a targeted
// `gjsify trust <pkg> --otp <code>` read the same state fine on the SAME token —
// because the shared requester goes through `withOtpRetry`, which answers a 401
// that is an OTP challenge and tolerates transient non-OTP ones.

import { DEFAULT_REGISTRY, registryFor, type NpmrcConfig } from '@gjsify/npm-registry';
import type { Workspace } from '@gjsify/workspace';
import type { TrustRequester, TrustRequestResult } from '../commands/trust.js';
import { classifyTrustList, trustUrl, type TrustState } from './trust-registry.js';

/** What a package needs, computed from its published + trust state. */
export type PkgAction = 'skip' | 'trust' | 'publish-and-trust' | 'blocked';

export interface PkgPlan {
    ws: Workspace;
    registry: string;
    url: string;
    state: TrustState;
    httpStatus: number;
    action: PkgAction;
}

export interface ProbeContext {
    registryOverride?: string;
    npmrc: NpmrcConfig;
    repository: string;
    workflow: string;
}

/** Tunables (also the test seams) for a single probe read. */
export interface ProbeOptions {
    /** Retry once on a transient `auth-required` (401). Default true. */
    retryOn401?: boolean;
    /** Backoff before the single 401 retry. Default {@link PROBE_RETRY_DELAY_MS}. */
    retryDelayMs?: number;
    /** Total time to spend waiting out HTTP 429s. Default {@link RATE_LIMIT_MAX_WAIT_MS}. */
    maxRateLimitWaitMs?: number;
    /** First backoff for a 429; doubles per attempt. Default {@link RATE_LIMIT_BASE_DELAY_MS}. */
    rateLimitBaseDelayMs?: number;
    /**
     * Cool-down shared across the sweep. Pass ONE instance to every call so a
     * 429 anywhere holds back everywhere; omit for an isolated request.
     */
    gate?: RateLimitGate;
    /**
     * Called on every 429 with what npm actually sent and how long we will wait.
     * The caller decides how loud to be; reporting the FIRST one is enough to
     * turn "we got throttled" into "npm asked for N seconds" (or into "npm said
     * nothing, so this delay is ours").
     */
    onRateLimit?: (info: { url: string; headers: string; waitMs: number; fromRetryAfter: boolean }) => void;
    /**
     * Called after each state read with what is known SO FAR.
     *
     * The probe phase is the silent half of a sweep: 703 packages take minutes
     * and, until this existed, printed nothing at all between the header and the
     * plan. The only output in that window was the occasional 2FA prompt, which
     * makes a working sweep and a wedged one look identical — and the prompt is
     * the moment a user most needs to know the previous code accomplished
     * something.
     */
    onProgress?: (done: number, total: number, plan: PkgPlan) => void;
    /** Injected delay (tests pass a no-op). Default: real `setTimeout`. */
    sleep?: (ms: number) => Promise<void>;
    /**
     * Does this name exist on the registry? The PACKUMENT oracle — see
     * {@link packumentExists}. Tests inject it; production uses the real fetch.
     */
    exists?: (registry: string, name: string) => Promise<boolean | null>;
}

export const PROBE_RETRY_DELAY_MS = 400;

/**
 * A 429 is npm asking to be asked later — never an answer about the package.
 *
 * Measured on the real 703-package sweep of `gjsify/types` at the default
 * concurrency: the first 662 reads answered and the LAST 41 came back `429`, so
 * the plan said `41 unreadable` for packages whose state nobody had actually
 * failed to determine. The tail of an alphabetical list is exactly where a
 * cumulative rate limit lands, which makes the damage look like a property of
 * those packages.
 *
 * Waiting is the whole fix, and it has to be bounded: an unbounded wait turns a
 * throttled sweep into a hang with no output.
 */
/**
 * A TIME budget, not an attempt count — and generous, because npm tells us
 * nothing.
 *
 * The attempt count was the wrong unit and the real sweep proved it: 4 attempts
 * with a doubling 2s base is 30 seconds of patience, npm's window is longer than
 * that, so every in-flight request spent its budget inside one cooldown and
 * `Done: 502 trusted … 73 failed` — all 73 at the tail, all 429, none of them a
 * fact about those packages.
 *
 * With no `Retry-After` and no rate-limit headers to read (measured), waiting is
 * the only instrument there is. Five minutes per request is worth it: the
 * alternative is failing packages that then need another sweep, which is itself
 * throttled. Bounded all the same, so a throttled sweep still ENDS.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 300_000;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;
/** Ceiling for a single backoff step, so escalation stays legible. */
export const RATE_LIMIT_MAX_STEP_MS = 60_000;

/**
 * What npm told us about pacing on a 429 — verbatim, so the answer to "how fast
 * may we go" comes from the registry rather than from a guess.
 *
 * Measured 2026-08-28: npm serves NO `X-RateLimit-*` headers on ordinary
 * responses, so there is no budget to read ahead of time. `Retry-After` on the
 * 429 itself is the only channel, and whether npm populates it on the trust
 * endpoint is exactly what this reports the first time it happens.
 */
export function describeRateLimitHeaders(headers: Headers | undefined): string {
    if (!headers) return 'no headers captured';
    const seen: string[] = [];
    headers.forEach((value, key) => {
        if (/^retry-after$/i.test(key) || /ratelimit/i.test(key)) seen.push(`${key}: ${value}`);
    });
    return seen.length > 0 ? seen.join(', ') : 'npm sent no Retry-After and no rate-limit headers';
}

/** Seconds to wait per npm's `Retry-After`, or null when it said nothing usable. */
export function retryAfterMs(headers: Headers | undefined): number | null {
    const raw = headers?.get('retry-after');
    if (!raw) return null;
    const secs = Number.parseInt(raw.trim(), 10);
    // Only the delta-seconds form. The HTTP-date form is legal and npm does not
    // send it; guessing at a date here would be a second clock to get wrong.
    if (!Number.isFinite(secs) || secs < 0) return null;
    return secs * 1000;
}

/**
 * Does the registry serve a packument for this name?
 *
 * THE ORACLE, and the reason it exists: npm's trust endpoint answers `2xx` with an
 * EMPTY LIST for a name that was never published. `classifyTrustList` reads that as
 * `untrusted`, so `gjsify onboard` planned "already on npm, just needs trust" for a
 * package that did not exist — it trusted the name, reported `0 to publish+trust`
 * and published NOTHING. A bootstrap command reporting its own gap as closed, and
 * it is why the v0.36.0 repair failed twice before anyone looked at the registry.
 *
 * `GET <registry>/<name>` is unauthenticated and needs no OTP, so it answers in the
 * one situation that matters: a `--dry-run` before the maintainer has an OTP to
 * hand, where every trust read is `401` and the plan is otherwise empty.
 *
 * `null` means UNDECIDED (network or an unexpected status) — never "absent". A
 * bootstrap that publishes on a failed probe is worse than one that reports blocked.
 */
export async function packumentExists(registry: string, name: string): Promise<boolean | null> {
    const base = registry.endsWith('/') ? registry.slice(0, -1) : registry;
    try {
        // `Accept` narrows the response to the abbreviated packument: the full one
        // for a package like `@gjsify/cli` is megabytes, and existence is all we ask.
        const res = await fetch(`${base}/${name.replace('/', '%2f')}`, {
            method: 'GET',
            headers: { accept: 'application/vnd.npm.install-v1+json' },
        });
        if (res.status === 404) return false;
        if (res.ok) return true;
        return null;
    } catch {
        // A DNS or TLS failure is not evidence of absence.
        return null;
    }
}

/** Default probe concurrency — kept SMALL so a single token never bursts npm. */
export const DEFAULT_PROBE_CONCURRENCY = 4;

/** Map a classified trust state to the action the onboard sweep should take. */
export function actionForState(state: TrustState): PkgAction {
    switch (state) {
        case 'trusted':
            return 'skip';
        case 'untrusted':
            return 'trust';
        case 'unpublished':
            return 'publish-and-trust';
        default:
            // auth-required / error — can't determine, so don't act blindly.
            return 'blocked';
    }
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A cool-down shared by every in-flight request of a sweep.
 *
 * Retrying ONE throttled request in isolation is not enough, and the measured
 * run shows why: at serial pace `gjsify/types` was already being 429'd, so every
 * other worker kept hammering the registry through the very window the retry was
 * waiting out — and the retry budget then expired against a limit nobody had
 * stopped provoking. `trust failed (HTTP 429)` was the result.
 *
 * A 429 anywhere therefore pauses EVERYWHERE. That also makes concurrency safe
 * to raise: the sweep self-paces down to whatever npm is willing to serve
 * instead of the operator guessing a number.
 */
export class RateLimitGate {
    private until = 0;
    private readonly now: () => number;
    private readonly sleeper: (ms: number) => Promise<void>;

    constructor(opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
        this.now = opts.now ?? (() => Date.now());
        this.sleeper = opts.sleep ?? defaultSleep;
    }

    /** Block while a cool-down is in effect. */
    async wait(): Promise<void> {
        const remaining = this.until - this.now();
        if (remaining > 0) await this.sleeper(remaining);
    }

    /** Hold every request back for at least `ms` from now. */
    penalize(ms: number): void {
        this.until = Math.max(this.until, this.now() + ms);
    }

    /** Milliseconds still owed, for tests and for reporting. */
    remainingMs(): number {
        return Math.max(0, this.until - this.now());
    }
}

/**
 * Issue a request, waiting out an HTTP 429 rather than reporting it as a state.
 *
 * Used by BOTH the probe GET and the act-phase trust POST, because a sweep long
 * enough to be throttled on reads is long enough to be throttled on writes, and
 * a throttled POST would otherwise be recorded as `trust failed (HTTP 429)` —
 * a failure attributed to the package instead of to the pacing.
 *
 * Bounded on purpose: it returns the last 429 once the budget is spent, so the
 * caller reports "unreadable" rather than hanging. `Retry-After` wins over the
 * exponential backoff whenever npm sends a usable one.
 */
export async function requestWaitingOutRateLimit(
    request: TrustRequester,
    method: string,
    url: string,
    body?: unknown,
    opts: ProbeOptions = {},
): Promise<TrustRequestResult> {
    const sleep = opts.sleep ?? defaultSleep;
    const budgetMs = opts.maxRateLimitWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
    const baseDelay = opts.rateLimitBaseDelayMs ?? RATE_LIMIT_BASE_DELAY_MS;
    const gate = opts.gate;

    // Respect a cool-down somebody else is already serving BEFORE spending an
    // attempt. Without this the sweep keeps provoking the limit it is waiting on.
    if (gate) await gate.wait();
    let res = await request(method, url, body);

    let waited = 0;
    for (let attempt = 0; res.status === 429 && waited < budgetMs; attempt++) {
        const advised = retryAfterMs(res.headers);
        const step = Math.min(advised ?? baseDelay * 2 ** attempt, RATE_LIMIT_MAX_STEP_MS);
        // Never overshoot the budget: the last wait is whatever is left of it.
        const delay = Math.min(step, budgetMs - waited);
        opts.onRateLimit?.({
            url,
            headers: describeRateLimitHeaders(res.headers),
            waitMs: delay,
            fromRetryAfter: advised !== null,
        });
        // Tell everyone, not just this call.
        gate?.penalize(delay);
        await (gate ? gate.wait() : sleep(delay));
        waited += delay;
        res = await request(method, url, body);
    }
    return res;
}

/**
 * Read one package's published + trust state through the SHARED trust requester.
 * A surviving `auth-required` means the 401 was not an answerable OTP challenge —
 * a parallel-burst rejection or a lapsed 2FA-skip window — and both recover on a
 * single retry after a short backoff.
 */
export async function probeTrustState(
    request: TrustRequester,
    ws: Workspace,
    ctx: ProbeContext,
    opts: ProbeOptions = {},
): Promise<PkgPlan> {
    const registry = ctx.registryOverride ?? registryFor(ws.name, ctx.npmrc) ?? DEFAULT_REGISTRY;
    const url = trustUrl(registry, ws.name);
    const classifyOpts = { repository: ctx.repository, workflow: ctx.workflow };

    const sleep = opts.sleep ?? defaultSleep;

    // A 429 is not an answer — wait it out BEFORE classifying anything.
    let res = await requestWaitingOutRateLimit(request, 'GET', url, undefined, opts);
    let state = classifyTrustList(res.status, res.json, classifyOpts);

    if (state === 'auth-required' && opts.retryOn401 !== false) {
        await sleep(opts.retryDelayMs ?? PROBE_RETRY_DELAY_MS);
        res = await request('GET', url);
        state = classifyTrustList(res.status, res.json, classifyOpts);
    }

    // `untrusted` is the ONE ambiguous answer: the trust endpoint returns `2xx` with
    // an empty list both for "published, nobody trusted it" and for "no such name".
    // Only that case pays for the extra read — `trusted` cannot be a missing package
    // and `unpublished` already has its answer.
    // Two questions, two endpoints. The trust list answers "who may publish this",
    // and onboard also needs "does this name exist at all" — which it can only
    // INFER from the trust list, and infers wrongly in both ambiguous states:
    //
    //   untrusted      npm serves 2xx and an EMPTY list for a name that was never
    //                  published — byte-identical to a real package that simply has
    //                  no trusted publisher configured.
    //   auth-required  a 401 says nothing whatsoever about existence. It is also
    //                  where EVERY package lands in a `--dry-run` run before the
    //                  maintainer has an OTP to hand, which is exactly the moment
    //                  the plan is being read to decide whether to proceed.
    //
    // The packument answers the question directly and unauthenticated, and a 404
    // there is proof no OTP could change. Only these two states pay for the extra
    // read: `trusted` cannot be a missing package, and `unpublished` already has
    // its answer from the endpoint it just asked.
    if (state === 'untrusted' || state === 'auth-required') {
        const exists = await (opts.exists ?? packumentExists)(registry, ws.name);
        // ONLY a definitive 404 reclassifies. `null` — network failure, unexpected
        // status — leaves the state exactly as it was: a bootstrap that publishes
        // on a failed read is worse than one that reports itself blocked.
        if (exists === false) state = 'unpublished';
    }

    return { ws, registry, url, state, httpStatus: res.status, action: actionForState(state) };
}

/**
 * Probe every selected workspace. The FIRST is read SERIALLY on purpose: a
 * 2FA-gated read triggers the shared-OTP prompt once, before the burst, so the rest
 * reuse the cached code instead of each prompting.
 */
export async function probeAllTrustStates(
    request: TrustRequester,
    selected: readonly Workspace[],
    concurrency: number,
    ctx: ProbeContext,
    opts: ProbeOptions = {},
): Promise<PkgPlan[]> {
    if (selected.length === 0) return [];
    const total = selected.length;
    let done = 0;
    const report = (plan: PkgPlan): PkgPlan => {
        done++;
        opts.onProgress?.(done, total, plan);
        return plan;
    };
    const first = report(await probeTrustState(request, selected[0], ctx, opts));
    const rest = await mapWithConcurrency(selected.slice(1), Math.max(1, concurrency), async (ws) =>
        report(await probeTrustState(request, ws, ctx, opts)),
    );
    return [first, ...rest];
}

/** Map with bounded concurrency, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length });
    let next = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
