// `gjsify uninstall -g <pkg>` — symmetric inverse of `install -g`.
//
// Removes the installed package tree from the user-global XDG location
// and any bin shims under `~/.local/bin/` that point into it. Mirrors
// the layout decisions in install-global.ts:
//
//   ~/.local/share/gjsify/global/node_modules/<pkg>/   ← deleted
//   ~/.local/bin/<bin>                                  ← deleted iff it
//                                                        execs a path
//                                                        inside the
//                                                        removed tree
//
// Scope: --global only. Project-local uninstall (mirror of `npm uninstall
// <pkg>` without -g) is a separate workstream — it needs to rewrite
// package.json + refresh the lockfile, which install -g doesn't touch.

import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '../types/index.js';
import { defaultGlobalLayout, specToPackageName } from '../utils/install-global.js';

interface UninstallOptions {
    packages: string[];
    global?: boolean;
    'dry-run'?: boolean;
    verbose?: boolean;
}

export const uninstallCommand: Command<any, UninstallOptions> = {
    command: 'uninstall <packages..>',
    description:
        'Uninstall a previously installed package. Currently only `--global` mode is supported.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Package(s) to uninstall (npm names, optionally with version).',
                type: 'string',
                array: true,
                demandOption: true,
            })
            .option('global', {
                description:
                    'Uninstall from the user-global XDG location (the install -g target).',
                type: 'boolean',
                alias: 'g',
                default: false,
            })
            .option('dry-run', {
                description: 'Show what would be removed without touching the filesystem.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Verbose logging.',
                type: 'boolean',
                default: false,
            }) as any,
    handler: (args: UninstallOptions) => {
        if (!args.global) {
            console.error(
                'gjsify uninstall currently only supports --global. ' +
                    'For project-local removal, edit package.json + re-run `gjsify install`.',
            );
            process.exit(1);
            return;
        }

        const layout = defaultGlobalLayout();
        const dryRun = args['dry-run'] ?? false;
        const verbose = args.verbose ?? false;
        const prefix = `gjsify uninstall${dryRun ? ' (dry-run)' : ''} --global`;
        console.log(`${prefix}  ← ${layout.prefix}`);
        console.log(`${' '.repeat(prefix.length)}      bins ← ${layout.binDir}`);

        let removedAny = false;
        for (const spec of args.packages) {
            const pkgName = specToPackageName(spec);
            const pkgDir = join(layout.prefix, 'node_modules', pkgName);

            if (!existsSync(pkgDir)) {
                console.warn(`  ✗  ${pkgName} — not installed at ${pkgDir}`);
                continue;
            }

            // Find bin shims that exec into this package's tree. The shims
            // are POSIX sh launchers written by linkGlobalBins; we identify
            // candidates by reading the launcher script and matching the
            // absolute path.
            const binsToRemove = findBinShimsForPackage(layout.binDir, pkgDir, verbose);

            if (dryRun) {
                console.log(`  •  would remove ${pkgDir}`);
                for (const bin of binsToRemove) {
                    console.log(`  •  would remove ${bin}`);
                }
            } else {
                rmSync(pkgDir, { recursive: true, force: true });
                console.log(`  •  removed ${pkgDir}`);
                for (const bin of binsToRemove) {
                    unlinkSync(bin);
                    console.log(`  •  removed ${bin}`);
                }
            }
            removedAny = true;
        }

        if (!removedAny) {
            console.error('\nNo packages removed.');
            process.exit(1);
        }
    },
};

/**
 * Scan `binDir` for POSIX `sh` launchers whose `exec` target points into
 * `pkgDir`. The launcher shape is fixed by `linkGlobalBins` — either:
 *
 *   #!/bin/sh
 *   exec '<absolute-path>' "$@"
 *
 * or (for `.gjs.mjs` / `.mjs` targets):
 *
 *   #!/bin/sh
 *   exec gjs -m '<absolute-path>' "$@"
 *
 * We parse the absolute path out of the single-quoted segment and check
 * whether it's under `pkgDir`. Non-shim files (e.g. unrelated binaries
 * the user installed via `npm install -g`) are skipped silently.
 */
function findBinShimsForPackage(binDir: string, pkgDir: string, verbose: boolean): string[] {
    if (!existsSync(binDir)) return [];
    const matches: string[] = [];
    let entries: string[];
    try {
        entries = readdirSync(binDir);
    } catch {
        return [];
    }
    for (const name of entries) {
        const fullPath = join(binDir, name);
        try {
            const st = statSync(fullPath);
            if (!st.isFile()) continue;
            const content = readFileSync(fullPath, 'utf-8');
            if (!content.startsWith('#!/bin/sh')) continue;
            // Match the first single-quoted absolute path.
            const m = content.match(/'([^']+)'/);
            if (!m) continue;
            const target = m[1];
            if (target.startsWith(pkgDir + '/') || target === pkgDir) {
                matches.push(fullPath);
            }
        } catch (err) {
            if (verbose) {
                console.warn(`  ?  could not inspect ${fullPath}: ${(err as Error).message}`);
            }
        }
    }
    return matches;
}
