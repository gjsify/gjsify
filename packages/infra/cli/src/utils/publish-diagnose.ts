// Dead-token vs new-package diagnostic for `gjsify publish`.
//
// When the publish PUT returns `404 Not Found` (body `"Not Found"` or empty)
// it is ambiguous between two very different situations:
//
//   1. The `_authToken` in ~/.npmrc has been revoked / expired. The npm
//      registry's 404 is its way of saying "we don't recognize this
//      bearer". Easy to mistake for a missing-package error and send the
//      user down the wrong path (Trusted-Publisher-bootstrap setup).
//   2. The scoped `@gjsify/<pkg>` genuinely doesn't exist on npm yet —
//      the first-publish bootstrap step from AGENTS.md.
//
// `GET /-/whoami` with the SAME Authorization header disambiguates: a live
// token returns `{"username": "..."}`, a dead token returns `{}` (status 200
// in both cases — the empty body is npm's signal).
//
// `npm publish` from npm-cli handles dead tokens with `401 EOTP` + a clear
// "one-time-password or refresh the token" hint. The 404 path is npm's
// PUT-specific shape and `gjsify publish` previously just printed the
// opaque body. This helper closes the diagnostic gap.

import { whoami, type NpmrcConfig } from '@gjsify/npm-registry';

export type Diagnose404Reason = 'dead-token' | 'live-token-404' | 'unknown';

export interface Diagnose404Result {
    /** Discriminant — drives the JSON shape + exit-code path in the caller. */
    reason: Diagnose404Reason;
    /** Username from `/-/whoami` when reason === 'live-token-404'. */
    username?: string;
    /** Multi-line, human-friendly hint ready for stderr emission. */
    message: string;
}

interface Diagnose404Input {
    /** Full package name including scope, e.g. `@gjsify/abort-controller`. */
    packageName: string;
    /** Pinned version we tried to publish. */
    version: string;
    /** Registry URL (with or without trailing slash). */
    registry: string;
    /** Parsed .npmrc — used to derive Authorization on the whoami probe. */
    npmrc: NpmrcConfig | undefined;
}

/**
 * Probe `/-/whoami` to disambiguate the 404 cause. Best-effort: any thrown
 * error / non-2xx falls through to `reason: 'unknown'` so the caller's
 * generic error path runs untouched.
 *
 * Pure async I/O — no side effects, no process.exit, no console writes.
 * The caller owns presentation (stderr vs stdout, plain vs JSON).
 */
export async function diagnose404(input: Diagnose404Input): Promise<Diagnose404Result> {
    const { packageName, version, registry, npmrc } = input;
    let probe: { username?: string } = {};
    try {
        probe = await whoami(registry, npmrc);
    } catch {
        return { reason: 'unknown', message: formatUnknown(packageName, version) };
    }
    if (probe.username && probe.username.length > 0) {
        return {
            reason: 'live-token-404',
            username: probe.username,
            message: formatLiveToken404(packageName, version, probe.username),
        };
    }
    return { reason: 'dead-token', message: formatDeadToken(packageName, version) };
}

function formatDeadToken(name: string, version: string): string {
    return [
        `gjsify publish: ${name}@${version} — 404 Not Found`,
        '',
        'The npm token in ~/.npmrc appears to be revoked or expired (the /-/whoami probe',
        'returned {} instead of {"username": "..."}). The 404 is npm\'s response to a PUT',
        'authenticated with an invalid bearer token.',
        '',
        'To refresh:',
        '  npm login',
        '  # or, future: gjsify login (tracked as project_gjsify_login_goal)',
        '',
        'Then verify before publishing:',
        '  curl -s -H "Authorization: Bearer $(grep registry.npmjs.org ~/.npmrc | sed \'s|.*=||\')" \\',
        '       https://registry.npmjs.org/-/whoami',
        '  # Healthy: {"username":"<you>"}',
        '  # Dead:    {}',
    ].join('\n');
}

function formatLiveToken404(name: string, version: string, username: string): string {
    return [
        `gjsify publish: ${name}@${version} — 404 Not Found`,
        '',
        `Authenticated as: ${username}`,
        '',
        `Your token authenticates, so this is NOT a dead-token problem. The package`,
        `${name} is not (yet) on npmjs.com. Two cases:`,
        '',
        '  1. First publish of a brand-new scoped package — do the one-time bootstrap',
        '     (see AGENTS.md > "New @gjsify/* package: first-publish + Trusted',
        '     Publisher bootstrap"). The npm registry can also 404 *transiently*',
        '     while provisioning a brand-new package: simply re-run, or do the very',
        '     first publish with `npm publish` (then configure the Trusted Publisher).',
        '  2. You lack publish access to the scope — verify with `npm access ls-packages`.',
    ].join('\n');
}

function formatUnknown(name: string, version: string): string {
    return `gjsify publish: ${name}@${version} — 404 Not Found`;
}

/**
 * Heuristic: is the 404 body the "dead-token-or-missing-package" shape?
 * npm's PUT returns plain text `Not Found` (sometimes empty body). We trigger
 * the diagnostic for both, plus for the JSON `{"error":"Not Found"}` shape
 * just in case. Other 404 bodies (e.g. with a structured npm error code)
 * keep the generic error path.
 */
export function is404DiagnosticCandidate(body: string): boolean {
    const trimmed = body.trim();
    if (trimmed.length === 0) return true;
    if (/^not found$/i.test(trimmed)) return true;
    if (/"error"\s*:\s*"Not Found"/i.test(trimmed)) return true;
    return false;
}
