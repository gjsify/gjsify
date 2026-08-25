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
import type { TrustRequester } from '../commands/trust.js';
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

    let res = await request('GET', url);
    let state = classifyTrustList(res.status, res.json, classifyOpts);

    if (state === 'auth-required' && opts.retryOn401 !== false) {
        const sleep = opts.sleep ?? defaultSleep;
        await sleep(opts.retryDelayMs ?? PROBE_RETRY_DELAY_MS);
        res = await request('GET', url);
        state = classifyTrustList(res.status, res.json, classifyOpts);
    }

    // `untrusted` is the ONE ambiguous answer: the trust endpoint returns `2xx` with
    // an empty list both for "published, nobody trusted it" and for "no such name".
    // Only that case pays for the extra read — `trusted` cannot be a missing package
    // and `unpublished` already has its answer.
    if (state === 'untrusted') {
        const exists = await (opts.exists ?? packumentExists)(registry, ws.name);
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
