// Walk up from a starting directory to the first ancestor whose `package.json`
// declares a `workspaces` field — the monorepo root that `gjsify
// run`/`workspace`/`foreach` need to discover siblings, resolve `workspace:^`
// deps and walk the dep graph. They can be invoked from anywhere, because a
// chained script call puts the child CLI's cwd at the inner workspace.
//
// The candidate must also CONTAIN `start` (`discoverWorkspaces`), or an unrelated
// grand-parent monorepo gets picked up.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverWorkspaces } from '@gjsify/workspace';
import { readPackageJson } from './pkg-json.js';

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
                } catch {
                    /* not a usable workspace root */
                }
            }
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}
