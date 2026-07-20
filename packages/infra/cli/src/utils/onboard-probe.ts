// Trusted-Publisher STATE-READ path for `gjsify onboard`, extracted so it can
// be unit-tested against a mocked requester (no live npm).
//
// The bug this fixes (task #60): `gjsify onboard` read all ~127 packages'
// trust state with a PLAIN authenticated `fetch` (no OTP handling) run in a
// wide concurrent burst — every read came back `401 → auth-required →
// unreadable`, so the sweep planned `0 to publish+trust, 0 to trust, 127
// unreadable`. Meanwhile a targeted `gjsify trust <pkg> --otp <code>` READ the
// same state fine with the SAME token, because its read runs through the shared
// `TrustRequester` (→ `withOtpRetry`): a 401 that is an OTP challenge is
// answered with the shared code, and non-OTP transient 401s are tolerated.
//
// Fix: onboard now reads through the EXACT same `TrustRequester` path as
// `gjsify trust` (identical `trustUrl` + `buildHeaders` auth + OTP handling),
// PLUS a one-shot retry on a transient 401, PLUS a first-serial-then-bounded
// probe order so the ONE shared OTP is prompted at most once and npm is never
// hit with a 127-wide parallel burst from a single token.

import { DEFAULT_REGISTRY, registryFor, type NpmrcConfig } from '@gjsify/npm-registry';
import type { Workspace } from '@gjsify/workspace';
import type { TrustRequester } from '../commands/trust.js';
import { classifyTrustList, trustUrl, type TrustState } from './trust-registry.js';

/** What a package needs, computed from its published + trust state. */
export type PkgAction = 'skip' | 'trust' | 'publish-and-trust' | 'blocked';

/** A per-package plan produced by the probe phase. */
export interface PkgPlan {
    ws: Workspace;
    registry: string;
    url: string;
    state: TrustState;
    httpStatus: number;
    action: PkgAction;
}

/** Everything a probe needs beyond the requester + workspace. */
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
    /** Injected delay (tests pass a no-op). Default: real `setTimeout`. */
    sleep?: (ms: number) => Promise<void>;
}

/** Small backoff before the one-shot retry of a transient 401 read. */
export const PROBE_RETRY_DELAY_MS = 400;

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
 * Read one package's published + trust state via the SHARED trust requester —
 * the exact `trustUrl` + `buildHeaders` auth + `withOtpRetry` path `gjsify
 * trust` uses. On a transient `auth-required` (401 that was not an answerable
 * OTP challenge — e.g. a parallel-burst rejection or a lapsed 2FA-skip window),
 * it retries ONCE after a short backoff.
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

    let res = await request('GET', url);
    let state = classifyTrustList(res.status, res.json, classifyOpts);

    if (state === 'auth-required' && opts.retryOn401 !== false) {
        const sleep = opts.sleep ?? defaultSleep;
        await sleep(opts.retryDelayMs ?? PROBE_RETRY_DELAY_MS);
        res = await request('GET', url);
        state = classifyTrustList(res.status, res.json, classifyOpts);
    }

    return { ws, registry, url, state, httpStatus: res.status, action: actionForState(state) };
}

/**
 * Probe every selected workspace. The FIRST package is read SERIALLY so a
 * 2FA-gated read triggers the single shared-OTP prompt (typed once) before the
 * concurrent burst — the rest reuse the now-cached code — and so a single token
 * never faces a 127-wide parallel read. The remaining packages are read with a
 * bounded (small) concurrency cap.
 */
export async function probeAllTrustStates(
    request: TrustRequester,
    selected: readonly Workspace[],
    concurrency: number,
    ctx: ProbeContext,
    opts: ProbeOptions = {},
): Promise<PkgPlan[]> {
    if (selected.length === 0) return [];
    const first = await probeTrustState(request, selected[0], ctx, opts);
    const rest = await mapWithConcurrency(selected.slice(1), Math.max(1, concurrency), (ws) =>
        probeTrustState(request, ws, ctx, opts),
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
