// Workspace-aware dependency aggregation for `gjsify upgrade`.
//
// Given a flat list of per-workspace dependency declarations, group them by
// package name and surface inconsistencies (the same package declared at
// different version ranges across workspaces). Used by:
//
//   - `gjsify upgrade` interactive table — shows fan-out (count of workspaces
//     declaring the dep) and flags inconsistent declarations with `⚠`.
//   - `gjsify upgrade --align` — offline mode that detects inconsistencies
//     and proposes a single range (the highest semver-satisfying one) without
//     hitting the registry.
//   - `gjsify upgrade --check` — CI gate that exits non-zero when any
//     inconsistency exists.

import { compare, parse } from '@gjsify/semver';

/** Local `gt` shim: `@gjsify/semver` exports `compare` returning -1|0|1. */
function semverGt(a: string, b: string): boolean {
    try {
        return compare(a, b) === 1;
    } catch {
        return false;
    }
}

/** One declaration of an external npm dep inside one workspace's package.json. */
export interface DepDeclaration {
    /** Workspace package name (e.g. `@gjsify/cli`). */
    workspace: string;
    /** Absolute path to the workspace's `package.json`. */
    workspaceLocation: string;
    /** Dependency name (e.g. `rolldown`). */
    name: string;
    /** Which manifest field this declaration lives in. */
    field: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
    /** The original range string (e.g. `^1.0.4`). */
    currentRange: string;
    /** The parsed version (max-satisfying numeric) inside the range, or `null`. */
    currentVersion: string | null;
    /** Range prefix preserved on write-back (`^`, `~`, `>=`, …; `""` for literal). */
    prefix: string;
}

/** Aggregated view of one external dep across all workspaces that declare it. */
export interface DependencyGroup {
    /** Dependency name. */
    name: string;
    /** Every declaration of this dep across the workspace. */
    occurrences: DepDeclaration[];
    /** Set of all unique declared ranges (size > 1 → inconsistency). */
    declaredRanges: Set<string>;
    /** Range string declared by the most workspaces (the de-facto consensus). */
    dominantRange: string;
    /** When ranges disagree, the highest declared semver version across them. */
    highestVersion: string | null;
}

/**
 * Group a flat list of `DepDeclaration`s by dep name. Each group has the full
 * occurrence list plus pre-computed aggregates (consensus range, highest
 * declared version) so callers don't have to re-scan.
 */
export function groupByDependency(decls: readonly DepDeclaration[]): DependencyGroup[] {
    const map = new Map<string, DependencyGroup>();
    for (const d of decls) {
        let g = map.get(d.name);
        if (!g) {
            g = {
                name: d.name,
                occurrences: [],
                declaredRanges: new Set<string>(),
                dominantRange: d.currentRange,
                highestVersion: d.currentVersion,
            };
            map.set(d.name, g);
        }
        g.occurrences.push(d);
        g.declaredRanges.add(d.currentRange);
        if (d.currentVersion) {
            if (!g.highestVersion || semverGt(d.currentVersion, g.highestVersion)) {
                g.highestVersion = d.currentVersion;
            }
        }
    }
    // Second pass: dominantRange = the range with the most occurrences;
    // ties resolve by highest semver, then by lexicographic order.
    for (const g of map.values()) {
        const counts = new Map<string, number>();
        for (const occ of g.occurrences) {
            counts.set(occ.currentRange, (counts.get(occ.currentRange) ?? 0) + 1);
        }
        let bestRange = g.occurrences[0]!.currentRange;
        let bestCount = -1;
        let bestVersion: string | null = null;
        for (const [range, count] of counts.entries()) {
            const v = parse(range.replace(/^[\^~>=<]+/, ''));
            const version = v?.version ?? null;
            if (
                count > bestCount ||
                (count === bestCount && version && bestVersion && semverGt(version, bestVersion)) ||
                (count === bestCount && range < bestRange)
            ) {
                bestRange = range;
                bestCount = count;
                bestVersion = version;
            }
        }
        g.dominantRange = bestRange;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `true` when the group's workspaces declare the dep at >1 distinct range. */
export function isInconsistent(group: DependencyGroup): boolean {
    return group.declaredRanges.size > 1;
}

/**
 * Filter to just the inconsistent groups (>1 distinct range across workspaces).
 * Convenience wrapper for `--align` and `--check` modes.
 */
export function findInconsistencies(groups: readonly DependencyGroup[]): DependencyGroup[] {
    return groups.filter(isInconsistent);
}
