// `gjsify login [--registry <url>] [--scope @scope] [--username <u>] [--otp <code>]`
//
// Node-free `npm login` — completes the auth trio alongside `gjsify whoami` /
// `gjsify publish`. Implements npm's legacy (`--auth-type=legacy`) credentials
// flow: PUT the CouchDB user document to `<registry>/-/user/org.couchdb.user:<u>`
// with the username + password (+ a `npm-otp` header for 2FA), receive a bearer
// token in the response, and write it to the userconfig `.npmrc` as
// `//<host>/:_authToken=<token>` (the same key `gjsify publish` / `whoami` read).
//
// The web-based OAuth flow (npm 9+'s default) is intentionally NOT implemented
// here — the legacy flow is the Node-free-friendly path and needs no browser.
//
// Reference: npm's `lib/utils/open-url-prompt` + `npm-profile`'s `adduser`/
// `loginCouch` (refs/npm-cli). Couch login body + token-in-response verified
// against npm-profile's `loginCouch`.

import type { Command } from '../types/index.js';
import { DEFAULT_REGISTRY, registryFor, buildHeaders, whoami } from '@gjsify/npm-registry';
import { loadNpmrc } from '../utils/load-npmrc.js';
import { writeAuthToken } from '../utils/auth-npmrc.js';
import { promptLine, promptHidden } from '../utils/prompt.js';

interface LoginOptions {
    registry?: string;
    scope?: string;
    username?: string;
    otp?: string;
    json?: boolean;
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
        const npmrc = await loadNpmrc(process.cwd());
        const registry =
            args.registry ??
            process.env.npm_config_registry ??
            (args.scope
                ? registryFor(args.scope.startsWith('@') ? `${args.scope}/_` : `@${args.scope}/_`, npmrc)
                : undefined) ??
            DEFAULT_REGISTRY;
        const registryClean = registry.endsWith('/') ? registry : `${registry}/`;

        const username = args.username ?? (await promptLine(`Username: `));
        if (!username) {
            console.error('gjsify login: a username is required.');
            process.exit(1);
        }
        const password = await promptHidden(`Password: `);
        if (!password) {
            console.error('gjsify login: a password is required.');
            process.exit(1);
        }
        const email = await promptLine(`Email: (this IS public) `);

        const userDoc = {
            _id: `org.couchdb.user:${username}`,
            name: username,
            password,
            email: email || undefined,
            type: 'user',
            roles: [] as string[],
            date: undefined as string | undefined, // stamped by the registry; left undefined (Date.now() is unavailable in some runtimes)
        };
        const url = `${registryClean}-/user/org.couchdb.user:${encodeURIComponent(username)}`;

        async function putUser(otp?: string): Promise<Response> {
            const headers = buildHeaders(url, { npmrc });
            headers['content-type'] = 'application/json';
            headers['accept'] = '*/*';
            if (otp) headers['npm-otp'] = otp;
            return fetch(url, { method: 'PUT', headers, body: JSON.stringify(userDoc) });
        }

        let res = await putUser(args.otp);

        // 2FA: npm signals OTP-required via 401 + www-authenticate "otp" (or a
        // body mentioning a one-time password). Prompt + retry once.
        if (res.status === 401 && !args.otp) {
            const wwwAuth = (res.headers.get('www-authenticate') ?? '').toLowerCase();
            const body = await res.text().catch(() => '');
            if (wwwAuth.includes('otp') || /one-time pass/i.test(body)) {
                const otp = await promptLine(`This operation requires a one-time password.\nEnter OTP: `);
                if (!otp) {
                    console.error('gjsify login: no OTP entered.');
                    process.exit(1);
                }
                res = await putUser(otp);
            }
        }

        if (!res.ok) {
            const text = await res.text().catch(() => '<no body>');
            console.error(`gjsify login: ${res.status} ${res.statusText} from ${registryClean}\n${text.slice(0, 400)}`);
            process.exit(1);
        }

        const data = (await res.json().catch(() => ({}))) as { token?: string };
        if (!data.token) {
            console.error(
                `gjsify login: the registry accepted the login but returned no token (response shape unexpected). ` +
                    `Your registry may require the web-OAuth flow — use \`npm login\`.`,
            );
            process.exit(1);
        }

        const npmrcPath = writeAuthToken(registryClean, data.token);

        // Confirm the freshly-written token actually authenticates.
        const verifyNpmrc = await loadNpmrc(process.cwd());
        const who = await whoami(registryClean, verifyNpmrc);
        const confirmedName = who.username ?? username;

        if (args.json) {
            process.stdout.write(`${JSON.stringify({ username: confirmedName, registry: registryClean })}\n`);
        } else {
            process.stdout.write(
                `Logged in as ${confirmedName} on ${registryClean}\n(token written to ${npmrcPath})\n`,
            );
        }
    },
};
