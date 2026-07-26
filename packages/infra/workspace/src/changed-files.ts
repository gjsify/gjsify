// Map a `git diff --name-only` file list onto the workspaces that own the
// files — the seed step of the CI affected-test classifier.

import type { Workspace } from './types.js';

/**
 * Map a list of changed file paths (repo-relative, `git diff --name-only`
 * shape) to the set of workspaces that OWN those files. A file is
 * considered owned by the deepest workspace whose `relativeLocation` is
 * an ancestor path. Files outside every workspace are returned in
 * `unmatched` so the caller can classify them (docs / lockfile / global
 * trigger / etc.).
 *
 * Match is path-segment-based — `packages/node/fs/src/x.ts` belongs to
 * `packages/node/fs`, NOT `packages/node/fs-promises` even though the
 * latter is a prefix-of-string match. Each path is normalised to forward
 * slashes before comparison so Windows-style diffs are handled too.
 *
 * Purely a string operation: both sides are already relative to the same
 * root (`Workspace.relativeLocation` comes from `discoverWorkspaces(root)`,
 * the paths come from a `git diff` run in that same root), so no root
 * directory is needed. An ABSOLUTE path therefore matches nothing and lands
 * in `unmatched`, which callers treat as "can't be precise → run everything".
 *
 * @returns `matched` — Set of `Workspace.name` strings. `unmatched` — the
 *   subset of input paths that did not fall under any workspace.
 */
export function workspacesForChangedFiles(
    workspaces: readonly Workspace[],
    changedFiles: readonly string[],
): { matched: Set<string>; unmatched: string[] } {
    // Build a longest-prefix lookup: split each workspace.relativeLocation
    // into segments, then match changed-file segments from the root.
    const matched = new Set<string>();
    const unmatched: string[] = [];
    // Index workspaces by segment prefix for O(depth) lookup per file.
    // Tree shape: `Map<string, {ws?: string, children: Map<...>}>`.
    interface Node {
        ws?: string;
        children: Map<string, Node>;
    }
    const root: Node = { children: new Map() };
    for (const ws of workspaces) {
        if (ws.relativeLocation === '.' || ws.relativeLocation === '') continue;
        const segments = ws.relativeLocation.split('/').filter(Boolean);
        let cur = root;
        for (const seg of segments) {
            let next = cur.children.get(seg);
            if (!next) {
                next = { children: new Map() };
                cur.children.set(seg, next);
            }
            cur = next;
        }
        cur.ws = ws.name;
    }

    for (const raw of changedFiles) {
        if (!raw) continue;
        const path = raw.replace(/\\/g, '/');
        const segments = path.split('/').filter(Boolean);
        let cur: Node | undefined = root;
        let bestMatch: string | undefined;
        for (const seg of segments) {
            cur = cur.children.get(seg);
            if (!cur) break;
            // Deepest match wins — a file inside a nested workspace
            // belongs to that workspace, not its grandparent.
            if (cur.ws) bestMatch = cur.ws;
        }
        if (bestMatch) {
            matched.add(bestMatch);
        } else {
            unmatched.push(raw);
        }
    }
    return { matched, unmatched };
}
