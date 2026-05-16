// Walk up from a starting directory to the first ancestor whose
// `package.json` declares a `workspaces` field — the monorepo root.
//
// Used by `gjsify run`, `gjsify workspace`, and `gjsify foreach`: each
// can be invoked from inside any workspace (chained script calls put the
// child CLI invocation's cwd at the inner workspace's location), and
// every one of them needs the monorepo root to discover sibling
// workspaces, resolve `workspace:^` deps, and walk the dep graph.
//
// Sanity-checked via `discoverWorkspaces(candidate)`: the candidate
// monorepo must actually contain `start` as one of its workspaces.
// Without this guard, a grand-parent monorepo unrelated to `start`
// could be picked up.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverWorkspaces } from '@gjsify/workspace';

interface MinimalPkg {
    workspaces?: unknown;
}

function readPackageJson(path: string): MinimalPkg | null {
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as MinimalPkg;
    } catch {
        return null;
    }
}

export function findWorkspaceRoot(start: string): string | null {
    let dir = start;
    for (let i = 0; i < 12; i++) {
        const pkgPath = join(dir, 'package.json');
        if (existsSync(pkgPath)) {
            const pkg = readPackageJson(pkgPath);
            if (pkg?.workspaces !== undefined) {
                try {
                    const ws = discoverWorkspaces(dir);
                    if (dir === start || ws.some((w) => w.location === start)) return dir;
                } catch { /* not a usable workspace root */ }
            }
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}
