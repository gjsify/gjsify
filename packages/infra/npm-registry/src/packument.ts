// Packument (package metadata) URLs, validation, and fetching — including the
// conditional ETag-revalidating variant used by the install packument cache.

import { buildHeaders } from './auth.js';
import { PackageNotFoundError } from './errors.js';
import { ensureTrailingSlash, registryFor } from './npmrc.js';
import { fetchWithRetry } from './retry.js';
import type { FetchOptions, Packument } from './types.js';

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

/**
 * The two `accept` strings pacote sends, copied verbatim from
 * `refs/npm-cli/node_modules/pacote/lib/registry.js` (`corgiDoc` / `fullDoc`).
 *
 * `CORGI_ACCEPT` is a q-list, not a single type, and that matters twice over.
 * It asks for the abbreviated install document first, but tells the server it
 * will take `application/json` (q=0.8) or anything at all — so a registry that
 * does not implement the npm-specific media type answers with a full packument
 * instead of refusing. That is what makes the `406 Not Acceptable` fallback
 * below RARE rather than the norm on third-party registries (Verdaccio,
 * Artifactory, a `file:`-backed mock), which is where the single-type header we
 * used to send made every fetch a coin flip on server configuration.
 *
 * `FULL_ACCEPT` deliberately has no q-list: when the caller escalated because
 * it needs a field only the full document carries (`libc`), silently accepting
 * an abbreviated body would defeat the escalation.
 */
const CORGI_ACCEPT = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';
const FULL_ACCEPT = 'application/json';

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
 *
 * `opts.fullMetadata` selects the full document (see {@link FetchOptions}). An
 * `ifNoneMatch` passed alongside it MUST be the ETag of a previously-fetched
 * FULL body — the registry versions the two shapes independently, so mixing
 * them turns a 304 into "here is the other document, unchanged".
 */
export async function fetchPackumentConditional(
    name: string,
    opts: FetchOptions & { ifNoneMatch?: string } = {},
): Promise<ConditionalPackument> {
    const registry = opts.registry ?? registryFor(name, opts.npmrc);
    const url = packumentUrl(name, registry);
    // Packuments are JSON — request gzip (~4× smaller); the fetch layer
    // decompresses transparently on both Node and GJS (see buildHeaders).
    const headers = buildHeaders(url, { ...opts, acceptEncoding: 'gzip' });
    headers['accept'] ??= opts.fullMetadata ? FULL_ACCEPT : CORGI_ACCEPT;
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
        // 404 = package not found. 406 = Not Acceptable — with the q-list
        // `accept` above a registry that simply lacks the abbreviated document
        // no longer answers 406 (it falls back to `application/json`), so what
        // remains here is the addressability case: npm returns 406 when the URL
        // path is unrecognised (e.g. `%40scope/name` is parsed
        // as a sub-path of the synthetic `%40scope` resource rather than a
        // scoped package name). Both indicate the package is not addressable
        // in this registry and should surface as PackageNotFoundError so
        // optional deps are silently skipped and required-dep errors are
        // reported consistently.
        if (res.status === 404 || res.status === 406) throw new PackageNotFoundError(name, url);
        throw new Error(`registry GET ${url} -> ${res.status} ${res.statusText}`);
    }
    const etag = res.headers.get('etag') ?? undefined;
    const body = await decodeJsonBody(res);
    assertPackument(name, body);
    return { status: 'fresh', packument: body, etag };
}

/**
 * Read a JSON response body. fetch() transparently decompresses Content-Encoding:
 * gzip (buffer-first via Blob.stream().pipeThrough, robust against libsoup's
 * partial-input at stream close), so this always receives plain JSON.
 */
async function decodeJsonBody(res: Response): Promise<unknown> {
    return res.json();
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
