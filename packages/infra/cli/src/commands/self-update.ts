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
//
// AND THE WARNING IS NOT ENOUGH ON ITS OWN (#1064). This command's whole job is
// to change which binary the user's next `gjsify` runs, so success has to be
// measured on PATH, not on the prefix it wrote. Reported from a Windows host:
// the pre-install warning fired, the install succeeded, `Updated @gjsify/cli to
// v0.31.0` printed — and the shell kept resolving a v0.26.0 npm-global install,
// so the very next command re-hit the `dlx` EPERM fixed three releases earlier.
// A silent no-op that reports success is worse than a clean failure, so the
// post-link verification below is fatal.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPackument, type Packument } from '@gjsify/npm-registry';
import type { Argv } from 'yargs';
import type { Command } from '../types/index.js';
import { installPackages, makeProgressReporter } from '../utils/install-backend.js';
import {
    defaultGlobalLayout,
    hasBundlerEngineInstalled,
    installGjsEnginePackages,
    linkGlobalBins,
    resolveBinOnPath,
} from '../utils/install-global.js';

interface SelfUpdateOptions {
    check?: boolean;
    force?: boolean;
    tag: string;
    skipDeps?: boolean;
}

const PACKAGE_NAME = '@gjsify/cli';

export const selfUpdateCommand: Command<unknown, SelfUpdateOptions> = {
    command: 'self-update',
    description: `Update the installed ${PACKAGE_NAME} to the latest release (or pinned --tag).`,
    builder: (yargs) =>
        yargs
            .option('check', {
                description: 'Only check whether a newer version is available; do not install.',
                type: 'boolean',
                default: false,
            })
            .option('force', {
                description: 'Reinstall even when the current version already matches the target tag.',
                type: 'boolean',
                default: false,
            })
            .option('tag', {
                description: 'npm dist-tag or pinned version to install (e.g. `latest`, `next`, `0.5.0`).',
                type: 'string',
                default: 'latest',
            })
            .option('skip-deps', {
                description:
                    'Update only the @gjsify/cli bundle itself; do not pull its runtime dependencies ' +
                    '(rolldown, lightningcss, @gjsify/tsc, the native gi:// bridges, …). Faster, but can ' +
                    'leave the on-disk runtime deps stale relative to the new bundle.',
                type: 'boolean',
                default: false,
            }) as Argv<SelfUpdateOptions>,
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
            return process.exit(1);
        }

        const target = resolveTag(packument, args.tag);
        if (!target) {
            console.error(
                `Unknown dist-tag '${args.tag}' on ${PACKAGE_NAME}. ` +
                    `Known tags: ${Object.keys(packument['dist-tags'] ?? {}).join(', ') || '(none)'}`,
            );
            return process.exit(1);
        }

        console.log(`Latest matching --tag ${args.tag}: v${target}`);

        // A version match is NOT sufficient to declare "up to date": a global
        // GJS install can be on the right `@gjsify/cli` version yet be MISSING
        // the GJS bundler engine (`@gjsify/rolldown-native`) — it's an optional
        // peer the native backend never resolves, so an install.mjs bootstrap
        // before this fix laid down the cli but not the engine, and `gjsify
        // build` hard-fails ("no usable bundler engine"). When the version
        // matches but the engine is absent, REPAIR it (install the engine +
        // re-link) instead of printing "Already up to date". `--skip-deps`
        // still honours its contract (don't touch on-disk deps) and `--check`
        // only reports, so neither triggers the repair.
        const engineMissing = installedAtPrefix && !hasBundlerEngineInstalled(layout.prefix);
        const needsEngineRepair = engineMissing && !args.skipDeps && !args.check;

        if (currentVersion === target && !args.force && !needsEngineRepair) {
            console.log(`Already up to date (v${target}).`);
            if (engineMissing && args.skipDeps) {
                console.log(
                    `Note: the GJS bundler engine @gjsify/rolldown-native is not installed — ` +
                        `re-run without --skip-deps to repair it (\`gjsify build\` needs it under GJS).`,
                );
            }
            if (!args.check) console.log(`Run with --force to reinstall anyway.`);
            return;
        }

        if (needsEngineRepair && currentVersion === target && !args.force) {
            console.log(
                `@gjsify/cli is at v${target} but the GJS bundler engine @gjsify/rolldown-native is missing — repairing.`,
            );
        }

        if (args.check) {
            console.log(
                currentVersion ? `Update available: v${currentVersion} → v${target}` : `Install required: → v${target}`,
            );
            return process.exit(1);
        }

        // `@gjsify/cli` ships two runtimes from one package: the Node `bin`
        // (`lib/index.js`, which imports its deps from `node_modules`) and the
        // self-contained GJS bundle (`dist/cli.gjs.mjs`, which inlines them).
        // The published `dependencies` therefore must cover everything `lib/**`
        // resolves at runtime PLUS the pieces only the GJS runtime loads from
        // disk (the `gi://` native typelib bridges via the launcher's
        // GI_TYPELIB_PATH, `rolldown`/`lightningcss` native addons, the
        // separate `@gjsify/tsc` bundle, `@gjsify/create-app`'s disk templates).
        //
        // By DEFAULT self-update now resolves that full production `dependencies`
        // tree (`skipDeps: false`) so the on-disk runtime deps move in lockstep
        // with the freshly-installed bundle instead of skewing behind it. This is
        // safe today because every `@gjsify/*` package — including the
        // `@gjsify/v8` that once 404'd → 406 and forced `skipDeps: true`
        // unconditionally — is now published to the public registry.
        //
        // `--skip-deps` restores the old fast path: fetch only the top-level
        // `@gjsify/cli` tarball and re-link the bin, leaving runtime deps untouched.
        const pullDeps = !args.skipDeps;
        const depNote = pullDeps ? ' + runtime dependencies' : ' (bundle only)';
        console.log(`Installing ${PACKAGE_NAME}@${target}${depNote} ...`);
        const progress = makeProgressReporter();
        try {
            await installPackages({
                prefix: layout.prefix,
                specs: [`${PACKAGE_NAME}@${target}`],
                verbose: false,
                skipDeps: !pullDeps,
                progress,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`self-update: install failed — ${msg}`);
            console.error(`Re-run \`gjsify self-update\` to retry.`);
            return process.exit(1);
        }

        // Lay down (or repair) the GJS-native engine bridges in lockstep with
        // the bundle — same set + best-effort handling as the global installer.
        // Gated on `pullDeps` so `--skip-deps` keeps its bundle-only contract.
        // Must run BEFORE linkGlobalBins so the launcher's detectNativePackages()
        // bakes the engine's prebuild dirs into the wrapper env preamble.
        if (pullDeps) {
            await installGjsEnginePackages(layout.prefix, target, { verbose: false });
        }

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

        // Did the update change what `gjsify` RUNS? Everything above only proves
        // we wrote the prefix. See the #1064 note at the top of this file.
        const verdict = verifyPathResolution({
            binName: BIN_NAME,
            binDir: layout.binDir,
            resolvedBin: resolveBinOnPath(BIN_NAME),
            runningVersion: currentVersion,
            targetVersion: target,
        });
        if (!verdict.ok) {
            console.error(`\nInstalled ${PACKAGE_NAME} v${target} at ${layout.prefix}`);
            console.error(verdict.message);
            return process.exit(1);
        }

        console.log(`\nUpdated ${PACKAGE_NAME} to v${target}.`);
        if (pullDeps) {
            console.log('Runtime dependencies were resolved alongside the bundle.');
        } else {
            console.log('Bundle-only update (--skip-deps): on-disk runtime dependencies were left unchanged.');
        }
    },
};

/** The bin `@gjsify/cli` installs, and the name a user types. */
const BIN_NAME = 'gjsify';

/** Verdict of the post-install "did this change what runs?" check. */
export type PathVerdict = { ok: true } | { ok: false; message: string };

/**
 * Compare where PATH sends `binName` against the `binDir` we just linked into.
 *
 * Pure so the three outcomes are unit-testable off-host — the interesting two
 * are exactly the ones a developer's own machine never produces, since a working
 * install resolves to its own `binDir` by definition.
 *
 * Path comparison is case-INSENSITIVE on win32: `C:\Users\X\.local\bin` and
 * `c:\users\x\.local\bin` are one directory there, and a case-sensitive compare
 * would report a correct install as shadowed.
 */
export function verifyPathResolution(opts: {
    binName: string;
    binDir: string;
    resolvedBin: string | null;
    /** `null` is what `readCurrentVersion()` returns when it cannot tell. */
    runningVersion: string | null | undefined;
    targetVersion: string;
    platform?: NodeJS.Platform;
}): PathVerdict {
    const platform = opts.platform ?? process.platform;
    // The TARGET platform's path module, never the host's — see `pathFor` in
    // `utils/install-global.ts` for why (`resolve('C:\\x')` on posix is wrong).
    const p = platform === 'win32' ? win32 : posix;
    const norm = (v: string) => (platform === 'win32' ? p.resolve(v).toLowerCase() : p.resolve(v));

    if (opts.resolvedBin === null) {
        return {
            ok: false,
            message:
                `BUT nothing named \`${opts.binName}\` is on PATH, so the update cannot take effect.\n\n` +
                `  Add the bin dir to PATH:\n    ${opts.binDir}`,
        };
    }

    if (norm(p.dirname(opts.resolvedBin)) === norm(opts.binDir)) return { ok: true };

    // Deliberately NOT split into "a rival install" vs "a transient runner"
    // (npx/dlx, whose temp bin wins PATH for the length of the run). Both are the
    // same fact — `gjsify` does not currently mean the tree we just wrote — and
    // guessing which one it is would be a heuristic that can only be wrong. So
    // the finding is stated and both remedies are offered.
    const running = opts.runningVersion ? ` (v${opts.runningVersion})` : '';
    return {
        ok: false,
        message:
            `BUT \`${opts.binName}\` on PATH resolves to\n    ${opts.resolvedBin}${running}\n` +
            `which is NOT the install that was just updated, so the next \`${opts.binName}\`\n` +
            `you run will not be v${opts.targetVersion}.\n\n` +
            `  If that is another install, remove it (e.g. \`npm uninstall -g ${PACKAGE_NAME}\`)\n` +
            `  or put ${opts.binDir} ahead of it on PATH.\n` +
            `  If you ran this through npx/dlx, that temporary copy owns the name only for\n` +
            `  this run — open a new shell and check \`${opts.binName} --version\`.`,
    };
}

/**
 * Resolve the CLI's own `package.json#version`. Walks up from
 * `import.meta.url` (the bundle file under GJS, or `lib/index.js` under
 * Node) until it finds a package.json with `name === '@gjsify/cli'`.
 */
function readCurrentVersion(): string | null {
    try {
        // Escape hatch for tests: point GJSIFY_CLI_PACKAGE_JSON at a synthetic
        // package.json to override the upward-walk discovery.  When set to a
        // file whose `name` does not equal PACKAGE_NAME the function returns
        // null, which is the correct production behaviour for "version unknown".
        const override = process.env.GJSIFY_CLI_PACKAGE_JSON;
        if (override) {
            const pkg = JSON.parse(readFileSync(override, 'utf-8')) as {
                name?: string;
                version?: string;
            };
            if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
                return pkg.version;
            }
            return null;
        }

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
