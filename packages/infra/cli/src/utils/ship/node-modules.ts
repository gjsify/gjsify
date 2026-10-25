// SPDX-License-Identifier: MIT
// npm packages an `--app node` bundle imports but cannot contain: found, then staged as a TREE.
//
// WHY THIS EXISTS. `rolldown-plugin-gjsify`'s `nodeNativeExternalPlugin` keeps every Node-API
// addon package EXTERNAL in an `--app node` bundle, because an addon finds its `.node` relative
// to its own files and a bundle moves them ("an `--app node` bundle of a native dependency needs
// `node_modules` at runtime, like any `npm install`-ed program"). A shipped `.app` or program
// directory has no `npm install`. Until this module the only package `ship` carried was
// `@gjsify/node-gi`, by name — so a project with one more native dependency produced an artifact
// that fails at its first `import` on every machine but the author's. Measured on a real consumer
// (Stamped, `node-llama-cpp`): the released macOS `.app` exited with
// `ERR_MODULE_NOT_FOUND: Cannot find package 'node-llama-cpp'` before opening a window, and no
// CI step noticed because nothing ever started the artifact.
//
// THE DECLARATION. `gjsify.ship.nodeModules` lists package NAMES, nothing else. The names are the
// entry points the bundle imports; this module adds everything they need at runtime.
//
// THE CLOSURE is node's own resolution rule applied to the installed tree: for each package,
// `dependencies` and `optionalDependencies`, each found by walking `node_modules` upward from the
// package that asks for it. A missing optional dependency is skipped silently — that is the
// per-platform filter (`@node-llama-cpp/mac-arm64-metal` is optional; `gjsify install --os
// darwin --cpu arm64` is what puts the right one on disk) — and a missing required one is an
// error naming the chain, because a package without its dependency is the very artifact this
// exists to prevent.
//
// THE LAYOUT IS THE INSTALLED ONE. Each package lands at the path it was FOUND at, relative to
// the first `node_modules` in that path: `node_modules/a/node_modules/b` stays nested, which is
// how two versions of `yargs` coexist. Flattening would be a guess about which one wins.
//
// NOT INCLUDED: `@gjsify/node-gi`, which `app-runtime.ts` stages as a trimmed tree of its own, and
// any nested `node_modules` that is not reached through a declared dependency (an npm install
// leaves dev-only trees there).

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

import { isExecutableAsset } from './plan.js';
import type { StagedFile } from './types.js';

/** The package this module leaves to `app-runtime.ts`. */
const LEFT_TO_APP_RUNTIME = '@gjsify/node-gi';

interface Manifest {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

/** One package of the closure, ready to stage. */
export interface NodeModulePackage {
    name: string;
    version: string;
    /** Where the files are read from — the installed directory. */
    dir: string;
    /** POSIX path below the staged `node_modules/`: `yargs`, `a/node_modules/b`, `@scope/pkg`. */
    dest: string;
}

export interface NodeModulesClosure {
    packages: NodeModulePackage[];
    /** Optional dependencies that are not installed — expected for other platforms, listed for the log. */
    skippedOptional: string[];
}

function readManifest(dir: string): Manifest | null {
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Manifest;
    } catch {
        return null;
    }
}

/** `<from>/node_modules/<name>`, then each ancestor's — node's lookup, on the file system alone. */
function findInstalled(name: string, from: string): string | null {
    let dir = from;
    for (;;) {
        const candidate = join(dir, 'node_modules', ...name.split('/'));
        if (existsSync(join(candidate, 'package.json'))) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** The path below the first `node_modules` segment, POSIX-separated, or `null` when there is none. */
function destinationOf(found: string): string | null {
    const parts = found.split(sep);
    const at = parts.indexOf('node_modules');
    return at === -1 || at === parts.length - 1 ? null : parts.slice(at + 1).join('/');
}

/**
 * Resolve `names` and everything they need at runtime, from `cwd`.
 *
 * Throws on a name that is not installed, a required dependency that is not, and two different
 * installed copies that would land on one staged path.
 */
export function resolveNodeModulesClosure(names: readonly string[], cwd: string): NodeModulesClosure {
    const packages = new Map<string, NodeModulePackage>();
    const skippedOptional: string[] = [];

    const visit = (name: string, from: string, via: string[], optional: boolean): void => {
        if (name === LEFT_TO_APP_RUNTIME) return;
        const found = findInstalled(name, from);
        if (found === null) {
            if (optional) {
                if (!skippedOptional.includes(name)) skippedOptional.push(name);
                return;
            }
            throw new Error(
                `gjsify ship: \`${name}\` is not installed${via.length > 0 ? ` (needed by ${via.join(' > ')})` : ''}. ` +
                    (via.length === 0
                        ? '`gjsify.ship.nodeModules` names it, so the artifact must carry it — install it, or remove the entry.'
                        : 'A package without its required dependency is an artifact that fails at its first import.'),
            );
        }
        const dest = destinationOf(found);
        if (dest === null) {
            throw new Error(
                `gjsify ship: ${found} is not inside a node_modules directory, so it has no place to be staged.`,
            );
        }
        const dir = realpathSync(found);
        const manifest = readManifest(dir);
        if (manifest === null) throw new Error(`gjsify ship: ${join(dir, 'package.json')} is unreadable.`);
        const existing = packages.get(dest);
        if (existing !== undefined) {
            if (existing.dir !== dir) {
                throw new Error(
                    `gjsify ship: two installed copies of \`${name}\` would both be staged at node_modules/${dest} ` +
                        `(${existing.dir} and ${dir}).`,
                );
            }
            return;
        }
        packages.set(dest, { name, version: manifest.version ?? '0.0.0', dir, dest });
        const chain = [...via, name];
        for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, found, chain, false);
        for (const dep of Object.keys(manifest.optionalDependencies ?? {})) visit(dep, found, chain, true);
    };

    for (const name of names) visit(name, cwd, [], false);
    return {
        packages: [...packages.values()].sort((a, b) => (a.dest < b.dest ? -1 : 1)),
        skippedOptional: skippedOptional.sort(),
    };
}

/**
 * Every file of one package, package-relative, without the `node_modules` directories inside it —
 * those are separate packages of the closure, or not wanted at all.
 */
function listPackageFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules') walk(full);
            } else if (entry.isSymbolicLink()) {
                throw new Error(
                    `gjsify ship: ${full} is a symlink. The payload has to be self-contained — a package that ` +
                        'links inside itself needs the link replaced by the file.',
                );
            } else if (entry.isFile()) {
                out.push(posix.join(...relative(root, full).split(sep)));
            }
        }
    };
    walk(root);
    return out;
}

/** 0755 for what the source marks executable or is a shared library, 0644 for the rest. */
function modeOf(rel: string, abs: string): number {
    if (isExecutableAsset(rel)) return 0o755;
    return (statSync(abs).mode & 0o111) !== 0 ? 0o755 : 0o644;
}

/** The closure as stage-relative files, under `<bundleDir>/node_modules/`. */
export function stageNodeModules(closure: NodeModulesClosure, bundleDir: string): StagedFile[] {
    const files: StagedFile[] = [];
    for (const pkg of closure.packages) {
        for (const rel of listPackageFiles(pkg.dir)) {
            const abs = join(pkg.dir, ...rel.split('/'));
            files.push({
                path: posix.join(bundleDir, 'node_modules', pkg.dest, rel),
                mode: modeOf(rel, abs),
                source: { kind: 'file', path: abs },
            });
        }
    }
    return files;
}
