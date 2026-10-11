// What happened to a version npm ACCEPTED and the packument does not serve?
//
// THE INCIDENT (v0.59.0 / v0.59.1). A handful of packages — `@gjsify/adwaita-fonts`
// and five `@gjsify/example-*` — got HTTP 202 on the PUT and never appeared in the
// public packument; a re-PUT is answered 409. The npm website shows them as
// "Validating" ("Automated review hasn't finished. The version will remain
// unavailable until review completes."). Both read-back verdicts that existed
// for them — `not-published` and `recorded-not-served` — were wrong in spirit: the
// first told the operator to re-publish (answered 409), the second to wait (it
// would not come). The packument has no field that says which.
//
// The registry does: `GET /-/package/{name}/version/{version}/status` answers
// `published | validating | staged | blocked | deleted`. It accepts an npm access
// token or a granular access token with publish access to the package — NOT the
// short-lived OIDC exchange token the release sweep publishes with, and not
// anonymous requests (401). So in CI the answer is only available when a
// read-only token is provided as `NPM_STATUS_TOKEN`; without one this module says
// so (`no-credential`) instead of guessing, and the callers keep the old behaviour
// plus a hold, which needs no status to be safe.

import { escapePackageName } from './publish-headers.js';
import type { ReadbackVerdict } from './publish-readback.js';

/** The lifecycle states the status endpoint documents. */
export type VersionStatus = 'published' | 'validating' | 'staged' | 'blocked' | 'deleted';

const KNOWN_STATUSES: readonly VersionStatus[] = ['published', 'validating', 'staged', 'blocked', 'deleted'];

export type StatusUnavailableReason =
    /** No token to ask with — the OIDC-only CI case. */
    | 'no-credential'
    /** 401: the token is wrong or lacks the scope. */
    | 'rejected'
    /** 403: the endpoint's per-package rollout gate is closed for this package. */
    | 'not-enabled'
    /** 404: the version does not exist, OR this token cannot see the package. Indistinguishable by design. */
    | 'not-found'
    /** 429 / 5xx / timeout / unparseable body. */
    | 'error';

export type StatusProbe =
    | { state: 'known'; status: VersionStatus }
    | { state: 'unavailable'; reason: StatusUnavailableReason; detail: string };

export interface FetchVersionStatusInput {
    registry: string;
    name: string;
    version: string;
    /** A bare npm access token / granular access token. Absent → `no-credential`, no request is sent. */
    token?: string;
    probeTimeoutMs?: number;
    fetchImpl?: typeof fetch;
}

/**
 * The token to ask the status endpoint with: the dedicated `NPM_STATUS_TOKEN`
 * first, then a `NODE_AUTH_TOKEN` that is a real token and not the
 * `XXXXX-XXXXX-XXXXX-XXXXX` literal `actions/setup-node` injects when given a
 * `registry-url`. Empty string and the placeholder both mean "none".
 */
export function statusTokenFromEnv(env: Record<string, string | undefined>): string | undefined {
    for (const candidate of [env['NPM_STATUS_TOKEN'], env['NODE_AUTH_TOKEN']]) {
        const token = candidate?.trim();
        if (token && !/^X+(-X+)+$/.test(token)) return token;
    }
    return undefined;
}

/** `GET {registry}/-/package/{name}/version/{version}/status`, classified. Never throws. */
export async function fetchVersionStatus(input: FetchVersionStatusInput): Promise<StatusProbe> {
    if (!input.token) {
        return {
            state: 'unavailable',
            reason: 'no-credential',
            detail: 'the status endpoint needs an npm access token (set NPM_STATUS_TOKEN); OIDC publish tokens are not accepted',
        };
    }
    const doFetch = input.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const registryClean = input.registry.endsWith('/') ? input.registry.slice(0, -1) : input.registry;
    const url = `${registryClean}/-/package/${escapePackageName(input.name)}/version/${encodeURIComponent(input.version)}/status`;
    let res: Response;
    try {
        res = await doFetch(url, {
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${input.token}`,
            },
            signal: AbortSignal.timeout(input.probeTimeoutMs ?? 30_000),
        });
    } catch (err) {
        return {
            state: 'unavailable',
            reason: 'error',
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    if (res.status === 401) {
        return {
            state: 'unavailable',
            reason: 'rejected',
            detail: '401 — the token is missing, invalid or expired',
        };
    }
    if (res.status === 403) {
        return {
            state: 'unavailable',
            reason: 'not-enabled',
            detail: '403 — package version status is not enabled for this package',
        };
    }
    if (res.status === 404) {
        return {
            state: 'unavailable',
            reason: 'not-found',
            detail: '404 — no such version, or the token cannot see this package',
        };
    }
    if (!res.ok) {
        return {
            state: 'unavailable',
            reason: 'error',
            detail: `${res.status} ${res.statusText}`,
        };
    }
    let body: unknown;
    try {
        body = await res.json();
    } catch (err) {
        return {
            state: 'unavailable',
            reason: 'error',
            detail: `status body is not JSON (${err instanceof Error ? err.message : String(err)})`,
        };
    }
    const status = (body as { status?: unknown } | null)?.status;
    if (typeof status !== 'string' || !(KNOWN_STATUSES as readonly string[]).includes(status)) {
        return {
            state: 'unavailable',
            reason: 'error',
            detail: `unrecognised status ${JSON.stringify(status)}`,
        };
    }
    return { state: 'known', status: status as VersionStatus };
}

/**
 * What a version the packument does not serve IS. The first five come from the
 * registry's own status; the last two are what we can say without it.
 */
export type UnservedClass =
    /** Automated review has not finished; the version will appear — or turn `blocked`. */
    | 'validating'
    /** Waits for a maintainer to approve it; nothing automatic will change this. */
    | 'staged'
    /** Failed automated validation. Will never be served. */
    | 'blocked'
    /** Deleted. Will never be served, and the number cannot be re-used. */
    | 'deleted'
    /** The registry says `published` but the install document does not carry it yet (write lag). */
    | 'published-lagging'
    /** The registry has no record of the version: the PUT did not land. */
    | 'missing'
    /** Not served and the status endpoint could not be asked; the read-back verdict is all there is. */
    | 'unchecked';

export interface Classification {
    cls: UnservedClass;
    /** One line for the log and the summary. */
    detail: string;
    /**
     * Waiting can no longer change the answer. `validating`, `published-lagging`
     * and `unchecked` can still resolve on their own; the rest cannot.
     */
    terminal: boolean;
}

/** `classifyUnserved(...).terminal` for a class read back from the ledger. */
export function isTerminalClass(cls: UnservedClass): boolean {
    return cls !== 'validating' && cls !== 'published-lagging' && cls !== 'unchecked';
}

/** Why the status could not be asked, in the words the `unchecked` line uses. */
function whyUnchecked(probe: Extract<StatusProbe, { state: 'unavailable' }>): string {
    return probe.reason === 'no-credential' ? 'status endpoint not asked: no NPM_STATUS_TOKEN' : probe.detail;
}

/**
 * Fold the registry's lifecycle status and the read-back verdict into ONE class.
 *
 * The status wins when it answered. When it did not, the read-back verdict is
 * kept in the detail but never promoted to `missing`: `not-published` from the
 * packument alone is exactly the observation a `validating` version produces, so
 * "missing — re-publish" would send the operator into a 409. Only a status 404
 * (the registry itself has no such version) earns `missing`.
 */
export function classifyUnserved(verdict: ReadbackVerdict, probe: StatusProbe): Classification {
    if (probe.state === 'known') {
        switch (probe.status) {
            case 'validating':
                return {
                    cls: 'validating',
                    detail: 'npm accepted the upload and its automated review has not finished',
                    terminal: false,
                };
            case 'staged':
                return {
                    cls: 'staged',
                    detail: 'awaiting maintainer approval on npm',
                    terminal: true,
                };
            case 'blocked':
                return {
                    cls: 'blocked',
                    detail: 'failed npm automated validation',
                    terminal: true,
                };
            case 'deleted':
                return { cls: 'deleted', detail: 'deleted on npm', terminal: true };
            case 'published':
                return {
                    cls: 'published-lagging',
                    detail: 'npm reports it published; the install document does not serve it yet',
                    terminal: false,
                };
        }
    }
    if (probe.reason === 'not-found') {
        return {
            cls: 'missing',
            detail: `the registry has no such version (${probe.detail}); the PUT did not land`,
            terminal: true,
        };
    }
    return {
        cls: 'unchecked',
        detail: `not served (read-back: ${verdict}); ${whyUnchecked(probe)}`,
        terminal: false,
    };
}

/** The class as a human label for tables. */
export function describeClass(cls: UnservedClass): string {
    switch (cls) {
        case 'validating':
            return 'validating (npm automated review pending)';
        case 'staged':
            return 'staged (needs maintainer approval)';
        case 'blocked':
            return 'blocked (failed automated validation)';
        case 'deleted':
            return 'deleted';
        case 'published-lagging':
            return 'published, not yet served';
        case 'missing':
            return 'missing (never recorded)';
        case 'unchecked':
            return 'not served (status not checked)';
    }
}
