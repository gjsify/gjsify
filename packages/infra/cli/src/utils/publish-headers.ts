// Publish-request header builder — matches what npm's CLI sends on a publish
// PUT so the npm registry's create-package frontdoor routes a *new* scoped
// package correctly.
//
// Root cause this fixes: a first-publish of a never-before-published
// `@scope/<name>` via token auth was returning a bare `404 Not Found` (body
// `Not Found`, NOT a JSON npm error). That is a routing miss, not a
// payload-validation failure — npm's write frontdoor keys the create path on
// the `npm-command` header, which gjsify was not sending. `npm publish` with
// the same ~/.npmrc token succeeds because libnpmpublish goes through
// `npm-registry-fetch`'s `getHeaders`, which always sets `npm-command`
// (+ `npm-auth-type`, + a real `user-agent`).
//
// Evidence (refs/npm-cli):
//   - `lib/npm.js:404`  `flat.npmCommand = this.command`  → set for EVERY npm
//     command; equals `"publish"` for `npm publish`.
//   - `node_modules/npm-registry-fetch/lib/index.js:231-233`
//        `if (opts.npmCommand) headers['npm-command'] = opts.npmCommand`
//     and `:219-221` `if (opts.authType) headers['npm-auth-type'] = …`
//     and `:215-217` `'user-agent': opts.userAgent`.
//   - `workspaces/config/lib/definitions/definitions.js:282-290` — `auth-type`
//     default `'web'`, flattened to `flatOptions.authType`.
//   - `:1581-1587` — when `--otp` is set, npm forces `auth-type` to `'legacy'`
//     before flattening, so an OTP publish sends `npm-auth-type: legacy`.
//   - `node_modules/npm-package-arg/lib/npa.js:188`
//        `this.escapedName = name.replace('/', '%2f')` — lowercase `%2f`,
//     literal `@`. (gjsify's URL encoding already matches this — it was never
//     the bug.)
//
// This module is pure (no I/O, no `gi://`) so it is unit-testable on both Node
// and GJS without dragging in the runtime fetch/Soup stack.

import { buildHeaders, type NpmrcConfig } from '@gjsify/npm-registry';

/**
 * Percent-encode a package name for the publish PUT path, matching
 * npm-package-arg's `escapedName` convention (npa.js:188):
 * `this.escapedName = name.replace('/', '%2f')`.
 *
 * Scoped: `@scope/name` → `@scope%2fname` (literal `@`, lowercase `%2f`, the
 * scope/name segments NOT otherwise re-encoded — npm only replaces the slash).
 * Unscoped: returned unchanged (npa stores the bare name; the only characters
 * npm forbids are those `encodeURIComponent` would touch, which npa rejects up
 * front). The npm registry is picky about this exact shape on the publish PUT
 * URL — `%2F` (uppercase) or a re-encoded `@` would miss the create route.
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
     * after `buildHeaders` ran). When set it replaces whatever the npmrc auth
     * resolution produced.
     */
    authorization?: string;
    /**
     * npm user-agent. Defaults to an npm-CLI-shaped string. The registry does
     * not validate the exact value, but a real UA is what npm sends; the dead
     * `gjsify-install/0.3.7` placeholder is not used here.
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
 * Notably it does NOT set an `accept: *` wildcard — `npm-registry-fetch` sends
 * no `accept` header on the publish PUT; the stray wildcard gjsify used to send
 * is dropped to match.
 */
export function buildPublishHeaders(url: string, opts: PublishHeaderOptions): Record<string, string> {
    const headers = buildHeaders(url, { npmrc: opts.npmrc });
    // npm-registry-fetch never sets `accept` on the publish PUT — drop the
    // placeholder `accept-encoding` we don't want to influence the create route
    // either. (buildHeaders defaults accept-encoding to `identity`; a publish
    // PUT body is JSON we generated, so the encoding header is irrelevant — but
    // we keep it harmless and explicit by leaving it as buildHeaders set it.)

    // content-type: application/json — npm-registry-fetch sets this for any
    // non-string/non-stream/non-buffer body (index.js:63-67); our body is a
    // JSON string, so we set it explicitly.
    headers['content-type'] = 'application/json';

    // npm-command: publish — THE routing header. npm sets it for every command
    // (npm.js:404); the registry's write frontdoor uses it to route the
    // create-package PUT. Missing it = bare `404 Not Found` on a new package.
    headers['npm-command'] = 'publish';

    // npm-auth-type — `web` by default, `legacy` when an OTP is supplied
    // (definitions.js:1583-1586). Sent by getHeaders (index.js:219-221).
    headers['npm-auth-type'] = opts.otp ? 'legacy' : 'web';

    // user-agent — a real npm-shaped UA (getHeaders index.js:215-217).
    headers['user-agent'] = opts.userAgent ?? defaultUserAgent();

    // npm-otp — only when an OTP is supplied (index.js:243-245).
    if (opts.otp) headers['npm-otp'] = opts.otp;

    // authorization override (OIDC token resolved after npmrc auth).
    if (opts.authorization) headers['authorization'] = opts.authorization;

    return headers;
}

/**
 * npm-CLI-shaped user-agent. Format mirrors npm-registry-fetch's
 * `default-opts.js` (`npm@<v>/node@<v>+<arch> (<platform>)`); we substitute the
 * gjsify CLI identity. The registry does not validate the exact value — it just
 * must be a non-placeholder UA, which some WAF / CDN frontdoors require.
 */
function defaultUserAgent(): string {
    const proc = (globalThis as { process?: { arch?: string; platform?: string } }).process;
    const arch = proc?.arch ?? 'x64';
    const platform = proc?.platform ?? 'linux';
    return `gjsify-publish/0.5.0 (${platform} ${arch})`;
}
