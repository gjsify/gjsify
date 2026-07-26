// Shared shapes for the npm registry client: parsed `.npmrc` config, packument
// records, and the common per-request `FetchOptions`. Type-only module — no
// runtime code, so every other module can depend on it without creating an edge
// between feature modules.

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
    /**
     * Treat HTTP 404 as a transient (retryable) failure rather than a hard
     * "not found". Default false. Opt in for TARBALL fetches: a tarball URL
     * already came from a successfully-resolved packument, so a 404 on the
     * `.tgz` is a registry/CDN hiccup under load (observed on heavy parallel
     * `@girs/*` installs — npm itself fails the same way) rather than a
     * genuinely-missing artifact. Packument 404s must stay permanent (the
     * package really doesn't exist), so leave this false there.
     */
    retryNotFound?: boolean;
}
