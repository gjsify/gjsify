// Request headers + `Authorization` resolution against a parsed `.npmrc`.

import type { FetchOptions, NpmrcConfig } from './types.js';

/**
 * Substituted with this package's `package.json#version` at build time by the
 * `gjsify.defineFromPackageJson` entry in our package.json (the repo's
 * compile-time-constant mechanism — `gjsify build` resolves it into
 * `bundler.transform.define`). Reading `package.json` at runtime instead would
 * force `node:fs` + `node:url` into a package that deliberately has none: the
 * whole point of `@gjsify/npm-registry` is that it needs nothing but
 * `globalThis.fetch` + `SubtleCrypto`.
 */
declare const __PACKAGE_VERSION__: string | undefined;

/**
 * `user-agent` sent on every registry request, derived from the package's own
 * version so it cannot drift from what ships (it sat at a hand-written
 * `0.3.7` until 0.22.0).
 *
 * The `typeof` guard is the documented contract for a define that did not run
 * (a raw-TS execution path, or a bundler configured without our config): the
 * identifier is then an undeclared global, and `typeof` is the only safe way
 * to probe one. Falling back to a marker version keeps the header well-formed
 * and makes such a context obvious in registry logs.
 */
const USER_AGENT = `gjsify-install/${typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0-dev'}`;

/**
 * Build auth + UA headers for a request URL. Pure (no I/O).
 *
 * `acceptEncoding` controls the `Accept-Encoding` header (default `identity`):
 *
 *   - **Packuments** pass `'gzip'` — the JSON corpus compresses ~4× and is
 *     transparently decompressed by the fetch layer (undici auto-decompresses
 *     on Node; on GJS the `@gjsify/fetch` shared session has libsoup's
 *     `ContentDecoder` removed and `@gjsify/fetch` does its own
 *     `DecompressionStream` decode keyed off the surviving `Content-Encoding`
 *     header — so `res.json()` here still sees plain JSON on both runtimes).
 *     This bypasses the libsoup chunked-gzip decoder bug (`G_IO_ERROR_
 *     PARTIAL_INPUT` at the tail of an npm-CDN gzip stream) that the old blanket
 *     `identity` default was working around.
 *   - **Tarballs** pass `'identity'` — they are already-gzipped `.tgz`, and
 *     transport-gzip would change which bytes the SRI `verifyIntegrity` runs
 *     over (the raw response body), breaking integrity.
 *
 * Callers that don't care (e.g. `whoami`) get the safe `identity` default.
 */
export function buildHeaders(url: string, opts: FetchOptions & { acceptEncoding?: string }): Record<string, string> {
    const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        'accept-encoding': opts.acceptEncoding ?? 'identity',
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
