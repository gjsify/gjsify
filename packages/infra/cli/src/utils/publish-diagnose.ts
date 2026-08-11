// Dead-token vs new-package diagnostic for `gjsify publish`.
//
// A `404 Not Found` on the publish PUT is npm's shape for two very different
// causes, and guessing sends the user down the wrong path entirely: the
// `_authToken` has been revoked/expired (npm answers an unrecognised bearer with
// 404, not 401), or the scoped package genuinely is not on npm yet and needs the
// first-publish bootstrap from AGENTS.md.
//
// `GET /-/whoami` with the SAME Authorization header disambiguates: a live token
// returns `{"username": "…"}`, a dead one returns `{}` — status 200 for both, so
// the EMPTY BODY is the signal.

import { whoami, type NpmrcConfig } from '@gjsify/npm-registry';

export type Diagnose404Reason = 'dead-token' | 'live-token-404' | 'unknown';

export interface Diagnose404Result {
    /** Discriminant — drives the JSON shape + exit-code path in the caller. */
    reason: Diagnose404Reason;
    /** Set only when `reason === 'live-token-404'`. */
    username?: string;
    /** Multi-line hint, ready for stderr as-is. */
    message: string;
}

interface Diagnose404Input {
    /** Full package name including scope, e.g. `@gjsify/abort-controller`. */
    packageName: string;
    version: string;
    /** Registry URL, with or without trailing slash. */
    registry: string;
    /** Source of the Authorization header on the whoami probe. */
    npmrc: NpmrcConfig | undefined;
}

/**
 * Probe `/-/whoami` to disambiguate the 404 cause. Best-effort: a thrown error or
 * non-2xx yields `reason: 'unknown'`, leaving the caller's generic error path
 * untouched. No side effects and no writes — the caller owns presentation.
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
 * Is the 404 body the "dead-token-or-missing-package" shape? npm's PUT answers
 * with plain-text `Not Found` or an empty body; the JSON `{"error":"Not Found"}`
 * form is accepted too. Any other 404 body — notably one carrying a structured npm
 * error code — keeps the generic error path.
 */
export function is404DiagnosticCandidate(body: string): boolean {
    const trimmed = body.trim();
    if (trimmed.length === 0) return true;
    if (/^not found$/i.test(trimmed)) return true;
    if (/"error"\s*:\s*"Not Found"/i.test(trimmed)) return true;
    return false;
}
