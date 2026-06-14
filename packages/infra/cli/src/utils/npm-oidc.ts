// npm Trusted Publishing — OIDC token exchange for `gjsify publish`.
//
// Two-step flow, mirroring `refs/npm-cli/lib/utils/oidc.js`:
//
//   1. Request a GitHub Actions OIDC ID token (JWT) from the runner.
//      Requires `permissions: id-token: write` in the calling workflow.
//      GitHub provides `ACTIONS_ID_TOKEN_REQUEST_URL` and
//      `ACTIONS_ID_TOKEN_REQUEST_TOKEN` env vars; we GET the URL with
//      the runner-provided audience (`npm:registry.npmjs.org`).
//
//   2. Exchange that JWT at npm's `/-/npm/v1/oidc/token/exchange/package/<name>`
//      endpoint for a short-lived (~5 min) npm publish token. npm verifies
//      the JWT against the package's configured Trusted Publisher
//      (repository + workflow filename + optional environment) and either
//      issues a token or rejects with an explanatory error.
//
// The token returned by step 2 is used for the publish PUT in the same
// way the long-lived NPM_TOKEN would have been — drop-in replacement.
//
// Reference: refs/npm-cli/lib/utils/oidc.js
// Original: Copyright (c) npm contributors. Artistic-2.0.

/**
 * User-agent string for the npm OIDC token-exchange request. npm's exchange
 * endpoint authorizes the npm-cli request envelope; it expects an `npm/<ver>`
 * user-agent (npm Trusted Publishing requires npm >= 11.5.1, which npm derives
 * from this prefix). Mirrors `npm-registry-fetch`'s `npm/<v> node/<v> <plat>
 * <arch> workspaces/<bool>` format. Pinned to the `refs/npm-cli` version gjsify
 * tracks; bump alongside it.
 */
const NPM_OIDC_USER_AGENT = 'npm/11.12.1 node/v24.0.0 linux x64 workspaces/false';

interface OidcExchangeOptions {
    /** Full package name including scope, e.g. `@gjsify/cli`. */
    packageName: string;
    /** Registry URL, e.g. `https://registry.npmjs.org`. */
    registry: string;
    /** Optional verbose logger — receives single-line strings. */
    log?: (msg: string) => void;
}

export interface OidcExchangeResult {
    /** Short-lived npm token (`Authorization: Bearer <token>`-compatible). */
    token: string;
    /** Audience used for the GitHub OIDC token request. */
    audience: string;
}

export class OidcUnavailableError extends Error {
    constructor(
        message: string,
        public readonly reason: 'no-env' | 'fetch-id-token' | 'no-id-token',
    ) {
        super(message);
        this.name = 'OidcUnavailableError';
    }
}

export class OidcExchangeError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly body: string,
        public readonly packageName: string,
    ) {
        super(message);
        this.name = 'OidcExchangeError';
    }
}

/**
 * Probe whether OIDC publishing is available in the current process —
 * cheap env-var check, no network access. Used by `gjsify publish` to
 * decide between OIDC and token-based auth in auto-detect mode.
 */
export function hasGithubOidcEnv(): boolean {
    return Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

/**
 * Request a GitHub Actions OIDC ID token for the given audience.
 * Throws `OidcUnavailableError` when the required env vars are missing
 * (caller can fall back to token auth) or when GitHub rejects the request.
 */
export async function fetchGithubOidcToken(audience: string, log?: (msg: string) => void): Promise<string> {
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !bearer) {
        throw new OidcUnavailableError(
            'GitHub Actions OIDC env vars (ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN}) not set. ' +
                'The calling workflow needs `permissions: id-token: write`.',
            'no-env',
        );
    }

    const requestUrl = new URL(url);
    requestUrl.searchParams.set('audience', audience);

    log?.(`gjsify oidc: GET ${requestUrl.href.replace(bearer, '<bearer>')}`);

    const res = await fetch(requestUrl.href, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${bearer}`,
        },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new OidcUnavailableError(
            `Failed to fetch GitHub OIDC id_token: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
            'fetch-id-token',
        );
    }

    const json = (await res.json().catch(() => ({}))) as { value?: string };
    if (!json.value) {
        throw new OidcUnavailableError('GitHub OIDC response missing `value` field', 'no-id-token');
    }

    return json.value;
}

/**
 * Exchange a GitHub OIDC JWT for a short-lived npm publish token at
 * `/-/npm/v1/oidc/token/exchange/package/<escaped-name>`. The npm
 * registry validates the JWT against the package's Trusted Publisher
 * config — if no Trusted Publisher is configured, or the JWT comes from
 * a repo/workflow that doesn't match, the exchange returns a 4xx with
 * a descriptive body which we propagate as `OidcExchangeError`.
 */
export async function exchangeOidcForNpmToken(args: OidcExchangeOptions & { idToken: string }): Promise<string> {
    const { packageName, registry, idToken, log } = args;
    const registryClean = registry.endsWith('/') ? registry.slice(0, -1) : registry;

    // npm-package-arg's escapedName convention — same as gjsify publish.ts.
    const escapedName = packageName.startsWith('@')
        ? (() => {
              const slash = packageName.indexOf('/');
              const scope = packageName.slice(1, slash);
              const base = packageName.slice(slash + 1);
              return `@${encodeURIComponent(scope)}%2f${encodeURIComponent(base)}`;
          })()
        : encodeURIComponent(packageName);

    const exchangeUrl = `${registryClean}/-/npm/v1/oidc/token/exchange/package/${escapedName}`;
    log?.(`gjsify oidc: POST ${exchangeUrl}`);

    // Mirror npm-cli's (npm-registry-fetch) OIDC-exchange request shape EXACTLY.
    // The GitHub OIDC JWT is identical regardless of which client requests it
    // (same audience + workflow context), so when npm-cli's exchange succeeds
    // and ours returns `401 "OIDC token exchange error - unauthorized"` with the
    // SAME token, the difference must be the request envelope. npm tightened the
    // exchange endpoint around 2026-06-14 (publishes that worked on 2026-06-08
    // began 401ing with an unchanged JWT): it now expects the npm-cli envelope —
    // an `npm/<ver>` user-agent + `npm-command: publish` header and NO request
    // body (npm-registry-fetch only attaches a body when one is given; our prior
    // `Content-Type: application/json` + `'{}'` is what regressed).
    const res = await fetch(exchangeUrl, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${idToken}`,
            accept: 'application/json',
            'user-agent': NPM_OIDC_USER_AGENT,
            'npm-command': 'publish',
        },
        // No body — matches npm-cli (its exchange call passes no `opts.body`).
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
        throw new OidcExchangeError(
            `npm OIDC token exchange failed for ${packageName}: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
            res.status,
            text,
            packageName,
        );
    }

    let json: { token?: string };
    try {
        json = JSON.parse(text) as { token?: string };
    } catch {
        throw new OidcExchangeError(
            `npm OIDC token exchange returned non-JSON body for ${packageName}: ${text.slice(0, 200)}`,
            res.status,
            text,
            packageName,
        );
    }

    if (!json.token) {
        throw new OidcExchangeError(
            `npm OIDC token exchange returned no \`token\` field for ${packageName}`,
            res.status,
            text,
            packageName,
        );
    }

    return json.token;
}

/**
 * End-to-end: probe env → fetch id-token → exchange for npm token.
 * One-shot convenience for `gjsify publish` and the verification command.
 */
export async function getNpmTrustedToken(opts: OidcExchangeOptions): Promise<OidcExchangeResult> {
    const audience = `npm:${new URL(opts.registry).hostname}`;
    const idToken = await fetchGithubOidcToken(audience, opts.log);
    const token = await exchangeOidcForNpmToken({ ...opts, idToken });
    return { token, audience };
}
