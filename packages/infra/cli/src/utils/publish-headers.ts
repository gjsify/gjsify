// Publish-request header builder — matches what npm's CLI sends on a publish
// PUT so the npm registry's create-package frontdoor routes a *new* scoped
// package correctly.
//
// Root cause this fixes: a first-publish of a never-before-published
// `@scope/<name>` via token auth returned a bare `404 Not Found` (body
// `Not Found`, NOT a JSON npm error). That is a ROUTING miss, not a
// payload-validation failure — npm's write frontdoor keys the create path on the
// `npm-command` header, which gjsify was not sending. `npm publish` with the same
// ~/.npmrc token succeeds because libnpmpublish goes through
// `npm-registry-fetch`'s `getHeaders`, which always sets `npm-command`
// (+ `npm-auth-type`, + a real `user-agent`). Reference: `refs/npm-cli`.
//
// This module pulls in no `gi://` and no runtime fetch/Soup stack, so it is
// unit-testable on both Node and GJS. Its one filesystem touch is the manifest
// walk backing the user-agent version — see `cliVersion()`.

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHeaders, type NpmrcConfig } from '@gjsify/npm-registry';

/**
 * Compile-time constant injected by `package.json#gjsify.defineFromPackageJson`
 * — see {@link cliVersion}. Only ever defined in a bundled artifact; `typeof`
 * keeps the reference legal in the plain-`tsc` output where it is not.
 */
declare const __PACKAGE_VERSION__: string | undefined;

/**
 * Percent-encode a package name for the publish PUT path, matching
 * npm-package-arg's `escapedName` convention.
 *
 * Scoped: `@scope/name` → `@scope%2fname` (literal `@`, lowercase `%2f`, the
 * scope/name segments NOT otherwise re-encoded — npm only replaces the slash).
 * Unscoped: returned unchanged. The registry is picky about this exact shape on
 * the publish PUT URL — uppercase `%2F` or a re-encoded `@` misses the create
 * route.
 */
export function escapePackageName(name: string): string {
    return name.replace('/', '%2f');
}

export interface PublishHeaderOptions {
    /** Parsed ~/.npmrc — supplies the `authorization` (Bearer/Basic) header. */
    npmrc?: NpmrcConfig;
    /** 2FA one-time code. When present, sent as `npm-otp` AND flips auth-type. */
    otp?: string;
    /**
     * Override the `authorization` header (e.g. an OIDC Bearer token resolved
     * after `buildHeaders` ran), replacing whatever npmrc auth resolution produced.
     */
    authorization?: string;
    /**
     * npm user-agent. Defaults to an npm-CLI-shaped string carrying this CLI's
     * real version — never a hard-coded placeholder (see {@link cliVersion}).
     */
    userAgent?: string;
}

/**
 * Build the full set of headers for the publish PUT, mirroring
 * `npm-registry-fetch`'s `getHeaders` for `npm publish`.
 *
 * The set: `authorization`, `content-type: application/json`,
 * `npm-command: publish`, `npm-auth-type` (`web`, or `legacy` when `--otp`),
 * `user-agent`, and `npm-otp` when an OTP is supplied.
 *
 * Notably NO `accept` header: `npm-registry-fetch` sends none on the publish PUT,
 * and a wildcard here misses the create route.
 */
export function buildPublishHeaders(url: string, opts: PublishHeaderOptions): Record<string, string> {
    const headers = buildHeaders(url, { npmrc: opts.npmrc });
    // `buildHeaders`' `accept-encoding: identity` default is left as it set it —
    // the PUT body is JSON we generated, so the encoding header is irrelevant here.

    // npm-registry-fetch sets this for any non-string/non-stream/non-buffer body;
    // ours is a JSON string, so it is set explicitly.
    headers['content-type'] = 'application/json';

    // THE routing header: npm sets it for every command, and the registry's write
    // frontdoor uses it to route the create-package PUT. Missing it = bare
    // `404 Not Found` on a new package.
    headers['npm-command'] = 'publish';

    // npm forces auth-type `legacy` whenever `--otp` is set, `web` otherwise.
    headers['npm-auth-type'] = opts.otp ? 'legacy' : 'web';

    headers['user-agent'] = opts.userAgent ?? defaultUserAgent();

    if (opts.otp) headers['npm-otp'] = opts.otp;

    // OIDC token resolved after npmrc auth.
    if (opts.authorization) headers['authorization'] = opts.authorization;

    return headers;
}

/**
 * This CLI's own `package.json#version`, memoised. Two layers, because
 * `@gjsify/cli` is a DUAL-ENTRY package and neither layer covers both entries:
 *
 * 1. **`__PACKAGE_VERSION__`** — the compile-time define
 *    (`package.json#gjsify.defineFromPackageJson`). Zero I/O, but the bundler only
 *    writes `dist/cli.gjs.mjs`; the npm-wired Node bin under `lib/` comes from
 *    plain `tsc`, which knows nothing about defines. A define alone would leave the
 *    Node entry — the one `npm install @gjsify/cli` runs — on a permanent placeholder.
 *
 * 2. **an upward manifest walk** for the nearest `package.json` naming
 *    `@gjsify/cli`, covering `lib/`. Deliberately NOT a fixed
 *    `new URL('../../package.json', import.meta.url)` read: that resolves correctly
 *    from `lib/utils/` but points one directory too high from `dist/`, and the
 *    build-time `inlineStaticReads` pass that would have frozen it is scoped to
 *    `node_modules` paths. The walk is depth-independent, so it works from `src/`,
 *    `lib/`, `dist/` and an installed `node_modules/@gjsify/cli/**` alike.
 *
 * `GJSIFY_CLI_PACKAGE_JSON` overrides both, matching `self-update.ts`.
 *
 * Exported because `showcase` needs the SAME answer rather than a fourth
 * resolver: it PINS the showcase package to this version, so a version it cannot
 * read is a showcase left unpinned and `dlx` serves a stale cached one
 * (`docs/code-anti-patterns.md`). Returns `'unknown'`, never `undefined`.
 */
let cachedCliVersion: string | undefined;
export function cliVersion(): string {
    if (cachedCliVersion !== undefined) return cachedCliVersion;
    cachedCliVersion =
        (typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '') || walkForCliVersion() || 'unknown';
    return cachedCliVersion;
}

/** Nearest ancestor `package.json` whose `name` is `@gjsify/cli`; '' when none. */
function walkForCliVersion(): string {
    const override = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
        'GJSIFY_CLI_PACKAGE_JSON'
    ];
    let dir: string;
    try {
        dir = override ? dirname(override) : dirname(fileURLToPath(import.meta.url));
    } catch {
        return '';
    }
    for (let i = 0; i < 12; i++) {
        try {
            const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as {
                name?: unknown;
                version?: unknown;
            };
            if (pkg.name === '@gjsify/cli' && typeof pkg.version === 'string') return pkg.version;
        } catch {
            /* no manifest here (or unreadable) — keep climbing */
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return '';
}

/**
 * npm-CLI-shaped user-agent, mirroring npm-registry-fetch's
 * `npm@<v>/node@<v>+<arch> (<platform>)` with the gjsify CLI identity substituted.
 * The registry does not validate the value; it must merely be a non-placeholder UA,
 * which some WAF / CDN frontdoors require.
 */
function defaultUserAgent(): string {
    const proc = (globalThis as { process?: { arch?: string; platform?: string } }).process;
    const arch = proc?.arch ?? 'x64';
    const platform = proc?.platform ?? 'linux';
    return `gjsify-publish/${cliVersion()} (${platform} ${arch})`;
}
