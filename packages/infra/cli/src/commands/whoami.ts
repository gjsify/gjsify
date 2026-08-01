// `gjsify whoami [--registry <url>] [--json]`
//
// Prints the npm-registry username for the current `~/.npmrc` token. The
// natural CLI surface for the `whoami(registry, npmrc)` helper introduced
// in #390 (originally as the dead-token-vs-missing-package diagnostic for
// `gjsify publish`).
//
// Goal: maintainers should be able to verify `~/.npmrc` auth without the
// extra `curl + Authorization: Bearer …` dance documented in AGENTS.md.
// The four observable outcomes map to:
//
//   1. `{username: "..."}` from the registry  →  print
//        Logged in as: <username>
//        Registry:     <url>
//      exit 0.
//   2. `{}` from the registry  →  the token exists in npmrc but the
//      registry no longer accepts it. Emit a clear "token appears dead or
//      revoked" message plus the refresh instructions, exit 1.
//   3. No `_authToken` (and no basic-auth) in any resolved npmrc  →  emit
//      a "no token configured" message pointing at `npm login`, exit 1.
//   4. Network / non-2xx / non-JSON error  →  surface the underlying
//      error message + registry URL, exit 1.
//
// With `--json` every branch emits a single-line JSON object instead of
// the human-readable text — useful for CI scripts that want to gate
// behavior on `username` without parsing free-form output.
//
// Reference: `npm whoami` (refs/npm-cli/lib/commands/whoami.js).

import type { Command } from '../types/index.js';
import { DEFAULT_REGISTRY, whoami } from '@gjsify/npm-registry';
import { hasAnyCredential, loadNpmrc } from '../utils/load-npmrc.js';

interface WhoamiOptions {
    registry?: string;
    json?: boolean;
}

export const whoamiCommand: Command<unknown, WhoamiOptions> = {
    command: 'whoami',
    description:
        'Print the npm-registry username for the current ~/.npmrc token. Clear failure message when the token is dead, missing, or the registry is unreachable.',
    builder: (yargs) =>
        yargs
            .option('registry', {
                description: `Registry URL to probe. Default: scope-aware lookup from .npmrc (falls back to ${DEFAULT_REGISTRY}).`,
                type: 'string',
            })
            .option('json', {
                description: 'Emit `{username, registry}` (or `{error, registry}`) as a single-line JSON object.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const npmrc = await loadNpmrc(process.cwd());
        // Registry resolution order matches `gjsify publish`:
        // `--registry` flag > `$npm_config_registry` > `.npmrc` registry >
        // `DEFAULT_REGISTRY`. The scope-aware `registryFor()` lookup is
        // intentionally NOT used here — `whoami` is account-scoped, not
        // package-scoped, so the user's *default* registry is what they
        // want to verify.
        const registry = args.registry ?? process.env.npm_config_registry ?? npmrc.registry ?? DEFAULT_REGISTRY;
        const registryClean = registry.endsWith('/') ? registry.slice(0, -1) : registry;
        const asJson = args.json === true;

        // Branch 3 — no credential configured at all. Catch this before
        // the network call so the message points at the real fix
        // (`npm login`) instead of a registry-side 401.
        if (!hasAnyCredential(npmrc)) {
            if (asJson) {
                process.stdout.write(`${JSON.stringify({ error: 'no-token-configured', registry: registryClean })}\n`);
            } else {
                process.stderr.write(
                    [
                        'gjsify whoami: no npm token configured.',
                        '',
                        `No \`_authToken\` found in ~/.npmrc / $NPM_CONFIG_USERCONFIG / .npmrc for ${registryClean}.`,
                        '',
                        'Add one via: npm login',
                        'Then verify:  gjsify whoami',
                    ].join('\n') + '\n',
                );
            }
            // `return` — a bare `process.exit()` is deferred under GJS and the
            // handler would probe the registry without a token.
            return process.exit(1);
        }

        let result: { username?: string };
        try {
            result = await whoami(registry, npmrc);
        } catch (err) {
            // Branch 4 — network / non-2xx / parse failure.
            const message = err instanceof Error ? err.message : String(err);
            if (asJson) {
                process.stdout.write(`${JSON.stringify({ error: message, registry: registryClean })}\n`);
            } else {
                process.stderr.write(`gjsify whoami: ${message}\n`);
                process.stderr.write(`Registry: ${registryClean}\n`);
            }
            // `return process.exit` also keeps the type narrower happy: the
            // never-typed call marks this branch as terminated.
            return process.exit(1);
        }

        if (result.username && result.username.length > 0) {
            // Branch 1 — live token.
            if (asJson) {
                process.stdout.write(`${JSON.stringify({ username: result.username, registry: registryClean })}\n`);
            } else {
                process.stdout.write(`Logged in as: ${result.username}\n`);
                process.stdout.write(`Registry:     ${registryClean}\n`);
            }
            return;
        }

        // Branch 2 — dead/revoked token (registry returned `{}`).
        if (asJson) {
            process.stdout.write(`${JSON.stringify({ error: 'dead-token', registry: registryClean })}\n`);
        } else {
            process.stderr.write(
                [
                    'gjsify whoami: token appears dead or revoked (registry returned an empty whoami response).',
                    '',
                    'Refresh via: npm login',
                    'Then verify: gjsify whoami',
                    '',
                    'For the @gjsify scope, see AGENTS.md > "New @gjsify/* package: first-publish + Trusted Publisher bootstrap".',
                ].join('\n') + '\n',
            );
        }
        process.exit(1);
    },
};
