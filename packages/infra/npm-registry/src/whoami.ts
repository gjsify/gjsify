// `GET <registry>/-/whoami` — the npm auth-token liveness probe.

import { buildHeaders } from './auth.js';
import { ensureTrailingSlash } from './npmrc.js';
import type { NpmrcConfig } from './types.js';

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
