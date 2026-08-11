// Workspace-aware dependency aggregation for `gjsify upgrade`: group per-workspace
// declarations by package name and surface inconsistencies — the same package
// declared at different ranges across workspaces. Drives the interactive table's
// fan-out column, `--align` (propose one range offline, no registry hit) and
// `--check` (CI gate, non-zero on any inconsistency).

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
    name: string;
    field: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
    /** The original range string (e.g. `^1.0.4`). */
    currentRange: string;
    /** Max-satisfying numeric version inside the range, or `null` if unparseable. */
    currentVersion: string | null;
    /** Range prefix preserved on write-back (`^`, `~`, `>=`, …; `""` for literal). */
    prefix: string;
}

/** Aggregated view of one external dep across all workspaces that declare it. */
export interface DependencyGroup {
    name: string;
    occurrences: DepDeclaration[];
    /** Unique declared ranges — size > 1 IS the inconsistency. */
    declaredRanges: Set<string>;
    /** Range declared by the most workspaces: the de-facto consensus. */
    dominantRange: string;
    /** Highest declared semver across the group. */
    highestVersion: string | null;
}

/**
 * Group a flat list of `DepDeclaration`s by dep name, pre-computing the aggregates
 * so no caller has to re-scan the occurrences.
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
    // dominantRange = most occurrences; ties break on highest semver, then lexically.
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

/** The inconsistent groups only — what `--align` and `--check` operate on. */
export function findInconsistencies(groups: readonly DependencyGroup[]): DependencyGroup[] {
    return groups.filter(isInconsistent);
}
