// npm Trusted Publishing — OIDC token exchange for `gjsify publish`.
//
// Two-step flow, mirroring `refs/npm-cli/lib/utils/oidc.js`:
//
//   1. GET a GitHub Actions OIDC ID token (JWT) from the runner, at
//      `ACTIONS_ID_TOKEN_REQUEST_URL` with the audience `npm:registry.npmjs.org`. Requires
//      `permissions: id-token: write` in the calling workflow.
//   2. Exchange that JWT at `/-/npm/v1/oidc/token/exchange/package/<name>` for a short-lived
//      (~5 min) npm publish token; npm verifies it against the package's Trusted Publisher
//      (repository + workflow filename + optional environment).
//
// The resulting token is a drop-in replacement for a long-lived NPM_TOKEN on the publish PUT.
//
// Reference: refs/npm-cli/lib/utils/oidc.js
// Original: Copyright (c) npm contributors. Artistic-2.0.

interface OidcExchangeOptions {
    /** Full package name including scope, e.g. `@gjsify/cli`. */
    packageName: string;
    /** Registry URL, e.g. `https://registry.npmjs.org`. */
    registry: string;
    /** Optional verbose logger — receives single-line strings. */
    log?: (msg: string) => void;
    /**
     * Max retries on a TRANSIENT exchange failure (5xx / 429 / network error), default 3. A
     * single npm-side 503 mid-release used to fall straight through to token auth, which in
     * OIDC-only CI has no token → a 404 that broke the release while the workflow stayed green
     * (hit on `@gjsify/process` during v0.7.3). Retrying keeps the publish on the OIDC path.
     * Non-transient statuses (404 "package not found", 401/403 misconfig) are NOT retried, so
     * `--tolerate-untrusted-new` and the misconfig hints still fire on the first response.
     */
    maxRetries?: number;
    /** Base backoff in ms for transient retries; doubles each attempt (capped 8s). Default 1000. Tests pass 0. */
    retryBaseMs?: number;
}

/** HTTP statuses worth retrying — npm-side transient/overload conditions. */
const TRANSIENT_EXCHANGE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
        /**
         * Non-secret claims decoded from the rejected JWT (`repository`, `workflow_ref`,
         * `environment`, …) — exactly what npm matches a Trusted Publisher config against, so on
         * a 401/403 they name which fields the config must carry.
         */
        public readonly claims?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'OidcExchangeError';
    }
}

/**
 * Decode the non-secret payload of a JWT — the middle base64url segment. A GitHub OIDC
 * id-token's payload is public metadata about the workflow run; the SIGNATURE is what makes it
 * trustworthy. Null when the token isn't a well-formed three-part JWT.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Whether OIDC publishing is available in this process — a cheap env-var check with no network
 * access, used by `gjsify publish` to choose between OIDC and token auth in auto-detect mode.
 */
export function hasGithubOidcEnv(): boolean {
    return Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

/**
 * Request a GitHub Actions OIDC ID token for `audience`. Throws `OidcUnavailableError` when the
 * env vars are missing (the caller can fall back to token auth) or GitHub rejects the request.
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

    // Append the audience by STRING CONCATENATION, as @actions/core's getIDToken does.
    //
    // fixed upstream in gjsify: `URL.searchParams.set` + `.href` used to DROP the parameter under
    // GJS — the mutation never reached the serialisation — so GitHub issued an id-token with the
    // DEFAULT audience (the repo API URL) and npm rejected an otherwise-valid token with 401:
    // repository/workflow_ref/sub all matched the Trusted Publisher, only `aud` was wrong. The
    // URL live view now works, so the ban is lifted; the concatenation stays because it is what
    // the reference implementation does, not because the alternative is broken.
    const sep = url.includes('?') ? '&' : '?';
    const requestUrl = `${url}${sep}audience=${encodeURIComponent(audience)}`;

    log?.(`gjsify oidc: GET ${requestUrl.replace(bearer, '<bearer>')}`);

    const res = await fetch(requestUrl, {
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
 * Exchange a GitHub OIDC JWT for a short-lived npm publish token. A missing or non-matching
 * Trusted Publisher config comes back as a 4xx with a descriptive body, propagated as
 * `OidcExchangeError`.
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

    const maxRetries = args.maxRetries ?? 3;
    const retryBaseMs = args.retryBaseMs ?? 1000;

    for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
            res = await fetch(exchangeUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                // Empty JSON body: the JWT is the proof, no additional claims are needed.
                body: '{}',
            });
        } catch (netErr) {
            // Network-level failure (DNS, connection reset, TLS): transient.
            if (attempt < maxRetries) {
                const delay = Math.min(retryBaseMs * 2 ** attempt, 8000);
                log?.(
                    `gjsify oidc: network error for ${packageName} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
                );
                await sleep(delay);
                continue;
            }
            throw new OidcExchangeError(
                `npm OIDC token exchange network error for ${packageName} after ${attempt + 1} attempt(s): ${netErr instanceof Error ? netErr.message : String(netErr)}`,
                0,
                '',
                packageName,
                decodeJwtPayload(idToken) ?? undefined,
            );
        }

        const text = await res.text().catch(() => '');

        if (!res.ok) {
            // Only TRANSIENT npm-side failures retry — see `maxRetries`.
            if (TRANSIENT_EXCHANGE_STATUSES.has(res.status) && attempt < maxRetries) {
                const delay = Math.min(retryBaseMs * 2 ** attempt, 8000);
                log?.(
                    `gjsify oidc: transient ${res.status} ${res.statusText} for ${packageName} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
                );
                await sleep(delay);
                continue;
            }
            throw new OidcExchangeError(
                `npm OIDC token exchange failed for ${packageName}: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
                res.status,
                text,
                packageName,
                decodeJwtPayload(idToken) ?? undefined,
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
}

/** End-to-end: probe env → fetch id-token → exchange for an npm token. */
export async function getNpmTrustedToken(opts: OidcExchangeOptions): Promise<OidcExchangeResult> {
    const audience = `npm:${new URL(opts.registry).hostname}`;
    const idToken = await fetchGithubOidcToken(audience, opts.log);
    const token = await exchangeOidcForNpmToken({ ...opts, idToken });
    return { token, audience };
}
