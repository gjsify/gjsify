// npm registry client for the gjsify install backend.
// Cross-platform (Node + GJS) - uses globalThis.fetch + SubtleCrypto only.
// Reference: refs/npm-cli/workspaces/libnpmfetch + refs/bun/src/install/npm.zig.

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

export interface NpmrcConfig {
    /** Default registry URL (trailing slash kept as written). */
    registry: string;
    /** Registry overrides per scope: `{"@scope": "https://registry/"}`. */
    scopes: Record<string, string>;
    /** Auth tokens keyed by `//host/path/:` prefix (npm convention). */
    authTokens: Record<string, string>;
    /** Basic-auth credentials keyed by host prefix. */
    basicAuth: Record<string, { username: string; password: string }>;
}

/** Distribution metadata for a single version. */
export interface PackumentDist {
    tarball: string;
    integrity?: string;
    shasum?: string;
}

/** Single version record inside a packument. */
export interface PackumentVersion {
    name: string;
    version: string;
    dist: PackumentDist;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    deprecated?: string;
    [key: string]: unknown;
}

/** Top-level packument shape returned by `GET /<pkg>`. */
export interface Packument {
    name: string;
    'dist-tags': Record<string, string>;
    versions: Record<string, PackumentVersion>;
    time?: Record<string, string>;
    [key: string]: unknown;
}

export interface FetchOptions {
    /** Override registry URL. Default: $npm_config_registry || DEFAULT_REGISTRY. */
    registry?: string;
    /** Pre-parsed .npmrc; if omitted, no auth is sent. */
    npmrc?: NpmrcConfig;
    /** Pre-built header map (overrides anything else). */
    headers?: Record<string, string>;
    /** AbortSignal forwarded to fetch. */
    signal?: AbortSignal;
    /** Custom fetch implementation; default = globalThis.fetch. */
    fetch?: typeof fetch;
    /**
     * Max retry attempts on transient failures (network errors, TLS handshake
     * resets, 5xx, 408, 429). Default 3 → up to 4 total attempts. Set to 0
     * to disable retry.
     */
    retries?: number;
    /**
     * Initial backoff in ms; doubles per attempt. Default 250 → 250, 500, 1000.
     * The cap is 8s per delay so a bad spell stays bounded.
     */
    retryDelayMs?: number;
    /**
     * Per-request timeout in ms. Default 30000 (30s). Set to 0 to disable.
     *
     * Guards against the reachable-but-slow registry case where TCP connect
     * succeeds but the response body never finishes — a single packument
     * fetch would otherwise await indefinitely with no resource cleanup,
     * no error message, no progress (the exact shape of an observed
     * `gjsify install` hang). A timeout fires an AbortError that the retry
     * loop treats as transient (CDN slowdowns recover), so a slow attempt
     * gets retried per the retries / retryDelayMs schedule. When ALL
     * retries exhaust because of timeouts, a `RegistryTimeoutError` is
     * thrown with a clear "timed out after Xs × N attempts" message.
     */
    timeoutMs?: number;
    /**
     * Called once per retry with `{ attempt, error, delayMs }`. Useful for
     * verbose-mode install logs ("retrying fetch in 500 ms…").
     */
    onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

/** Strict-validate a packument shape. Throws on schema mismatch. */
export function assertPackument(name: string, body: unknown): asserts body is Packument {
    if (!body || typeof body !== 'object') {
        throw new TypeError(`registry: ${name} packument is not an object`);
    }
    const p = body as Record<string, unknown>;
    if (typeof p.name !== 'string') {
        throw new TypeError(`registry: ${name} packument missing string name`);
    }
    if (!p.versions || typeof p.versions !== 'object') {
        throw new TypeError(`registry: ${name} packument missing versions map`);
    }
}

/** Pick the right registry URL for a package name (scoped overrides win). */
export function registryFor(name: string, npmrc: NpmrcConfig | undefined): string {
    if (npmrc && name.startsWith('@')) {
        const scope = name.slice(0, name.indexOf('/'));
        const override = npmrc.scopes[scope];
        if (override) return ensureTrailingSlash(override);
    }
    if (npmrc?.registry) return ensureTrailingSlash(npmrc.registry);
    return DEFAULT_REGISTRY;
}

/** Build the GET URL for a packument. Handles `@scope/name` URL-encoding. */
export function packumentUrl(name: string, registry: string): string {
    const base = ensureTrailingSlash(registry);
    if (name.startsWith('@')) {
        const slash = name.indexOf('/');
        if (slash < 0) throw new TypeError(`Invalid scoped package name: ${name}`);
        const scope = name.slice(0, slash);
        const rest = name.slice(slash + 1);
        return `${base}${encodeURIComponent(scope)}/${encodeURIComponent(rest)}`;
    }
    return `${base}${encodeURIComponent(name)}`;
}

/** Outcome of a conditional packument fetch ({@link fetchPackumentConditional}). */
export interface ConditionalPackument {
    /** `'fresh'` — the registry returned a new body (200). `'not-modified'` —
     *  a 304, so the caller's cached copy is still current. */
    status: 'fresh' | 'not-modified';
    /** Parsed packument. Present iff `status === 'fresh'`. */
    packument?: Packument;
    /** The response `ETag`, to store alongside a freshly-fetched body. On a
     *  304 this echoes back the `ifNoneMatch` the caller sent (still current). */
    etag?: string;
}

/**
 * Conditional packument fetch with ETag revalidation.
 *
 * When `ifNoneMatch` is supplied it is sent as `If-None-Match`; a `304 Not
 * Modified` resolves to `{ status: 'not-modified' }` (no body transferred — the
 * caller reuses its cached packument), and a `200` resolves to `{ status:
 * 'fresh', packument, etag }`. Without `ifNoneMatch` it behaves like
 * {@link fetchPackument} but additionally surfaces the response ETag so the
 * caller can seed a cache.
 *
 * Why revalidation rather than a TTL: packuments are mutable (new versions
 * publish over time), so a TTL cache would serve stale data and silently miss
 * a just-published version; a conditional GET keeps a cheap round-trip but
 * skips the (60–98 KB, `accept-encoding: identity`) body when nothing changed.
 * Reference: npm's make-fetch-happen HTTP-cache layer.
 */
export async function fetchPackumentConditional(
    name: string,
    opts: FetchOptions & { ifNoneMatch?: string } = {},
): Promise<ConditionalPackument> {
    const registry = opts.registry ?? registryFor(name, opts.npmrc);
    const url = packumentUrl(name, registry);
    const headers = buildHeaders(url, opts);
    headers['accept'] ??= 'application/vnd.npm.install-v1+json';
    if (opts.ifNoneMatch) headers['if-none-match'] = opts.ifNoneMatch;

    const res = await fetchWithRetry(
        url,
        { headers, signal: opts.signal },
        {
            fetch: opts.fetch,
            retries: opts.retries,
            retryDelayMs: opts.retryDelayMs,
            timeoutMs: opts.timeoutMs,
            onRetry: opts.onRetry,
        },
    );
    if (res.status === 304) {
        // 304 is not `res.ok`; fetchWithRetry returns it un-retried because
        // isRetryableStatus(304) is false. Drain any (empty) body so the
        // connection can be reused.
        try {
            await res.arrayBuffer();
        } catch {
            /* empty 304 body — nothing to drain */
        }
        return { status: 'not-modified', etag: opts.ifNoneMatch };
    }
    if (!res.ok) {
        // 404 = package not found. 406 = Not Acceptable — npm returns this
        // when the URL path is unrecognised (e.g. `%40scope/name` is parsed
        // as a sub-path of the synthetic `%40scope` resource rather than a
        // scoped package name). Both indicate the package is not addressable
        // in this registry and should surface as PackageNotFoundError so
        // optional deps are silently skipped and required-dep errors are
        // reported consistently.
        if (res.status === 404 || res.status === 406) throw new PackageNotFoundError(name, url);
        throw new Error(`registry GET ${url} -> ${res.status} ${res.statusText}`);
    }
    const etag = res.headers.get('etag') ?? undefined;
    const body = (await res.json()) as unknown;
    assertPackument(name, body);
    return { status: 'fresh', packument: body, etag };
}

/** Fetch + parse a packument. Retries on transient errors (see fetchWithRetry). */
export async function fetchPackument(name: string, opts: FetchOptions = {}): Promise<Packument> {
    // Delegate to the conditional path with no `ifNoneMatch`, so the registry
    // always returns a fresh body (a 304 to an unconditional request would be a
    // protocol violation — guard defensively).
    const result = await fetchPackumentConditional(name, opts);
    if (!result.packument) {
        throw new Error(`registry: ${name} returned 304 Not Modified to an unconditional request`);
    }
    return result.packument;
}

/** Download a tarball as bytes. Verifies SRI `integrity` when supplied. */
export async function fetchTarball(url: string, opts: FetchOptions & { integrity?: string } = {}): Promise<Uint8Array> {
    const headers = buildHeaders(url, opts);
    headers['accept'] ??= 'application/octet-stream';

    const res = await fetchWithRetry(
        url,
        { headers, signal: opts.signal },
        {
            fetch: opts.fetch,
            retries: opts.retries,
            retryDelayMs: opts.retryDelayMs,
            timeoutMs: opts.timeoutMs,
            onRetry: opts.onRetry,
        },
    );
    if (!res.ok) throw new Error(`tarball GET ${url} -> ${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (opts.integrity) {
        const ok = await verifyIntegrity(buf, opts.integrity);
        if (!ok) throw new IntegrityError(url, opts.integrity);
    }
    return buf;
}

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
 *     caller's PackageNotFoundError path)
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
    init: { headers: Record<string, string>; signal?: AbortSignal },
    opts: Pick<FetchOptions, 'fetch' | 'retries' | 'retryDelayMs' | 'timeoutMs' | 'onRetry'>,
): Promise<Response> {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('@gjsify/npm-registry: globalThis.fetch is missing');

    const maxRetries = Math.max(0, opts.retries ?? 3);
    const baseDelay = Math.max(0, opts.retryDelayMs ?? 250);
    const timeoutMs = Math.max(0, opts.timeoutMs ?? 30_000);
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
            if (res.ok || !isRetryableStatus(res.status) || attempt >= maxRetries) {
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

/**
 * Verify an SRI string (e.g. `sha512-base64==`) against bytes.
 * Multiple hashes (space-separated) accepted; any match passes.
 */
export async function verifyIntegrity(data: Uint8Array, integrity: string): Promise<boolean> {
    const parts = integrity.trim().split(/\s+/);
    for (const part of parts) {
        const dash = part.indexOf('-');
        if (dash < 0) continue;
        const algo = part.slice(0, dash).toLowerCase();
        const expected = part.slice(dash + 1);
        const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
        if (!subtle) throw new Error('@gjsify/npm-registry: globalThis.crypto.subtle is missing');
        const algoName = subriToWebCryptoAlgo(algo);
        if (!algoName) continue;
        const digest = await subtle.digest(algoName, dataAsArrayBuffer(data));
        const got = bytesToBase64(new Uint8Array(digest));
        if (got === expected) return true;
    }
    return false;
}

function subriToWebCryptoAlgo(sri: string): 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | null {
    switch (sri) {
        case 'sha1':
            return 'SHA-1';
        case 'sha256':
            return 'SHA-256';
        case 'sha384':
            return 'SHA-384';
        case 'sha512':
            return 'SHA-512';
        default:
            return null;
    }
}

function dataAsArrayBuffer(data: Uint8Array): ArrayBuffer {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer as ArrayBuffer;
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    // Standard base64 — no URL-safe variant. Cross-platform: btoa exists in
    // both Node and GJS (the latter via @gjsify/web-globals).
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

/** Parse a `.npmrc` text body. Unknown keys are kept on the result for callers. */
export function parseNpmrc(text: string): NpmrcConfig {
    const out: NpmrcConfig & { [k: string]: unknown } = {
        registry: DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    const lines = text.split(/\r?\n/);
    const basic: Record<string, { user?: string; pass?: string }> = {};
    for (const raw of lines) {
        const line = raw.replace(/^\s+|\s+$/g, '');
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = expandEnv(stripQuotes(line.slice(eq + 1).trim()));
        if (key === 'registry') {
            out.registry = ensureTrailingSlash(value);
            continue;
        }
        const scopeRegistry = key.match(/^(@[^:]+):registry$/);
        if (scopeRegistry) {
            out.scopes[scopeRegistry[1]] = ensureTrailingSlash(value);
            continue;
        }
        const tokenMatch = key.match(/^\/\/(.+):_authToken$/);
        if (tokenMatch) {
            out.authTokens[normalizeAuthHost(tokenMatch[1])] = value;
            continue;
        }
        const userMatch = key.match(/^\/\/(.+):username$/);
        if (userMatch) {
            (basic[normalizeAuthHost(userMatch[1])] ??= {}).user = value;
            continue;
        }
        const passMatch = key.match(/^\/\/(.+):_password$/);
        if (passMatch) {
            const decoded = base64Decode(value);
            (basic[normalizeAuthHost(passMatch[1])] ??= {}).pass = decoded;
            continue;
        }
    }
    for (const [host, creds] of Object.entries(basic)) {
        if (creds.user && creds.pass !== undefined) {
            out.basicAuth[host] = { username: creds.user, password: creds.pass };
        }
    }
    return out;
}

/** Build auth + UA headers for a request URL. Pure (no I/O). */
export function buildHeaders(url: string, opts: FetchOptions): Record<string, string> {
    const headers: Record<string, string> = {
        'user-agent': 'gjsify-install/0.3.7',
        // Disable transparent gzip negotiation. Under GJS, libsoup's chunked-
        // decoder raises G_IO_ERROR_PARTIAL_INPUT at the tail of npm CDN
        // gzipped responses (the upstream closes the TCP connection at a
        // non-chunk boundary). Requesting identity avoids the entire chunked-
        // gzip code path. Bandwidth cost is negligible for our payloads
        // (~64 KB packuments).
        'accept-encoding': 'identity',
    };
    if (opts.npmrc) {
        const auth = resolveAuthForUrl(url, opts.npmrc);
        if (auth) headers['authorization'] = auth;
    }
    if (opts.headers) {
        for (const [k, v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v;
    }
    return headers;
}

/** Resolve an `Authorization` header for a URL given a parsed .npmrc. */
export function resolveAuthForUrl(url: string, npmrc: NpmrcConfig): string | null {
    const u = new URL(url);
    // npm matches keys against the URL by walking from the deepest path back to
    // the host root, picking the longest prefix match.
    const candidates = pathPrefixes(u);
    for (const prefix of candidates) {
        const token = npmrc.authTokens[prefix];
        if (token) return `Bearer ${token}`;
        const basic = npmrc.basicAuth[prefix];
        if (basic) {
            const enc = btoa(`${basic.username}:${basic.password}`);
            return `Basic ${enc}`;
        }
    }
    return null;
}

function pathPrefixes(u: URL): string[] {
    // Walk the URL path from deepest to shallowest. Match npm's nerf-dart
    // convention of NO trailing slash on stored keys: `//host`, `//host/api`,
    // `//host/api/npm`. Keys with trailing slashes are normalized in
    // parseNpmrc so a longest-prefix scan compares apples to apples.
    const segments = u.pathname.split('/').filter(Boolean);
    const prefixes: string[] = [];
    for (let i = segments.length; i >= 0; i--) {
        const tail = segments.slice(0, i).join('/');
        prefixes.push(tail ? `//${u.host}/${tail}` : `//${u.host}`);
    }
    return prefixes;
}

function normalizeAuthHost(captured: string): string {
    // npm strips the trailing slash from `//host/path/:_authToken` keys so the
    // path-prefix matcher can compare host-rooted ("//host") and nested
    // ("//host/path") entries on the same axis.
    const trimmed = captured.replace(/\/+$/, '');
    return `//${trimmed}`;
}

function ensureTrailingSlash(s: string): string {
    return s.endsWith('/') ? s : s + '/';
}

function stripQuotes(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

function expandEnv(s: string): string {
    // Handles `${VAR}` only — npm config does not support `$VAR`.
    return s.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => {
        const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
        return env?.[name] ?? '';
    });
}

function base64Decode(s: string): string {
    return atob(s);
}

/**
 * Result of `whoami(registry, npmrc)` — the npm registry's `/-/whoami`
 * endpoint returns `{"username": "<name>"}` for a live bearer token and an
 * empty object `{}` for a token that the registry no longer accepts (dead /
 * revoked / expired). The status code stays 200 in both cases; the empty
 * body is npm's signal that the bearer was rejected.
 *
 * `gjsify publish` uses this distinction to give a clear diagnostic when a
 * PUT publish call returns 404 Not Found / body "Not Found" — the typical
 * dead-token shape that's easily mistaken for a "package does not exist"
 * (Trusted-Publisher-bootstrap) situation.
 */
export interface WhoamiResult {
    /** Username when the token is live. Absent (or empty string) when dead. */
    username?: string;
}

/**
 * GET `<registry>/-/whoami` with the bearer/basic Authorization derived from
 * `npmrc`. Returns the parsed body on 2xx (`{username}` for a live token,
 * `{}` for a dead one — both are 200 responses). **Throws** on network
 * failures, non-2xx status, or unparseable bodies — the caller must handle
 * the "couldn't probe" path explicitly (typically: fall back to the
 * generic error message).
 *
 * Reference: `npm whoami` (refs/npm-cli/lib/commands/whoami.js) — the
 * endpoint is documented as a registry-API canonical method.
 */
export async function whoami(registry: string, npmrc: NpmrcConfig | undefined): Promise<WhoamiResult> {
    const base = ensureTrailingSlash(registry);
    const url = `${base}-/whoami`;
    const headers = buildHeaders(url, { npmrc });
    headers['accept'] = 'application/json';
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl) throw new Error('@gjsify/npm-registry: globalThis.fetch is missing');
    const res = await fetchImpl(url, { method: 'GET', headers });
    if (!res.ok) {
        throw new Error(`whoami GET ${url} -> ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object' && 'username' in (body as Record<string, unknown>)) {
        const u = (body as Record<string, unknown>).username;
        if (typeof u === 'string' && u.length > 0) return { username: u };
    }
    return {};
}

export class PackageNotFoundError extends Error {
    constructor(
        public readonly name: string,
        public readonly url: string,
    ) {
        super(`Package not found in registry: ${name} (${url})`);
        this.name = 'PackageNotFoundError';
    }
}

export class IntegrityError extends Error {
    constructor(
        public readonly url: string,
        public readonly integrity: string,
    ) {
        super(`Tarball integrity mismatch for ${url} (expected ${integrity})`);
        this.name = 'IntegrityError';
    }
}

/**
 * Thrown when EVERY retry attempt against a registry URL exhausts the
 * per-request timeout (`opts.timeoutMs`, default 30s). Replaces the
 * inscrutable "signal is aborted without reason" the raw AbortSignal path
 * would otherwise surface — `gjsify install` users seeing this know exactly
 * what timed out, how long they waited, and that the CDN is the suspect.
 */
export class RegistryTimeoutError extends Error {
    constructor(
        public readonly url: string,
        public readonly timeoutMs: number,
        public readonly attempts: number,
    ) {
        const seconds = Math.round(timeoutMs / 100) / 10;
        const totalSeconds = Math.round((timeoutMs * attempts) / 100) / 10;
        super(
            `@gjsify/npm-registry: GET ${url} timed out after ${seconds}s × ${attempts} attempt(s) ` +
                `(total ~${totalSeconds}s). This usually means the registry CDN is slow or unreachable.`,
        );
        this.name = 'RegistryTimeoutError';
    }
}
