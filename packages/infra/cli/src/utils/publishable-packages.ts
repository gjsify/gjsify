// Publishable-package discovery shared by `gjsify trust` and `gjsify onboard`.
//
// `discoverWorkspaces` only sees ROOT WORKSPACES, and some publishable packages
// deliberately are not: each is an independent native engine with its own CI
// workflow, kept out of the graph so a full `gjsify foreach` never tries to build
// it. They still publish through `release.yml`, so a sweep that reasons about
// "what do we publish" must include them — otherwise it silently under-reports and
// the package's first release fails the OIDC exchange with `404 — package not
// found`. Measured: `gjsify onboard` called 127 packages "already done" while
// `@gjsify/napi` was neither listed nor published, because only
// `packages/node-gi/*` had been carved out.

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Workspace } from '@gjsify/workspace';

/**
 * Package-group directories holding publishable packages that are NOT root
 * workspaces. Extend this the moment a new such group appears — the list is the
 * only thing standing between one and a silently broken first release.
 */
export const NON_WORKSPACE_PUBLISHABLE_DIRS = [
    ['packages', 'node-gi'], // @gjsify/node-gi + the @gjsify/gtk-runtime-* bundles
    ['packages', 'napi'], // @gjsify/napi (the N-API host in GJS, own napi.yml)
    ['packages', 'node-runtime'], // the @gjsify/node-runtime-* bundled Node interpreters
] as const;

/**
 * Publishable packages in {@link NON_WORKSPACE_PUBLISHABLE_DIRS}, shaped as
 * `Workspace` entries so callers can treat them like any other package.
 *
 * Best-effort by design — a missing directory or malformed manifest is skipped,
 * not thrown: this runs inside sweeps whose value is covering everything reachable.
 */
export function discoverNonWorkspacePublishables(cwd: string): Workspace[] {
    // Walk up to the repo root, anchored on the FIRST configured group rather than
    // on `packages/` itself, which also exists inside individual packages.
    let root = cwd;
    const anchor = NON_WORKSPACE_PUBLISHABLE_DIRS[0];
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(root, ...anchor))) break;
        const parent = dirname(root);
        if (parent === root) return [];
        root = parent;
    }

    const out: Workspace[] = [];
    for (const group of NON_WORKSPACE_PUBLISHABLE_DIRS) {
        const base = join(root, ...group);
        if (!existsSync(base)) continue;
        let entries: Dirent[];
        try {
            entries = readdirSync(base, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const location = join(base, entry.name);
            const pkgPath = join(location, 'package.json');
            if (!existsSync(pkgPath)) continue;
            try {
                const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
                if (!manifest || typeof manifest.name !== 'string' || manifest.name.length === 0) continue;
                out.push({
                    location,
                    relativeLocation: join(...group, entry.name),
                    name: manifest.name,
                    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
                    manifest,
                    private: manifest.private === true,
                });
            } catch {
                /* unreadable / malformed — skip */
            }
        }
    }
    return out;
}

/**
 * Merge workspace-discovered packages with the non-workspace publishables,
 * deduped by name. A real workspace always wins over a scanned directory.
 */
export function mergePublishables(workspaces: Workspace[], cwd: string): Workspace[] {
    const seen = new Set(workspaces.map((ws) => ws.name));
    return [...workspaces, ...discoverNonWorkspacePublishables(cwd).filter((ws) => !seen.has(ws.name))];
}
