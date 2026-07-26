// Publishable-package discovery shared by `gjsify trust` and `gjsify onboard`.
//
// `discoverWorkspaces` only sees ROOT WORKSPACES. Some publishable packages
// deliberately are not: each is an independent native engine with its own CI
// workflow, kept out of the workspace graph so a full `gjsify foreach` never
// tries to build it. They still publish through `release.yml`, so every sweep
// that reasons about "what do we publish" has to include them — otherwise the
// sweep silently under-reports and the package's first release fails the OIDC
// exchange with `404 — package not found`.
//
// That is not hypothetical: `gjsify onboard` reported 127 packages "already
// done" on 2026-07-26 while `@gjsify/napi` was neither in the list nor
// published at all, because only `packages/node-gi/*` was carved out.

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Workspace } from '@gjsify/workspace';

/**
 * Package-group directories holding publishable packages that are NOT root
 * workspaces. Add one here the moment a new non-workspace publishable group
 * appears — this list is the only thing standing between such a package and a
 * silently broken first release.
 */
export const NON_WORKSPACE_PUBLISHABLE_DIRS = [
    ['packages', 'node-gi'], // @gjsify/node-gi + the @gjsify/gtk-runtime-* bundles
    ['packages', 'napi'], // @gjsify/napi (the N-API host in GJS, own napi.yml)
] as const;

/**
 * Publishable packages in {@link NON_WORKSPACE_PUBLISHABLE_DIRS}, shaped as
 * `Workspace` entries so callers can treat them like any other package.
 *
 * Best-effort by design: a missing directory or an unreadable/malformed
 * manifest is skipped rather than thrown, because this runs inside sweeps whose
 * value is covering everything they can reach.
 */
export function discoverNonWorkspacePublishables(cwd: string): Workspace[] {
    // Walk up to the repo root. Anchored on the FIRST configured group rather
    // than on `packages/` itself, which also exists inside individual packages.
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
