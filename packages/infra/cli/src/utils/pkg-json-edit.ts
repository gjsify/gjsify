// Helpers for editing `package.json` during `gjsify install <pkg>`.
//
// Mirrors npm's `--save-{prod,dev,peer,optional}` semantics:
//   - default → dependencies (production)
//   - --save-dev → devDependencies
//   - --save-peer → peerDependencies
//   - --save-optional → optionalDependencies
//
// Version specifier resolution mirrors npm's default (`^x.y.z` from the
// installed version), unless the user passed an explicit range in the spec
// (`react@^18` → keep `^18`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type DependencyKind =
    | 'dependencies'
    | 'devDependencies'
    | 'peerDependencies'
    | 'optionalDependencies';

export interface PackageJson {
    name?: string;
    version?: string;
    type?: string;
    workspaces?: string[] | { packages?: string[]; nohoist?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    [key: string]: unknown;
}

export function readPackageJson(pkgPath: string): PackageJson | null {
    if (!existsSync(pkgPath)) return null;
    const raw = readFileSync(pkgPath, 'utf-8');
    try {
        return JSON.parse(raw) as PackageJson;
    } catch (e) {
        throw new Error(`gjsify install: ${pkgPath} is not valid JSON: ${(e as Error).message}`);
    }
}

export function writePackageJson(pkgPath: string, pkg: PackageJson): void {
    const sorted = sortKnownDepFields(pkg);
    writeFileSync(pkgPath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/**
 * Parse a user spec into `{ name, range }`:
 *   `react`         → { name: 'react', range: undefined }
 *   `react@^18`     → { name: 'react', range: '^18' }
 *   `@types/node`   → { name: '@types/node', range: undefined }
 *   `@types/node@1` → { name: '@types/node', range: '1' }
 */
export function parseSpec(spec: string): { name: string; range?: string } {
    if (spec.startsWith('@')) {
        const slash = spec.indexOf('/');
        if (slash === -1) return { name: spec };
        const at = spec.indexOf('@', slash + 1);
        if (at === -1) return { name: spec };
        return { name: spec.slice(0, at), range: spec.slice(at + 1) };
    }
    const at = spec.indexOf('@');
    if (at === -1) return { name: spec };
    return { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

/**
 * Collect existing dependencies + devDependencies + optionalDependencies
 * from a project package.json into installable specs of the form
 * `name@range`. Used by `gjsify install` (no args) to seed the resolver
 * with the project's existing dependency manifest — equivalent to
 * `npm install` reading `package.json`.
 */
export function projectSpecsFromPackageJson(pkg: PackageJson): string[] {
    const out: string[] = [];
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
        const block = pkg[kind];
        if (!block) continue;
        for (const [name, range] of Object.entries(block)) {
            // Skip workspace: / link: / file: / portal: specifiers — those
            // are workspace-local references handled by Phase D.3, not by
            // the project-local install path.
            if (typeof range !== 'string') continue;
            if (/^(workspace|link|file|portal|git\+|https?):/.test(range)) continue;
            out.push(`${name}@${range}`);
        }
    }
    return out;
}

/**
 * Add or update a dependency entry in `pkg`. If the spec didn't include
 * a range, callers fill in the installed version after resolution and
 * call this again with `installedVersion` set.
 */
export function addDependencyEntry(
    pkg: PackageJson,
    name: string,
    range: string,
    kind: DependencyKind,
): void {
    if (pkg[kind] === undefined) {
        pkg[kind] = {} as Record<string, string>;
    }
    (pkg[kind] as Record<string, string>)[name] = range;
}

/**
 * Default version range when the user didn't pin one: `^x.y.z` from the
 * installed version. Mirrors npm's `save-prefix` default (`^`).
 */
export function defaultRangeFromVersion(version: string): string {
    return `^${version}`;
}

function sortKnownDepFields(pkg: PackageJson): PackageJson {
    const out: PackageJson = { ...pkg };
    for (const kind of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
    ] as const) {
        const block = out[kind];
        if (!block) continue;
        out[kind] = Object.fromEntries(
            Object.entries(block).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
    }
    return out;
}
