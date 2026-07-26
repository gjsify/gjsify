// Exponential-backoff retry + per-request timeout around a single registry GET.

import { RegistryTimeoutError } from './errors.js';
import type { FetchOptions } from './types.js';

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
 *
 * Does NOT retry on:
 *   - 4xx other than 408/425/429 (semantic errors — 404 surfaces via the
 *     caller's PackageNotFoundError path) UNLESS `opts.retryNotFound` is set,
 *     which `fetchTarball` enables so a transient CDN 404 on a `.tgz` (whose
 *     URL already came from a resolved packument) is retried like any blip
 *   - AbortError from the CALLER's signal (`opts.signal` — caller wants out)
 *   - any other thrown shape that doesn't look transient
 *
 * Default schedule: 250ms, 500ms, 1000ms (3 retries → 4 total attempts);
 * capped at 8s per delay. Caller can tune via opts.retries / opts.retryDelayMs
 * / opts.timeoutMs.
 *
 * When ALL retries exhaust because of per-request timeouts, throws a
 * typed `RegistryTimeoutError` (not the raw "signal is aborted without
 * reason" the underlying fetch would surface) so the user gets a clear
 * "<url> timed out after Xs × N attempts" message.
 */
export async function fetchWithRetry(
    url: string,
    // `compress` is forwarded verbatim to the fetch impl. On @gjsify/fetch
    // (GJS) `compress: false` disables transparent gzip decoding so the caller
    // can buffer-then-gunzip itself; Node's undici ignores the field.
    init: { headers: Record<string, string>; signal?: AbortSignal; compress?: boolean },
    opts: Pick<FetchOptions, 'fetch' | 'retries' | 'retryDelayMs' | 'timeoutMs' | 'onRetry' | 'retryNotFound'>,
): Promise<Response> {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('@gjsify/npm-registry: globalThis.fetch is missing');

    const maxRetries = Math.max(0, opts.retries ?? 3);
    const baseDelay = Math.max(0, opts.retryDelayMs ?? 250);
    const timeoutMs = Math.max(0, opts.timeoutMs ?? 30_000);
    const retryNotFound = opts.retryNotFound ?? false;
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
                return res;
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
                if (!isRetryableError(err) || attempt >= maxRetries) throw err;
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
