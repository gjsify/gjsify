// Tarball download with SRI integrity verification.

import { buildHeaders } from './auth.js';
import { IntegrityError } from './errors.js';
import { verifyIntegrity } from './integrity.js';
import { fetchWithRetry } from './retry.js';
import type { FetchOptions } from './types.js';

/** Download a tarball as bytes. Verifies SRI `integrity` when supplied. */
export async function fetchTarball(url: string, opts: FetchOptions & { integrity?: string } = {}): Promise<Uint8Array> {
    // Tarballs stay `identity`: a `.tgz` is already gzipped, and transport-gzip
    // would change the raw bytes `verifyIntegrity` checks the SRI against.
    const headers = buildHeaders(url, { ...opts, acceptEncoding: 'identity' });
    headers['accept'] ??= 'application/octet-stream';

    // `read`, not a read after the call: a tarball is the body most likely to be
    // dropped part-way, and outside the retried region that throws unretried.
    const buf = await fetchWithRetry(
        url,
        { headers, signal: opts.signal },
        {
            fetch: opts.fetch,
            retries: opts.retries,
            retryDelayMs: opts.retryDelayMs,
            timeoutMs: opts.timeoutMs,
            onRetry: opts.onRetry,
            // A tarball URL came from a resolved packument, so a 404 on the
            // `.tgz` is a transient CDN hiccup, not a missing artifact — retry it.
            retryNotFound: opts.retryNotFound ?? true,
            read: async (res: Response) => {
                // Reached only on a final status; a retryable one with attempts
                // left never gets here.
                if (!res.ok) throw new Error(`tarball GET ${url} -> ${res.status} ${res.statusText}`);
                return new Uint8Array(await res.arrayBuffer());
            },
        },
    );
    // Integrity stays OUTSIDE `read`: a mismatch is not a transport fault, and
    // raised inside it the bytes would be re-fetched before anyone was told.
    if (opts.integrity) {
        const ok = await verifyIntegrity(buf, opts.integrity);
        if (!ok) throw new IntegrityError(url, opts.integrity);
    }
    return buf;
}
