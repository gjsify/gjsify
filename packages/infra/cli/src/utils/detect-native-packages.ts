// Utility to find npm packages with gjsify native prebuilds.
// Packages declare: "gjsify": { "prebuilds": "<dir>" } in their package.json.
// The CLI uses this to auto-set LD_LIBRARY_PATH / GI_TYPELIB_PATH before running gjs.
//
// One algorithm — `detectNativePackages(startDir)` — walks up from `startDir`
// and exhaustively scans every `node_modules` it finds. Used by:
//   * `gjsify run`, `gjsify info`, `gjsify install` — startDir = process.cwd()
//   * `runGjsBundle()` — startDir = dirname(bundlePath), so DLX-cache layouts
//     (`~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/bundle.js`) get
//     their full transitive prebuild set picked up automatically. The
//     transitive walk is what makes `gjsify showcase` / `gjsify dlx` work
//     for packages whose Vala typelibs live in *indirect* deps.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface NativePackage {
    /** npm package name, e.g. "@gjsify/webgl" */
    name: string;
    /** Absolute path to the arch-specific prebuilds dir, e.g. "/…/@gjsify/webgl/prebuilds/linux-x86_64" */
    prebuildsDir: string;
}

/** Map Node.js process.arch values to the convention used in prebuilds/ directories. */
function nodeArchToLinuxArch(arch: string): string {
    const map: Record<string, string> = {
        x64: 'x86_64',
        arm64: 'aarch64',
        arm: 'armv7',
        ia32: 'i686',
    };
    return map[arch] ?? arch;
}

/** Read a package.json file and return its parsed content, or null on error. */
function readPackageJson(pkgJsonPath: string): Record<string, unknown> | null {
    try {
        return JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Scan all packages in a node_modules directory for gjsify native prebuilds.
 * Handles scoped packages (@scope/name) as well as flat packages.
 */
function scanNodeModules(nodeModulesDir: string, arch: string): NativePackage[] {
    const results: NativePackage[] = [];
    if (!existsSync(nodeModulesDir)) return results;

    let entries: string[];
    try {
        entries = readdirSync(nodeModulesDir);
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        if (entry.startsWith('@')) {
            // Scoped packages — one more level deep
            const scopeDir = join(nodeModulesDir, entry);
            let scopeEntries: string[];
            try {
                scopeEntries = readdirSync(scopeDir);
            } catch {
                continue;
            }
            for (const scopedPkg of scopeEntries) {
                const pkgDir = join(scopeDir, scopedPkg);
                const native = checkPackage(pkgDir, `${entry}/${scopedPkg}`, arch);
                if (native) results.push(native);
            }
        } else {
            const pkgDir = join(nodeModulesDir, entry);
            const native = checkPackage(pkgDir, entry, arch);
            if (native) results.push(native);
        }
    }

    return results;
}

/** Check a single package directory for gjsify prebuilds metadata. */
function checkPackage(pkgDir: string, name: string, arch: string): NativePackage | null {
    const pkgJson = readPackageJson(join(pkgDir, 'package.json'));
    if (!pkgJson) return null;

    const gjsifyMeta = pkgJson['gjsify'];
    if (!gjsifyMeta || typeof gjsifyMeta !== 'object') return null;

    const prebuildsField = (gjsifyMeta as Record<string, unknown>)['prebuilds'];
    if (typeof prebuildsField !== 'string') return null;

    const prebuildsDir = join(pkgDir, prebuildsField, `linux-${arch}`);
    if (!existsSync(prebuildsDir)) return null;

    return { name, prebuildsDir };
}

/**
 * Walk up the directory tree from `startDir` and merge native packages found
 * in every `node_modules` encountered.
 *
 * We keep walking past the first node_modules because yarn v4 / pnpm hoisting
 * puts a project's direct deps in a local node_modules (often just `.cache/`
 * or a subset) while hoisted transitive deps live in a root `node_modules`
 * higher up. Node's own resolver also walks the chain — returning only the
 * first hit would miss root-hoisted native packages.
 *
 * Deduplication: the first match for a given package name wins (closer
 * node_modules shadows outer ones), matching Node.js resolution semantics.
 */
export function detectNativePackages(startDir: string): NativePackage[] {
    const arch = nodeArchToLinuxArch(process.arch);
    const merged: NativePackage[] = [];
    const seen = new Set<string>();
    let dir = resolve(startDir);

    while (true) {
        const nodeModulesDir = join(dir, 'node_modules');
        if (existsSync(nodeModulesDir)) {
            for (const pkg of scanNodeModules(nodeModulesDir, arch)) {
                if (seen.has(pkg.name)) continue;
                seen.add(pkg.name);
                merged.push(pkg);
            }
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }

    return merged;
}

/**
 * Build the LD_LIBRARY_PATH and GI_TYPELIB_PATH env var values for the detected native packages.
 * Prepends the new paths to any existing values from the environment.
 */
export function buildNativeEnv(packages: NativePackage[]): { LD_LIBRARY_PATH: string; GI_TYPELIB_PATH: string } {
    const dirs = packages.map(p => p.prebuildsDir);

    const existing_ld = process.env['LD_LIBRARY_PATH'] ?? '';
    const existing_gi = process.env['GI_TYPELIB_PATH'] ?? '';

    const LD_LIBRARY_PATH = [...dirs, ...(existing_ld ? [existing_ld] : [])].join(':');
    const GI_TYPELIB_PATH = [...dirs, ...(existing_gi ? [existing_gi] : [])].join(':');

    return { LD_LIBRARY_PATH, GI_TYPELIB_PATH };
}
