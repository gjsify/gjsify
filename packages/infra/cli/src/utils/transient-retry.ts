// Bounded retry for npm-side TRANSIENT failures, shared by the publish PUT and the OIDC exchange.
//
// THE INCIDENT (release run 39737673761, v0.64.3). During an npm incident the registry answered
// the FIRST PUT of the sweep (`@gjsify/adwaita-core`) with `503 {"error":"Service Unavailable"}`.
// `gjsify publish` retried only the OTP challenge, so it exited 1, `foreach --exec` threw on the
// non-zero child, and the sweep stopped with 0 of 232 packages published. The OIDC exchange
// already retried a 503 (v0.7.3, `@gjsify/process`); the PUT never did.
//
// A 5xx after a PUT may still have LANDED, so a retry is only safe because the caller treats the
// answer to the retried PUT idempotently (409 / 403 "previously published" → the republish path).

/** HTTP statuses worth retrying — npm-side transient/overload conditions. */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

export const isTransientStatus = (status: number): boolean => TRANSIENT_STATUSES.has(status);

/** Longest single wait, whether it came from the backoff or from a `Retry-After`. */
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Milliseconds a `Retry-After` header asks for: delta-seconds or an HTTP date. `undefined` when
 * absent or unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** The wait before retry `attempt` (0-based): `Retry-After` if the server sent one, else doubling backoff; capped. */
export function retryDelayMs(attempt: number, baseMs: number, retryAfter?: string | null): number {
    const asked = parseRetryAfter(retryAfter);
    return Math.min(asked ?? baseMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

export interface TransientRetryOptions {
    /** Retries after the first attempt. Default {@link DEFAULT_TRANSIENT_RETRIES}. */
    retries?: number;
    /** Base backoff in ms, doubling per attempt. Default {@link DEFAULT_TRANSIENT_BASE_MS}. Tests pass 0. */
    baseMs?: number;
    sleep?: (ms: number) => Promise<void>;
    log?: (msg: string) => void;
}

/**
 * Five retries at 2/4/8/16/30 s: ~60 s of patience per package. Long enough to ride out a blip,
 * short enough that a real outage fails the sweep in a minute instead of stalling 232 packages
 * behind it — the failure is then a red job, recovered by a re-run (`--tolerate-republish`).
 */
export const DEFAULT_TRANSIENT_RETRIES = 5;
export const DEFAULT_TRANSIENT_BASE_MS = 2000;

export interface TransientRetryResult {
    response: Response;
    /** How many retries were spent; >0 means an earlier attempt may have landed. */
    retried: number;
}

/**
 * Run `doFetch`, retrying a thrown network error or a transient status. Returns the last response
 * once the budget is spent (the caller interprets the 5xx); rethrows the last network error.
 */
export async function fetchWithTransientRetry(
    doFetch: () => Promise<Response>,
    opts: TransientRetryOptions = {},
): Promise<TransientRetryResult> {
    const retries = opts.retries ?? DEFAULT_TRANSIENT_RETRIES;
    const baseMs = opts.baseMs ?? DEFAULT_TRANSIENT_BASE_MS;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
        let response: Response | undefined;
        let failure: unknown;
        try {
            response = await doFetch();
        } catch (err) {
            failure = err;
        }
        if (response && !isTransientStatus(response.status)) return { response, retried: attempt };
        if (attempt >= retries) {
            if (response) return { response, retried: attempt };
            throw failure;
        }
        const delay = retryDelayMs(attempt, baseMs, response?.headers.get('retry-after'));
        const what = response
            ? `${response.status} ${response.statusText}`
            : `network error: ${failure instanceof Error ? failure.message : String(failure)}`;
        opts.log?.(`transient ${what} (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`);
        await sleep(delay);
    }
}
