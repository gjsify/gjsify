// Helpers for editing `package.json` during `gjsify install <pkg>`, mirroring npm:
// `--save-{dev,peer,optional}` pick the matching block and no flag means
// `dependencies`; the saved range is `^x.y.z` off the installed version unless the
// spec carried an explicit one (`react@^18` stays `^18`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type DependencyKind = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

export interface PackageJson {
    name?: string;
    version?: string;
    type?: string;
    workspaces?: string[] | { packages?: string[]; nohoist?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    private?: boolean;
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
 * Existing dependencies + devDependencies + optionalDependencies as `name@range`
 * specs — what seeds the resolver for a bare `gjsify install`, the way `npm install`
 * reads `package.json`.
 */
export function projectSpecsFromPackageJson(pkg: PackageJson): string[] {
    const out: string[] = [];
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
        const block = pkg[kind];
        if (!block) continue;
        for (const [name, range] of Object.entries(block)) {
            // `workspace:`/`link:`/`file:`/`portal:` are workspace-local references
            // resolved by the workspace install path, not this project-local one.
            if (typeof range !== 'string') continue;
            if (/^(workspace|link|file|portal|git\+|https?):/.test(range)) continue;
            out.push(`${name}@${range}`);
        }
    }
    return out;
}

/**
 * Add or update a dependency entry in `pkg`. When the spec carried no range, the
 * caller calls this a second time after resolution, with `range` derived from the
 * installed version via {@link defaultRangeFromVersion}.
 */
export function addDependencyEntry(pkg: PackageJson, name: string, range: string, kind: DependencyKind): void {
    if (pkg[kind] === undefined) {
        pkg[kind] = {} as Record<string, string>;
    }
    (pkg[kind] as Record<string, string>)[name] = range;
}

/** Range used when the user pinned none — npm's `save-prefix` default (`^`). */
export function defaultRangeFromVersion(version: string): string {
    return `^${version}`;
}

function sortKnownDepFields(pkg: PackageJson): PackageJson {
    const out: PackageJson = { ...pkg };
    for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        const block = out[kind];
        if (!block) continue;
        out[kind] = Object.fromEntries(Object.entries(block).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return out;
}
