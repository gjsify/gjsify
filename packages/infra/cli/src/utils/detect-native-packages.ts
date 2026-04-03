// Utility to find npm packages with gjsify native prebuilds.
// Packages declare: "gjsify": { "prebuilds": "<dir>" } in their package.json.
// The CLI uses this to auto-set LD_LIBRARY_PATH / GI_TYPELIB_PATH before running gjs.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * Walk up the directory tree from `startDir` looking for a node_modules directory.
 * Returns all native packages found in the first node_modules encountered.
 *
 * Note: This intentionally stops at the first node_modules to match how Node.js
 * resolves packages from the perspective of the calling project.
 */
export function detectNativePackages(startDir: string): NativePackage[] {
    const arch = nodeArchToLinuxArch(process.arch);
    let dir = resolve(startDir);

    // Walk up to filesystem root
    while (true) {
        const nodeModulesDir = join(dir, 'node_modules');
        if (existsSync(nodeModulesDir)) {
            return scanNodeModules(nodeModulesDir, arch);
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }

    return [];
}

/** Walk up from dir to find the nearest package.json. */
function findNearestPackageJson(startDir: string): string | null {
    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) return candidate;
        const parent = resolve(dir, '..');
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Resolve native packages using Node.js module resolution from a given file path.
 * Reads the nearest package.json to discover dependencies, then checks each
 * for gjsify native prebuilds metadata.
 *
 * This complements detectNativePackages() (filesystem walk from CWD) by using
 * require.resolve() — which handles hoisting, workspaces, and nested node_modules.
 */
export function resolveNativePackages(fromFilePath: string): NativePackage[] {
    const arch = nodeArchToLinuxArch(process.arch);
    const results: NativePackage[] = [];

    try {
        const req = createRequire(pathToFileURL(fromFilePath).href);

        // Find the nearest package.json to get the dependency list
        const nearestPkgJson = findNearestPackageJson(dirname(resolve(fromFilePath)));
        if (!nearestPkgJson) return results;

        const pkg = readPackageJson(nearestPkgJson);
        if (!pkg) return results;

        const deps = pkg['dependencies'] as Record<string, string> | undefined;
        if (!deps) return results;

        for (const depName of Object.keys(deps)) {
            try {
                // Resolve the package's main entry, then walk up to find its package.json.
                // We cannot use require.resolve(name + '/package.json') because packages
                // with an "exports" field may not expose ./package.json as a subpath.
                const entryPath = req.resolve(depName);
                const depPkgJson = findNearestPackageJson(dirname(entryPath));
                if (!depPkgJson) continue;
                const native = checkPackage(dirname(depPkgJson), depName, arch);
                if (native) results.push(native);
            } catch {
                // Dependency not resolvable — skip
            }
        }
    } catch {
        // Resolution failed — return empty
    }

    return results;
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
