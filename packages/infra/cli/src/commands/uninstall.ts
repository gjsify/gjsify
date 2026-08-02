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
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Argv } from 'yargs';
import type { Command } from '../types/index.js';
import { defaultGlobalLayout, specToPackageName } from '../utils/install-global.js';

interface UninstallOptions {
    packages: string[];
    global?: boolean;
    'dry-run'?: boolean;
    verbose?: boolean;
}

export const uninstallCommand: Command<unknown, UninstallOptions> = {
    command: 'uninstall <packages..>',
    description: 'Uninstall a previously installed package. Currently only `--global` mode is supported.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Package(s) to uninstall (npm names, optionally with version).',
                type: 'string',
                array: true,
                demandOption: true,
            })
            .option('global', {
                description: 'Uninstall from the user-global XDG location (the install -g target).',
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
            }) as Argv<UninstallOptions>,
    handler: (args: UninstallOptions) => {
        if (!args.global) {
            console.error(
                'gjsify uninstall currently only supports --global. ' +
                    'For project-local removal, edit package.json + re-run `gjsify install`.',
            );
            return process.exit(1);
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
 * or (for `.gjs.mjs` / `.mjs` targets, with optional GI_TYPELIB_PATH /
 * LD_LIBRARY_PATH preamble for native @gjsify/* prebuilds):
 *
 *   #!/bin/sh
 *   GI_TYPELIB_PATH='<dirs>'${GI_TYPELIB_PATH:+":$GI_TYPELIB_PATH"}
 *   LD_LIBRARY_PATH='<dirs>'${LD_LIBRARY_PATH:+":$LD_LIBRARY_PATH"}
 *   export GI_TYPELIB_PATH LD_LIBRARY_PATH
 *   exec gjs -m '<absolute-path>' "$@"
 *
 * We extract the single-quoted path on the `exec` line (NOT the first quoted
 * string in the file, which with the preamble is the prebuild dir list) and
 * check whether it's under `pkgDir`. Non-shim files (e.g. unrelated binaries
 * the user installed via `npm install -g`) are skipped silently.
 *
 * WINDOWS
 *
 * `linkGlobalBins` writes THREE files there — the `sh` launcher above plus the
 * `.cmd` and `.ps1` siblings cmd.exe and pwsh need, because Windows runs neither
 * an extension-less file nor a `#!` line. Two bugs stacked on that:
 *
 *   • the containment test was `target.startsWith(pkgDir + '/')`, while both
 *     `pkgDir` and the baked `targetAbs` use `\` there — so the sh launcher
 *     never matched either;
 *   • nothing looked for the `.cmd`/`.ps1` siblings at all — they do not begin
 *     `#!/bin/sh`, so the scan above skips them by construction.
 *
 * Net: `gjsify uninstall -g <pkg>` on Windows deleted the package and left all
 * three launchers pointing at a deleted path. The user then got a crash rather
 * than "command not found", and a later install of a different package with the
 * same bin name stayed shadowed by the stale `.cmd`.
 *
 * The sh launcher stays the ANCHOR — it is written on every platform, so it is
 * the one shape worth parsing — and its siblings are collected by name. That
 * avoids teaching this function to read batch and PowerShell as well.
 */
/**
 * Is `target` `dir` itself, or under it?
 *
 * Asked through `path.relative` rather than a string prefix, so it holds
 * whatever separator either side happens to be spelled with — the string form
 * was `\`-vs-`/` blind on Windows. It also stops `/opt/foo-backup` from reading
 * as inside `/opt/foo`, which a bare `startsWith(dir)` would have allowed.
 */
function isInside(dir: string, target: string): boolean {
    const rel = relative(dir, target);
    if (rel === '') return true;
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

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
            // Find the `exec [gjs -m] '<target>' "$@"` line; the path may
            // contain `:` from the optional prebuild preamble lines, which
            // is why we anchor to `exec ` rather than the first quoted run.
            const execLine = content.split('\n').find((line) => /^exec (?:gjs -m )?'/.test(line));
            if (!execLine) continue;
            const m = execLine.match(/'([^']+)'/);
            if (!m) continue;
            const target = m[1];
            if (isInside(pkgDir, target)) {
                matches.push(fullPath);
                // The Windows companions, when present. `existsSync` rather
                // than a platform check: what decides is whether they were
                // written, and a tree can be inspected from another OS.
                for (const ext of ['.cmd', '.ps1']) {
                    if (existsSync(fullPath + ext)) matches.push(fullPath + ext);
                }
            }
        } catch (err) {
            if (verbose) {
                console.warn(`  ?  could not inspect ${fullPath}: ${(err as Error).message}`);
            }
        }
    }
    return matches;
}
