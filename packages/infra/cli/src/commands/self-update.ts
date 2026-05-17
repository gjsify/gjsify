// `gjsify self-update` — refresh the installed @gjsify/cli to a newer release.
//
// Walks `import.meta.url` to find this CLI's own package.json (works whether
// running from `lib/index.js` under Node or the published `dist/cli.gjs.mjs`
// bundle under GJS). Compares against the latest version on the npm registry
// (or the requested `--tag`); when an upgrade is needed, re-uses the existing
// `installPackages` + `linkGlobalBins` pipeline to lay down the new tree at
// the user-global XDG location.
//
// Limitation: only works when the current CLI is installed under
// `defaultGlobalLayout().prefix` (i.e. via `gjsify install -g` or via the
// `install.mjs` bootstrap). Installs from `npm install -g @gjsify/cli` land
// elsewhere and we don't try to chase them — we print a warning and exit.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPackument, type Packument } from '@gjsify/npm-registry';
import type { Command } from '../types/index.js';
import { installPackages } from '../utils/install-backend.js';
import { defaultGlobalLayout, linkGlobalBins } from '../utils/install-global.js';

interface SelfUpdateOptions {
    check?: boolean;
    force?: boolean;
    tag: string;
}

const PACKAGE_NAME = '@gjsify/cli';

export const selfUpdateCommand: Command<any, SelfUpdateOptions> = {
    command: 'self-update',
    description:
        `Update the installed ${PACKAGE_NAME} to the latest release (or pinned --tag).`,
    builder: (yargs) =>
        yargs
            .option('check', {
                description:
                    'Only check whether a newer version is available; do not install.',
                type: 'boolean',
                default: false,
            })
            .option('force', {
                description:
                    'Reinstall even when the current version already matches the target tag.',
                type: 'boolean',
                default: false,
            })
            .option('tag', {
                description:
                    'npm dist-tag or pinned version to install (e.g. `latest`, `next`, `0.5.0`).',
                type: 'string',
                default: 'latest',
            }) as any,
    handler: async (args: SelfUpdateOptions) => {
        const layout = defaultGlobalLayout();
        const installedPkgDir = join(layout.prefix, 'node_modules', PACKAGE_NAME);
        const installedPkgJson = join(installedPkgDir, 'package.json');

        const currentVersion = readCurrentVersion();
        const installedAtPrefix = existsSync(installedPkgJson);

        console.log(`Current ${PACKAGE_NAME}: v${currentVersion ?? '(unknown)'}`);
        if (!installedAtPrefix) {
            console.warn(
                `\nWarning: no @gjsify/cli install found under ${layout.prefix}.\n` +
                    `self-update only manages installs created by install.mjs or \`gjsify install -g\`.\n` +
                    `If you installed via \`npm install -g\`, remove that and use:\n` +
                    `  curl -fsSL https://github.com/gjsify/gjsify/releases/latest/download/install.mjs -o /tmp/g.mjs && gjs -m /tmp/g.mjs && rm /tmp/g.mjs`,
            );
        }

        console.log(`Fetching dist-tags for ${PACKAGE_NAME}@${args.tag} ...`);
        let packument: Packument;
        try {
            packument = await fetchPackument(PACKAGE_NAME);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to fetch packument: ${msg}`);
            process.exit(1);
            return;
        }

        const target = resolveTag(packument, args.tag);
        if (!target) {
            console.error(
                `Unknown dist-tag '${args.tag}' on ${PACKAGE_NAME}. ` +
                    `Known tags: ${Object.keys(packument['dist-tags'] ?? {}).join(', ') || '(none)'}`,
            );
            process.exit(1);
            return;
        }

        console.log(`Latest matching --tag ${args.tag}: v${target}`);

        if (currentVersion === target && !args.force) {
            console.log(`Already up to date (v${target}).`);
            if (!args.check) console.log(`Run with --force to reinstall anyway.`);
            return;
        }

        if (args.check) {
            console.log(
                currentVersion
                    ? `Update available: v${currentVersion} → v${target}`
                    : `Install required: → v${target}`,
            );
            process.exit(1);
            return;
        }

        console.log(`Installing ${PACKAGE_NAME}@${target} ...`);
        await installPackages({
            prefix: layout.prefix,
            specs: [`${PACKAGE_NAME}@${target}`],
            verbose: false,
        });
        const linked = linkGlobalBins([PACKAGE_NAME], layout);
        if (linked.length === 0) {
            console.warn(
                'self-update: install completed but no bins were linked — package.json may be missing a `bin` field.',
            );
        } else {
            for (const bin of linked) {
                console.log(`  • ${bin.link}  →  ${bin.target}`);
            }
        }
        console.log(`\nUpdated ${PACKAGE_NAME} to v${target}.`);
    },
};

/**
 * Resolve the CLI's own `package.json#version`. Walks up from
 * `import.meta.url` (the bundle file under GJS, or `lib/index.js` under
 * Node) until it finds a package.json with `name === '@gjsify/cli'`.
 */
function readCurrentVersion(): string | null {
    try {
        const here = fileURLToPath(import.meta.url);
        let dir = dirname(resolve(here));
        for (let i = 0; i < 8 && dir !== dirname(dir); i++) {
            const candidate = join(dir, 'package.json');
            if (existsSync(candidate)) {
                const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
                    name?: string;
                    version?: string;
                };
                if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
                    return pkg.version;
                }
            }
            dir = dirname(dir);
        }
    } catch {
        /* not in a recognizable layout */
    }
    return null;
}

function resolveTag(packument: Packument, tag: string): string | null {
    const distTags = (packument['dist-tags'] ?? {}) as Record<string, string>;
    if (distTags[tag]) return distTags[tag];
    // Allow pinned versions via `--tag 0.5.0`
    if (packument.versions && typeof packument.versions === 'object') {
        if ((packument.versions as Record<string, unknown>)[tag]) return tag;
    }
    return null;
}
