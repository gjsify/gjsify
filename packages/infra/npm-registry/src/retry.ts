// Exponential-backoff retry + per-request timeout around a single registry GET.

import { RegistryTimeoutError, RegistryUnreachableError } from './errors.js';
import type { FetchOptions } from './types.js';

/** `compress` is forwarded verbatim to the fetch impl. On @gjsify/fetch (GJS)
 * `compress: false` disables transparent gzip decoding so the caller can
 * buffer-then-gunzip itself; Node's undici ignores the field. */
type RetryInit = { headers: Record<string, string>; signal?: AbortSignal; compress?: boolean };

type RetryOpts = Pick<FetchOptions, 'fetch' | 'retries' | 'retryDelayMs' | 'timeoutMs' | 'onRetry' | 'retryNotFound'>;

/**
 * Wrap a single GET in exponential-backoff retry for transient failures.
 *
 * Retries on:
 *   - network-layer errors thrown by `fetch` (TypeError "fetch failed",
 *     `Gio.TlsError` from Soup-backed GJS fetch when the registry CDN drops
 *     the TLS handshake mid-stream, ECONNRESET, ENETUNREACH, …)
 *   - HTTP 408 (Request Timeout), 425 (Too Early), 429 (rate limit),
 *     500-503, 504, 522, 524 (Cloudflare upstream)
 *   - per-request timeout (opts.timeoutMs, default 30s) — the AbortError
 *     surfaced by a fired timeout signal is treated as transient (slow
 *     CDN) and retried like any other network blip; distinguished from
 *     a caller-triggered abort via the abort signal's `reason` identity.
 *   - a body that stops arriving mid-stream, but ONLY when the caller passes
 *     `opts.read` (see below)
 *
 * Does NOT retry on:
 *   - 4xx other than 408/425/429 (semantic errors — 404 surfaces via the
 *     caller's PackageNotFoundError path) UNLESS `opts.retryNotFound` is set,
 *     which `fetchTarball` enables so a transient CDN 404 on a `.tgz` (whose
 *     URL already came from a resolved packument) is retried like any blip
 *   - AbortError from the CALLER's signal (`opts.signal` — caller wants out)
 *   - any other thrown shape that doesn't look transient
 *
 * `opts.read` brings the BODY inside the retried region. Without it this
 * returns once the HEADERS are in, so a caller's `res.arrayBuffer()` /
 * `res.json()` runs outside every retry and a connection dying mid-body throws
 * there, unretried.
 *
 * Keep VALIDATION out of `read` (`assertPackument`, SRI): `assertPackument`
 * throws `TypeError`, which {@link isRetryableError} reads as transient, so a
 * malformed packument would spend the whole budget and then be reported as a
 * network fault. `read` covers transport; the caller checks what arrived.
 *
 * Default schedule: 1s, 2s, 4s, 8s, 8s (5 retries → 6 attempts, ~23s of
 * patience), capped at 8s per delay. Tunable via opts.retries /
 * opts.retryDelayMs / opts.timeoutMs. The previous 250/500/1000ms was two
 * orders of magnitude under npm, whose defaults (`fetch-retries=2`,
 * `fetch-retry-mintimeout=10s`, `fetch-retry-factor=10`) wait ~70s, and pnpm
 * ships npm's numbers. A cold install fans the whole dependency closure out at
 * 16-way concurrency for minutes, so a blip need only outlast the budget ONCE
 * to fail the run: this repository's macOS CI went red that way on 2026-09-08,
 * at 32% of an `install --immutable`, on a single `fetch failed`.
 *
 * When ALL retries exhaust, throws a typed error naming the URL and the
 * attempts spent instead of whatever shape the runtime hands us:
 * `RegistryTimeoutError` for per-request timeouts, `RegistryUnreachableError`
 * (original error as `cause`) at the network layer. An unattributed
 * `fetch failed` does not say which request of an install died, or how hard it
 * was tried.
 */
export async function fetchWithRetry(url: string, init: RetryInit, opts: RetryOpts): Promise<Response>;
export async function fetchWithRetry<T>(
    url: string,
    init: RetryInit,
    opts: RetryOpts & { read: (res: Response) => Promise<T> },
): Promise<T>;
export async function fetchWithRetry<T>(
    url: string,
    init: RetryInit,
    opts: RetryOpts & { read?: (res: Response) => Promise<T> },
): Promise<T | Response> {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('@gjsify/npm-registry: globalThis.fetch is missing');

    const maxRetries = Math.max(0, opts.retries ?? 5);
    const baseDelay = Math.max(0, opts.retryDelayMs ?? 1000);
    const timeoutMs = Math.max(0, opts.timeoutMs ?? 30_000);
    const retryNotFound = opts.retryNotFound ?? false;
    const startedAt = Date.now();
    let attempt = 0;
    let lastErr: unknown;
    let timeoutHits = 0;

    while (true) {
        if (init.signal?.aborted) throw signalAbortError(init.signal);

        // Per-attempt timeout controller — re-armed each retry so a slow
        // response on attempt N doesn't pre-fire the abort on attempt N+1.
        // Using a manual controller (rather than `AbortSignal.timeout`) lets
        // us tell timeout-from-here apart from abort-from-caller by inspecting
        // `timeoutController.signal.aborted` after the fetch throws — caller-
        // aborts must NOT retry but timeouts MUST.
        const timeoutController = timeoutMs > 0 ? new AbortController() : null;
        const timeoutId =
            timeoutController !== null
                ? setTimeout(
                      () =>
                          timeoutController.abort(
                              new Error(`@gjsify/npm-registry: per-request timeout ${timeoutMs}ms`),
                          ),
                      timeoutMs,
                  )
                : null;
        const composedSignal = composeSignals(init.signal, timeoutController?.signal);

        try {
            const res = await fetchImpl(url, { ...init, signal: composedSignal });
            const retryable = isRetryableStatus(res.status) || (retryNotFound && res.status === 404);
            if (res.ok || !retryable || attempt >= maxRetries) {
                // `read` runs INSIDE the try, so a body that stops arriving
                // mid-stream is classified and retried like any other network
                // error instead of throwing at the caller, unretried.
                return opts.read ? await opts.read(res) : res;
            }
            // Drain the body so the underlying connection can be reused.
            try {
                await res.arrayBuffer();
            } catch {
                /* swallow — we're about to retry */
            }
            lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
        } catch (err) {
            // Classify the abort. Caller-aborts MUST propagate without retry;
            // timeouts MUST retry (transient — slow CDN recovers).
            //
            // The distinction: did OUR timeout fire while the caller's signal
            // is still un-aborted? If so the cause is our timeout. We check
            // signal state explicitly rather than relying on `err.name` —
            // some runtimes (GJS Soup-backed fetch) surface abort-triggered
            // fetch errors as plain Error instances with no `AbortError` name
            // marker, so a name-only test is fragile. Walking the signal-state
            // is reliable across runtimes.
            const timeoutFired = timeoutController !== null && timeoutController.signal.aborted;
            const callerAborted = init.signal?.aborted === true;
            if (timeoutFired && !callerAborted) {
                timeoutHits++;
                if (attempt >= maxRetries) {
                    throw new RegistryTimeoutError(url, timeoutMs, timeoutHits);
                }
                lastErr = err;
            } else if (callerAborted) {
                // Caller wants out — propagate as a canonical AbortError so
                // upstream `try/catch` patterns recognize the shape.
                throw signalAbortError(init.signal);
            } else {
                if (!isRetryableError(err)) throw err;
                if (attempt >= maxRetries) {
                    throw new RegistryUnreachableError(url, attempt + 1, Date.now() - startedAt, err);
                }
                lastErr = err;
            }
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
        const delayMs = Math.min(baseDelay * 2 ** attempt, 8000);
        opts.onRetry?.({ attempt: attempt + 1, error: lastErr, delayMs });
        await delay(delayMs, init.signal);
        attempt++;
    }
}

/**
 * Combine the caller's AbortSignal with our per-request timeout signal.
 * Returns whichever one is non-null when only one is supplied — avoids the
 * `AbortSignal.any` allocation when there is nothing to compose. Both null
 * also returns `undefined`, so callers that pass neither don't materialise a
 * signal at all (some fetch impls treat `signal: undefined` and the absence
 * of the field differently).
 */
function composeSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
    if (!a) return b;
    if (!b) return a;
    // `AbortSignal.any` is available in Node ≥ 20.3 and SpiderMonkey 140+
    // (current GJS baseline) — both runtimes covered by the @gjsify cross-
    // runtime portability axis. If a future regression surfaces an older
    // runtime, polyfill here.
    return AbortSignal.any([a, b]);
}

function isRetryableStatus(status: number): boolean {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status === 500 || status === 502 || status === 503 || status === 504) return true;
    // Cloudflare-specific transient codes that the npm CDN can emit when the
    // origin is briefly unreachable: 521 (web server down), 522 (timeout),
    // 524 (origin timeout), 525 (SSL handshake failed).
    if (status === 521 || status === 522 || status === 524 || status === 525) return true;
    return false;
}

function isRetryableError(err: unknown): boolean {
    // AbortError must propagate immediately so the caller's signal short-circuit
    // works as documented.
    if (err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'AbortError') {
        return false;
    }
    // Node's undici throws TypeError("fetch failed") with a `.cause` describing
    // the socket error (ECONNRESET, ENETUNREACH, UND_ERR_SOCKET, …). All of
    // those are transient.
    if (err instanceof TypeError) return true;
    // GJS Soup-backed fetch wraps libsoup failures in `FetchError`. The TLS
    // handshake-reset path the npm CDN occasionally exhibits surfaces as
    // `FetchError` with a `.message` containing "Gio.TlsError" / "TLS-Verbindung
    // wurde nicht sauber beendet" / "connection reset". Matching on the error
    // name keeps us locale-independent.
    if (err && typeof err === 'object' && 'name' in err) {
        const name = (err as { name: unknown }).name;
        if (name === 'FetchError') return true;
        if (name === 'AbortError') return false;
    }
    // Generic Error with cause we recognize (Node + undici style).
    const cause = (err as { cause?: unknown })?.cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
        const code = (cause as { code: unknown }).code;
        if (typeof code === 'string') {
            return (
                code === 'ECONNRESET' ||
                code === 'ECONNREFUSED' ||
                code === 'ENETUNREACH' ||
                code === 'ENOTFOUND' ||
                code === 'ETIMEDOUT' ||
                code === 'EAI_AGAIN' ||
                code === 'UND_ERR_SOCKET' ||
                code === 'UND_ERR_CONNECT_TIMEOUT'
            );
        }
    }
    return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(id);
            reject(signalAbortError(signal));
        };
        if (signal?.aborted) {
            clearTimeout(id);
            reject(signalAbortError(signal));
            return;
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

function signalAbortError(signal: AbortSignal | undefined): Error {
    const reason = signal && 'reason' in signal ? (signal as { reason?: unknown }).reason : undefined;
    if (reason instanceof Error) return reason;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}
