// `gjsify logout [--registry <url>] [--scope @scope]`
//
// Node-free `npm logout` — revokes the current bearer token on the registry
// (best-effort `DELETE /-/user/token/<token>`) and removes the
// `//<host>/:_authToken=` line from the userconfig `.npmrc`. Completes the auth
// trio with `gjsify login` / `whoami` / `publish`.
//
// Reference: npm's `lib/commands/logout.js` (DELETE the token, then strip the
// nerf-darted authToken from the config).

import type { Command } from '../types/index.js';
import { DEFAULT_REGISTRY, registryFor, resolveAuthForUrl } from '@gjsify/npm-registry';
import { loadNpmrc } from '../utils/load-npmrc.js';
import { removeAuthToken } from '../utils/auth-npmrc.js';
import { clearCachedOtp } from '../utils/npm-otp-cache.js';

interface LogoutOptions {
    registry?: string;
    scope?: string;
    json?: boolean;
}

export const logoutCommand: Command<unknown, LogoutOptions> = {
    command: 'logout',
    description:
        'Log out of an npm registry (Node-free `npm logout`). Revokes the token on the registry (best-effort) and removes it from ~/.npmrc.',
    builder: (yargs) =>
        yargs
            .option('registry', {
                description: `Registry URL to log out of. Default: ${DEFAULT_REGISTRY} (or a --scope's registry).`,
                type: 'string',
            })
            .option('scope', {
                description: "Log out of a scope's registry (e.g. @gjsify) — resolved from .npmrc.",
                type: 'string',
            })
            .option('json', { description: 'Emit `{registry, revoked, removed}` JSON.', type: 'boolean' }),
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

        // Best-effort server-side revoke. The token value is what npm's DELETE
        // endpoint expects in the path; if there's no token we just strip locally.
        const auth = resolveAuthForUrl(`${registryClean}-/whoami`, npmrc);
        let revoked = false;
        if (auth?.startsWith('Bearer ')) {
            const token = auth.slice('Bearer '.length);
            try {
                const res = await fetch(`${registryClean}-/user/token/${encodeURIComponent(token)}`, {
                    method: 'DELETE',
                    headers: { authorization: auth, accept: '*/*' },
                });
                revoked = res.ok;
            } catch {
                /* offline / registry down — fall through to local removal */
            }
        }

        // Drop any short-lived cached OTP for this registry — the token it would
        // have accompanied is now revoked.
        clearCachedOtp(registryClean);

        const { path, removed } = removeAuthToken(registryClean);

        if (args.json) {
            process.stdout.write(`${JSON.stringify({ registry: registryClean, revoked, removed })}\n`);
        } else if (removed) {
            process.stdout.write(
                `Logged out of ${registryClean}${revoked ? ' (token revoked)' : ''}\n(removed from ${path})\n`,
            );
        } else {
            process.stdout.write(`No token for ${registryClean} found in ${path} — nothing to remove.\n`);
        }
    },
};
