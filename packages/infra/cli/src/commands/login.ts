// `gjsify login [--registry <url>] [--scope @scope] [--username <u>] [--otp <code>]`
//
// Node-free `npm login` — completes the auth trio alongside `gjsify whoami` /
// `gjsify publish`. Implements npm's legacy (`--auth-type=legacy`) CouchDB
// credentials flow (npm-profile's `loginCouch`):
//
//   1. PUT the user doc to `<registry>/-/user/org.couchdb.user:<u>` with Basic
//      auth (base64 of `<username>:<password>`) + an `npm-otp` header for 2FA.
//   2. On 409 (the user already exists — the normal case for a *login*), GET
//      `…?write=true` for the current `_rev`, merge it in, and PUT to
//      `…/-rev/<rev>`.
//   3. The response carries a bearer `token`; write it to the userconfig
//      `.npmrc` as `//<host>/:_authToken=<token>` (the key `publish`/`whoami`
//      read), then verify with `whoami`.
//
// The npm-9+ web-OAuth flow is intentionally NOT implemented — the legacy flow
// is the Node-free-friendly path and needs no browser. `login` (vs `adduser`)
// does not send an email.
//
// Reference: refs/npm-cli/node_modules/npm-profile/lib/index.js `loginCouch`.

import type { Command } from '../types/index.js';
import { DEFAULT_REGISTRY, registryFor, whoami } from '@gjsify/npm-registry';
import { loadNpmrc } from '../utils/load-npmrc.js';
import { writeAuthToken } from '../utils/auth-npmrc.js';
import { promptCredentials, promptLine } from '../utils/prompt.js';

interface LoginOptions {
    registry?: string;
    scope?: string;
    username?: string;
    otp?: string;
    json?: boolean;
}

/** Options for the reusable {@link runLogin} flow. */
export interface RunLoginOptions {
    registry?: string;
    scope?: string;
    username?: string;
    otp?: string;
    /** Directory whose `.npmrc` seeds scope/registry resolution. Default: cwd. */
    cwd?: string;
}

/** Successful login result. */
export interface LoginResult {
    username: string;
    /** Registry URL (with trailing slash). */
    registry: string;
    /** Path of the `.npmrc` the token was written to. */
    npmrcPath: string;
}

/** Thrown by {@link runLogin} on any recoverable login failure (bad creds, no token, …). */
export class LoginError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LoginError';
    }
}

interface CouchUserDoc {
    _id: string;
    _rev?: string;
    name: string;
    password: string;
    type: string;
    roles: string[];
    date: string | undefined;
    [key: string]: unknown;
}

export const loginCommand: Command<unknown, LoginOptions> = {
    command: 'login',
    description:
        "Log in to an npm registry (Node-free `npm login`). Prompts for username + password (hidden) and writes the token to ~/.npmrc. Use --otp for 2FA. Web-OAuth flow is not supported — this is npm's legacy credentials flow.",
    builder: (yargs) =>
        yargs
            .option('registry', {
                description: `Registry URL to log in to. Default: ${DEFAULT_REGISTRY} (or a --scope's registry).`,
                type: 'string',
            })
            .option('scope', {
                description:
                    "Associate the login with a scope (e.g. @gjsify) — resolves that scope's registry from .npmrc.",
                type: 'string',
            })
            .option('username', { description: 'Username (prompted if omitted).', type: 'string' })
            .option('otp', { description: 'npm 2FA one-time code (prompted on demand if omitted).', type: 'string' })
            .option('json', { description: 'Emit `{username, registry}` JSON on success.', type: 'boolean' }),
    handler: async (args) => {
        try {
            const { username, registry, npmrcPath } = await runLogin({
                registry: args.registry,
                scope: args.scope,
                username: args.username,
                otp: args.otp,
            });
            if (args.json) {
                process.stdout.write(`${JSON.stringify({ username, registry })}\n`);
            } else {
                process.stdout.write(`Logged in as ${username} on ${registry}\n(token written to ${npmrcPath})\n`);
            }
        } catch (err) {
            if (err instanceof LoginError) {
                console.error(err.message);
                process.exit(1);
            }
            throw err;
        }
    },
};

/**
 * The `gjsify login` core, extracted so `gjsify onboard` can authenticate the
 * user when the whoami gate fails. Prompts for username + password (unless
 * provided), PUTs the CouchDB user doc, writes the token to the userconfig
 * `.npmrc`, and verifies it with `whoami`. Throws {@link LoginError} on any
 * recoverable failure (the command handler / onboard present it).
 */
export async function runLogin(opts: RunLoginOptions): Promise<LoginResult> {
    const npmrc = await loadNpmrc(opts.cwd ?? process.cwd());
    const registry =
        opts.registry ??
        process.env.npm_config_registry ??
        (opts.scope
            ? registryFor(opts.scope.startsWith('@') ? `${opts.scope}/_` : `@${opts.scope}/_`, npmrc)
            : undefined) ??
        DEFAULT_REGISTRY;
    const registryClean = registry.endsWith('/') ? registry : `${registry}/`;

    // Read username (visible) + password (masked) in a single raw-mode TTY
    // session — robust against cooked line-discipline state + the shared stdin
    // resume/pause race.
    const { username, password } = await promptCredentials(opts.username);
    if (!username) throw new LoginError('gjsify login: a username is required.');
    if (!password) throw new LoginError('gjsify login: a password is required.');

    // npm legacy auth = HTTP Basic of `<username>:<password>`. The password also
    // lives in the PUT body, which is how the registry mints the token.
    const basic = `Basic ${btoa(`${username}:${password}`)}`;
    const couchUrl = `${registryClean}-/user/org.couchdb.user:${encodeURIComponent(username)}`;

    const body: CouchUserDoc = {
        _id: `org.couchdb.user:${username}`,
        name: username,
        password,
        type: 'user',
        roles: [],
        date: undefined, // the registry stamps this; Date is unavailable in some runtimes
    };

    function authHeaders(otp?: string): Record<string, string> {
        const h: Record<string, string> = {
            authorization: basic,
            'content-type': 'application/json',
            accept: '*/*',
        };
        if (otp) h['npm-otp'] = otp;
        return h;
    }

    async function putUser(path: string, otp?: string): Promise<Response> {
        return fetch(`${couchUrl}${path}`, { method: 'PUT', headers: authHeaders(otp), body: JSON.stringify(body) });
    }

    let otp = opts.otp;
    let res = await putUser('', otp);

    // 2FA: 401 + www-authenticate "otp" (or a one-time-pass body) → prompt + retry.
    if (res.status === 401 && !otp) {
        const wwwAuth = (res.headers.get('www-authenticate') ?? '').toLowerCase();
        const text = await res
            .clone()
            .text()
            .catch(() => '');
        if (wwwAuth.includes('otp') || /one-time pass/i.test(text)) {
            otp = await promptLine(`This operation requires a one-time password.\nEnter OTP: `);
            if (!otp) throw new LoginError('gjsify login: no OTP entered.');
            res = await putUser('', otp);
        }
    }

    // 409 Conflict: the user already exists (the normal login case). Fetch the
    // current doc for its `_rev`, merge, and PUT to `…/-rev/<rev>`.
    if (res.status === 409) {
        const getRes = await fetch(`${couchUrl}?write=true`, { headers: authHeaders(otp) });
        if (getRes.ok) {
            const existing = (await getRes.json().catch(() => ({}))) as Record<string, unknown>;
            for (const k of Object.keys(existing)) {
                if (!body[k] || k === 'roles') body[k] = existing[k];
            }
            if (body._rev) res = await putUser(`/-rev/${body._rev}`, otp);
        }
    }

    if (res.status === 400) {
        throw new LoginError(`gjsify login: there is no user with the username "${username}" on ${registryClean}.`);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new LoginError(
            `gjsify login: ${res.status} ${res.statusText} from ${registryClean}\n${text.slice(0, 400)}`,
        );
    }

    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!data.token) {
        throw new LoginError(
            `gjsify login: the registry accepted the login but returned no token (unexpected response shape). ` +
                `Your registry may require the web-OAuth flow — use \`npm login\`.`,
        );
    }

    const npmrcPath = writeAuthToken(registryClean, data.token);

    // Confirm the freshly-written token authenticates.
    const verifyNpmrc = await loadNpmrc(opts.cwd ?? process.cwd());
    const who = await whoami(registryClean, verifyNpmrc);
    const confirmedName = who.username ?? username;

    return { username: confirmedName, registry: registryClean, npmrcPath };
}
