// `gjsify upgrade` — drop-in replacement for `yarn upgrade-interactive`
// and `npx npm-check-updates`. Workspace-aware: walks every package.json
// declared by the monorepo, groups by dep name, surfaces inconsistencies.
//
// Modes:
//
//   1. Interactive (default): show outdated packages aggregated across all
//      workspaces, prompt user to select, then write the new ranges to every
//      affected `package.json` (with optional per-workspace override).
//
//   2. Non-interactive bulk (`--latest` / `--minor` / `--patch`): bump
//      matching packages automatically without prompting; same selection
//      logic as above but no UI loop.
//
//   3. `--align`: offline repair mode. Finds deps declared at multiple ranges
//      across the workspace and proposes a single range (the highest declared)
//      — no registry calls. With `--exact` it repairs the second question too:
//      a dep every manifest declares identically as `^4.1.0` is consistent and
//      still carries an operator, so the operator goes as well.
//
//   4. `--check`: CI gate. Exits non-zero when any inconsistency exists; with
//      `--exact`, also when any matched declaration carries a range operator.
//      Whatever `--check` rejects, `--align` with the same flags repairs.
//
// Filters:
//
//   --filter <name>     match against dep name
//   --workspace <pat>   restrict to a subset of workspaces (`-p` shorthand;
//                       repeatable; comma-separated; glob-like — see
//                       `filterWorkspaces` in `@gjsify/workspace`).
//
// Workspace-protocol ranges (`workspace:*`, `workspace:^`, …) are always
// skipped — those are internal links and `gjsify install` resolves them
// locally.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parse } from '@gjsify/semver';
import { DEFAULT_REGISTRY, fetchPackument, parseNpmrc, type NpmrcConfig } from '@gjsify/npm-registry';
import { discoverWorkspaces, filterWorkspaces, type Workspace } from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import {
    groupByDependency,
    findInconsistencies,
    isInconsistent,
    type DepDeclaration,
    type DependencyGroup,
} from '../utils/dep-aggregation.js';
import type { Command } from '../types/index.js';

type ReleaseType = 'major' | 'minor' | 'patch' | 'prerelease' | 'none';

interface UpgradeOptions {
    latest?: boolean;
    minor?: boolean;
    patch?: boolean;
    filter?: string;
    workspace?: string;
    excludeWorkspace?: string;
    align?: boolean;
    check?: boolean;
    exact?: boolean;
    dryRun?: boolean;
    cwd?: string;
    verbose?: boolean;
    yes?: boolean;
}

/** A `DependencyGroup` enriched with registry-resolved upgrade target. */
interface UpgradeGroup extends DependencyGroup {
    latestVersion: string;
    diff: ReleaseType;
}

export const upgradeCommand: Command<unknown, UpgradeOptions> = {
    command: 'upgrade',
    description:
        'Workspace-aware dependency upgrades. Walks every package.json in the monorepo, groups by dep, flags inconsistencies. `--latest` / `--minor` / `--patch` for bulk-mode, `--align` for offline consistency-only mode, `--check` for CI drift detection.',
    builder: (yargs) => {
        return yargs
            .option('latest', {
                description: 'Non-interactive: bump every dependency to its latest version (allows major).',
                type: 'boolean',
                default: false,
            })
            .option('minor', {
                description:
                    'Non-interactive: bump every dependency to the latest within the same major (semver-minor + semver-patch).',
                type: 'boolean',
                default: false,
            })
            .option('patch', {
                description:
                    'Non-interactive: bump every dependency to the latest within the same minor (semver-patch only).',
                type: 'boolean',
                default: false,
            })
            .option('filter', {
                description:
                    'Only consider deps whose name matches this substring (case-insensitive). Repeatable; comma-separated values are split.',
                type: 'string',
            })
            .option('workspace', {
                alias: 'p',
                description:
                    'Restrict to a subset of workspaces. Patterns are matched against the workspace package name AND its directory path (substring + glob). Repeatable; comma-separated values are split.',
                type: 'string',
            })
            .option('exclude-workspace', {
                description:
                    'Skip workspaces matching this pattern (glob-shaped; matched against workspace package name AND directory path). Repeatable; comma-separated values are split. Use for workspaces with intentional dependency drift — e.g. integration tests pinned to specific upstream versions.',
                type: 'string',
            })
            .option('align', {
                description:
                    'Offline repair mode: find deps declared at multiple ranges across the workspace and align them to the highest. With `--exact`, also drop the range operator from declarations that already agree. No registry calls.',
                type: 'boolean',
                default: false,
            })
            .option('check', {
                description:
                    'CI gate: exit non-zero when any dep is declared inconsistently across workspaces. Implies offline (no registry calls). Pairs with `--align` as the fix.',
                type: 'boolean',
                default: false,
            })
            .option('exact', {
                description:
                    'Pin without a range operator. When writing, emits `1.2.3` instead of `^1.2.3`; with `--check`, fails on any matched dep that carries one; with `--align`, repairs exactly that. Pair with `--filter` — a repository-wide exactness run touches every ordinary caret dep by design.',
                type: 'boolean',
                default: false,
            })
            .option('dry-run', {
                description: 'Print the upgrade plan without writing package.json files.',
                type: 'boolean',
                default: false,
            })
            .option('cwd', {
                description:
                    'Project directory. Default: process.cwd(). When inside a workspace, walks up to the monorepo root.',
                type: 'string',
            })
            .option('yes', {
                alias: 'y',
                description: 'Interactive mode: select all without prompting.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Print extra resolution details.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = resolve((args.cwd as string | undefined) ?? process.cwd());

        const ctx = discoverContext(cwd);
        const targetWorkspaces = applyWorkspaceFilter(ctx.workspaces, args.workspace, args.excludeWorkspace);
        if (targetWorkspaces.length === 0) {
            console.log('[gjsify upgrade] no matching workspaces.');
            return;
        }

        const depFilters = parseFilterList(args.filter);
        const decls = collectAllDeclarations(targetWorkspaces, depFilters);
        if (decls.length === 0) {
            console.log('[gjsify upgrade] no external npm dependencies to check.');
            return;
        }

        const groups = groupByDependency(decls);

        // --check: exit non-zero if any inconsistency.
        if (args.check) {
            return runCheckMode(groups, args.exact);
        }

        // --align: offline consistency-only, no registry calls.
        if (args.align) {
            return runAlignMode(groups, args);
        }

        // Normal flow: hit the registry, build upgrade table.
        const npmrc = await loadNpmrcLight(ctx.root);
        const mode: 'latest' | 'minor' | 'patch' | 'interactive' = args.latest
            ? 'latest'
            : args.minor
              ? 'minor'
              : args.patch
                ? 'patch'
                : 'interactive';

        console.log(
            `[gjsify upgrade] checking ${groups.length} unique deps across ${targetWorkspaces.length} workspace(s) against ${npmrc.registry}…`,
        );
        const candidates = await resolveCandidateGroups(groups, npmrc, args.verbose ?? false, mode);

        if (candidates.length === 0) {
            console.log('✅ all dependencies are up to date');
            // Even with no upgrades, surface inconsistencies as a courtesy.
            const inconsistencies = findInconsistencies(groups);
            if (inconsistencies.length > 0) {
                console.log(
                    `\n⚠  ${inconsistencies.length} dep(s) declared at inconsistent ranges across workspaces. Run \`gjsify upgrade --align\` to fix.`,
                );
            }
            return;
        }

        printTable(candidates);

        let selected: UpgradeGroup[];
        if (mode === 'interactive' && !args.yes) {
            selected = await promptSelection(candidates);
        } else if (args.yes && mode === 'interactive') {
            console.log('[gjsify upgrade] -y / --yes: selecting all');
            selected = candidates;
        } else {
            selected = candidates;
        }

        if (selected.length === 0) {
            console.log('[gjsify upgrade] nothing selected; no files changed.');
            return;
        }

        if (args.dryRun) {
            const fileCount = uniqueLocations(selected).length;
            console.log(
                `[gjsify upgrade] --dry-run: would update ${selected.length} deps across ${fileCount} package.json file(s).`,
            );
            printChangePlan(selected, args.exact);
            return;
        }

        const files = applyToFiles(selected, args.exact);
        console.log(
            `✏️  updated ${selected.length} dep(s) across ${files} package.json file(s). Run \`gjsify install\` to apply.`,
        );
    },
};

// ─── Context: workspace-aware discovery ────────────────────────────────

interface UpgradeContext {
    /** Monorepo root absolute path (or the single-package dir when no workspace). */
    root: string;
    /** Discovered workspaces. In single-package mode this has one entry pointing at `cwd`. */
    workspaces: Workspace[];
    isMonorepo: boolean;
}

function discoverContext(cwd: string): UpgradeContext {
    const root = findWorkspaceRoot(cwd);
    if (root) {
        const ws = discoverWorkspaces(root, { includeRoot: true });
        return { root, workspaces: ws, isMonorepo: true };
    }
    // Single-package fallback — keep legacy behavior.
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) {
        throw new Error(`[gjsify upgrade] no package.json at ${pkgPath}`);
    }
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    return {
        root: cwd,
        workspaces: [
            {
                name: (manifest.name as string | undefined) ?? '<root>',
                location: cwd,
                relativeLocation: '.',
                version: (manifest.version as string | undefined) ?? '0.0.0',
                manifest: manifest as unknown as Workspace['manifest'],
                private: manifest.private === true,
            },
        ],
        isMonorepo: false,
    };
}

function applyWorkspaceFilter(
    workspaces: Workspace[],
    include: string | undefined,
    exclude: string | undefined,
): Workspace[] {
    const includePatterns = include
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const excludePatterns = exclude
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if ((!includePatterns || includePatterns.length === 0) && (!excludePatterns || excludePatterns.length === 0)) {
        return workspaces;
    }
    return filterWorkspaces(workspaces, {
        include: includePatterns,
        exclude: excludePatterns,
    });
}

function parseFilterList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

// ─── Per-workspace dep collection ──────────────────────────────────────

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

function collectAllDeclarations(workspaces: readonly Workspace[], depFilters: string[]): DepDeclaration[] {
    const out: DepDeclaration[] = [];
    for (const w of workspaces) {
        for (const decl of collectFromWorkspace(w, depFilters)) {
            out.push(decl);
        }
    }
    return out;
}

function collectFromWorkspace(workspace: Workspace, depFilters: string[]): DepDeclaration[] {
    const out: DepDeclaration[] = [];
    const pkg = workspace.manifest;
    for (const field of DEP_FIELDS) {
        const map = pkg[field];
        if (!map || typeof map !== 'object') continue;
        for (const [name, raw] of Object.entries(map as Record<string, string>)) {
            if (typeof raw !== 'string') continue;
            if (depFilters.length && !depFilters.some((f) => name.toLowerCase().includes(f))) continue;
            // Skip workspace-protocol + file: + link: + git: + http(s): specs.
            if (
                raw.startsWith('workspace:') ||
                raw.startsWith('file:') ||
                raw.startsWith('link:') ||
                raw.startsWith('git+') ||
                raw.startsWith('git:') ||
                raw.startsWith('http:') ||
                raw.startsWith('https:') ||
                raw.startsWith('npm:') ||
                raw.startsWith('portal:')
            ) {
                continue;
            }
            const { prefix, version } = splitRange(raw);
            out.push({
                workspace: workspace.name,
                workspaceLocation: workspace.location,
                name,
                field,
                currentRange: raw,
                currentVersion: version,
                prefix,
            });
        }
    }
    return out;
}

function splitRange(range: string): { prefix: string; version: string | null } {
    const m = range.match(/^(\^|~|>=|<=|>|<|=)?\s*([0-9].*)$/);
    if (!m) return { prefix: '', version: null };
    const prefix = m[1] ?? '';
    const version = m[2]?.split(/\s|[|&,]/)[0] ?? null;
    const parsed = version ? parse(version) : null;
    return { prefix, version: parsed?.version ?? null };
}

// ─── Modes: --check / --align ──────────────────────────────────────────

/**
 * `--exact` half of the CI gate: does every matched dep carry a bare version?
 *
 * Consistency and exactness are different questions, and the first cannot answer the
 * second: a repository where every manifest agrees on `^4.1.0` is perfectly consistent
 * and still lets a minor release move a subpath under a lockfile-less install. That is
 * the hazard ADR 0029 § Risks 1 names for `@girs/*`, whose `./vocabulary` export is what
 * `@gjsify/gtk-host` consumes — so the pin has to be the whole version, and something
 * has to say so on every PR.
 *
 * Returns the number of offending declarations so the caller can exit once for both arms.
 */
export function reportInexactRanges(groups: readonly DependencyGroup[]): number {
    const offenders = groups
        .map((g) => ({ name: g.name, loose: g.occurrences.filter((o) => o.prefix !== '') }))
        .filter((entry) => entry.loose.length > 0);
    if (offenders.length === 0) return 0;

    const total = offenders.reduce((n, entry) => n + entry.loose.length, 0);
    console.error(
        `gjsify upgrade --check --exact: FAIL. ${total} declaration(s) across ${offenders.length} dep(s) carry a range operator:\n`,
    );
    for (const entry of offenders) {
        const byRange = new Map<string, string[]>();
        for (const occ of entry.loose) {
            const list = byRange.get(occ.currentRange) ?? [];
            list.push(occ.workspace);
            byRange.set(occ.currentRange, list);
        }
        console.error(`  ${ANSI.bold}${entry.name}${ANSI.reset}`);
        for (const [range, holders] of byRange.entries()) {
            const shown =
                holders.length > 6 ? `${holders.slice(0, 6).join(', ')} … +${holders.length - 6}` : holders.join(', ');
            console.error(`    ${range.padEnd(16)} — ${shown}`);
        }
    }
    return total;
}

function runCheckMode(groups: readonly DependencyGroup[], exact = false): void {
    const inexact = exact ? reportInexactRanges(groups) : 0;
    const inconsistencies = findInconsistencies(groups);
    if (inconsistencies.length === 0 && inexact > 0) {
        console.error(
            `\nFix: run \`gjsify upgrade --align --exact\` (offline; drops the operator and keeps the version).`,
        );
        // `return`, not a bare call: under GJS the process does not halt here, and the
        // consistency report below would run on top of the exactness one.
        return process.exit(1);
    }
    if (inconsistencies.length === 0) {
        console.log(
            `gjsify upgrade --check: OK. ${groups.length} dep(s) consistently declared across workspaces` +
                (exact ? `, every declaration pinned exactly.` : `.`),
        );
        return;
    }
    console.error(`gjsify upgrade --check: FAIL. ${inconsistencies.length} dep(s) declared at inconsistent ranges:\n`);
    for (const g of inconsistencies) {
        const byRange = new Map<string, string[]>();
        for (const occ of g.occurrences) {
            const list = byRange.get(occ.currentRange) ?? [];
            list.push(occ.workspace);
            byRange.set(occ.currentRange, list);
        }
        console.error(`  ${ANSI.bold}${g.name}${ANSI.reset}`);
        for (const [range, holders] of byRange.entries()) {
            console.error(`    ${range.padEnd(16)} — ${holders.join(', ')}`);
        }
    }
    console.error(
        exact
            ? `\nFix: run \`gjsify upgrade --align --exact\` (offline; aligns each dep to its highest declared version and drops the operator).`
            : `\nFix: run \`gjsify upgrade --align\` (offline; aligns each dep to its highest declared range).`,
    );
    process.exit(1);
}

/**
 * The groups `--align` has work on.
 *
 * Inconsistency is the whole question for a bare `--align`: a dep every manifest declares
 * identically is done. `--exact` asks a second one, and the two do not overlap — a tree
 * where every manifest says `^4.1.0` is perfectly consistent and carries an operator on
 * every one of those declarations, which is precisely what `--check --exact` rejects.
 *
 * Selecting on inconsistency alone therefore made the repair that `--check --exact`'s own
 * failure message names answer `nothing to do` to the tree it was pointed at: the gate
 * demanded a property the fix could not deliver, cheerfully. Measured on bauplaner's five
 * `@girs/*` declarations, all five `^4.1.0` and all five consistent.
 */
function alignTargets(groups: readonly DependencyGroup[], exact: boolean): DependencyGroup[] {
    if (!exact) return findInconsistencies(groups);
    return groups.filter((g) => isInconsistent(g) || g.occurrences.some((o) => o.prefix !== ''));
}

/**
 * A repair that silently skipped part of its job must not report success.
 *
 * The loop that produces is gate red → repair "done" → gate red, where the second red
 * reads as if the repair had never run. `^1.x` is the shape that lands here: `--check
 * --exact` flags the operator, and no single version can be read out of the range to pin
 * it at, so there is nothing to write and the CLI says which deps those are instead.
 */
function reportUnrepairable(groups: readonly DependencyGroup[]): void {
    console.error(`\ngjsify upgrade --align: ${groups.length} dep(s) left unrepaired — no version to align on:\n`);
    for (const g of groups) {
        console.error(`  ${ANSI.bold}${g.name}${ANSI.reset}  ${[...g.declaredRanges].join(', ')}`);
    }
    console.error(`\nThose ranges name no single version. Edit them by hand, or resolve one with \`--latest\`.`);
    return process.exit(1);
}

function runAlignMode(groups: readonly DependencyGroup[], args: UpgradeOptions): void {
    const exact = args.exact ?? false;
    const targets = alignTargets(groups, exact);
    if (targets.length === 0) {
        console.log(
            `gjsify upgrade --align: nothing to do. ${groups.length} dep(s) already consistent` +
                (exact ? `, every declaration pinned exactly.` : `.`),
        );
        return;
    }
    // For each target, the alignment version is the highest declared one — preserve the
    // prefix of the dominant occurrence so the range shape doesn't mutate (caret stays
    // caret, tilde stays tilde). Under `--exact` the prefix is dropped, in `targetRange`.
    const updates: UpgradeGroup[] = [];
    const unrepairable: DependencyGroup[] = [];
    for (const g of targets) {
        if (!g.highestVersion) {
            unrepairable.push(g);
            continue;
        }
        // Pick a prefix: use the prefix of the dominant range; if dominant has
        // no prefix, default to "^" (the npm-cli default).
        const dominantOcc = g.occurrences.find((o) => o.currentRange === g.dominantRange);
        const prefix = dominantOcc?.prefix || '^';
        updates.push({
            ...g,
            latestVersion: g.highestVersion,
            diff: 'none',
            occurrences: g.occurrences.map((o) => ({ ...o, prefix })),
        });
    }
    if (updates.length > 0) {
        console.log(
            exact
                ? `gjsify upgrade --align --exact: pinning ${updates.length} dep(s) to their highest declared version, without a range operator:\n`
                : `gjsify upgrade --align: aligning ${updates.length} inconsistent dep(s) to their highest declared version:\n`,
        );
        for (const u of updates) {
            const newPrefix = u.occurrences[0]?.prefix ?? '^';
            console.log(
                `  ${u.name.padEnd(28)}  ranges: ${[...u.declaredRanges].join(', ')}  →  ${targetRange(newPrefix, u.latestVersion, exact)}`,
            );
        }
        if (args.dryRun) {
            console.log('\n[gjsify upgrade --align] --dry-run: no files changed.');
        } else {
            const files = applyToFiles(updates, exact);
            console.log(`\n✏️  updated ${updates.length} dep(s) across ${files} package.json file(s).`);
        }
    }
    if (unrepairable.length > 0) return reportUnrepairable(unrepairable);
}

// ─── Registry resolution (group-aware) ─────────────────────────────────

async function resolveCandidateGroups(
    groups: readonly DependencyGroup[],
    npmrc: NpmrcConfig,
    verbose: boolean,
    mode: 'latest' | 'minor' | 'patch' | 'interactive',
): Promise<UpgradeGroup[]> {
    const results: UpgradeGroup[] = [];
    const cap = 8;
    let cursor = 0;
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= groups.length) return;
            const g = groups[i]!;
            try {
                const packument = await fetchPackument(g.name, { npmrc });
                const latest = packument['dist-tags']?.latest;
                if (!latest) {
                    if (verbose) console.warn(`  ${g.name}: no dist-tags.latest, skipping`);
                    continue;
                }
                // Diff is computed against the HIGHEST currently-declared version
                // (so a workspace stuck on an old range still shows the same target).
                const current = g.highestVersion;
                if (!current) {
                    if (verbose) console.warn(`  ${g.name}: unable to parse any current range`);
                    continue;
                }
                const diff = classifyDiff(current, latest);
                if (diff === 'none') continue;
                if (mode === 'minor' && diff === 'major') continue;
                if (mode === 'patch' && (diff === 'major' || diff === 'minor')) continue;
                results.push({ ...g, latestVersion: latest, diff });
            } catch (err) {
                if (verbose) console.warn(`  ${g.name}: fetch failed (${(err as Error).message})`);
            }
        }
    }
    await Promise.all(Array.from({ length: cap }, () => worker()));
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
}

function classifyDiff(current: string, latest: string): ReleaseType {
    const c = parse(current);
    const l = parse(latest);
    if (!c || !l) return 'none';
    if (c.major !== l.major) return l.major > c.major ? 'major' : 'none';
    if (c.minor !== l.minor) return l.minor > c.minor ? 'minor' : 'none';
    if (c.patch !== l.patch) return l.patch > c.patch ? 'patch' : 'none';
    if ((c.prerelease ?? []).join('.') !== (l.prerelease ?? []).join('.')) return 'prerelease';
    return 'none';
}

// ─── Output / Interaction ──────────────────────────────────────────────

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

function colorForDiff(diff: ReleaseType): string {
    switch (diff) {
        case 'major':
            return ANSI.red;
        case 'minor':
            return ANSI.yellow;
        case 'patch':
            return ANSI.green;
        case 'prerelease':
            return ANSI.cyan;
        default:
            return '';
    }
}

function printTable(candidates: readonly UpgradeGroup[]): void {
    const nameW = Math.max(...candidates.map((c) => c.name.length), 4);
    const fanW = Math.max(...candidates.map((c) => `${c.occurrences.length}`.length + 2), 3);
    const curW = Math.max(...candidates.map((c) => declaredCellWidth(c)), 7);
    const newW = Math.max(...candidates.map((c) => c.latestVersion.length), 6);
    const idxW = String(candidates.length).length + 2;

    const head =
        ' '.repeat(idxW + 2) +
        ANSI.bold +
        'name'.padEnd(nameW) +
        '  ' +
        'fan'.padEnd(fanW) +
        '  ' +
        'declared'.padEnd(curW) +
        '  ' +
        'latest'.padEnd(newW) +
        '  ' +
        'kind' +
        ANSI.reset;
    console.log(head);
    console.log(' '.repeat(idxW + 2) + ANSI.dim + '─'.repeat(nameW + fanW + curW + newW + 16) + ANSI.reset);
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        const idx = `${i + 1}.`.padEnd(idxW);
        const badge = c.declaredRanges.size > 1 ? `${ANSI.magenta}⚠ ${ANSI.reset}` : '  ';
        const color = colorForDiff(c.diff);
        console.log(
            idx +
                badge +
                c.name.padEnd(nameW) +
                '  ' +
                ANSI.dim +
                `${c.occurrences.length}`.padEnd(fanW) +
                ANSI.reset +
                '  ' +
                ANSI.dim +
                renderDeclaredCell(c).padEnd(curW) +
                ANSI.reset +
                '  ' +
                color +
                c.latestVersion.padEnd(newW) +
                ANSI.reset +
                '  ' +
                color +
                c.diff +
                ANSI.reset,
        );
    }
    const inconsistentCount = candidates.filter((c) => c.declaredRanges.size > 1).length;
    if (inconsistentCount > 0) {
        console.log(
            `\n${ANSI.magenta}⚠${ANSI.reset}  ${inconsistentCount} dep(s) declared at inconsistent ranges across workspaces.`,
        );
    }
}

function declaredCellWidth(c: DependencyGroup): number {
    return renderDeclaredCell(c).length;
}

function renderDeclaredCell(c: DependencyGroup): string {
    if (c.declaredRanges.size === 1) return [...c.declaredRanges][0]!;
    // "^1.0, ^2.0" — truncate at 32 chars
    const joined = [...c.declaredRanges].sort().join(', ');
    if (joined.length <= 32) return joined;
    return joined.slice(0, 29) + '…';
}

function printChangePlan(selected: readonly UpgradeGroup[], exact = false): void {
    for (const u of selected) {
        for (const occ of u.occurrences) {
            console.log(
                `  ${occ.workspace.padEnd(38)}  ${u.name.padEnd(28)}  ${occ.currentRange.padEnd(12)} → ${targetRange(occ.prefix, u.latestVersion, exact)}`,
            );
        }
    }
}

async function promptSelection(candidates: readonly UpgradeGroup[]): Promise<UpgradeGroup[]> {
    if (!process.stdin.isTTY) {
        console.log(
            '[gjsify upgrade] non-TTY stdin: pass --latest / --minor / --patch (or --yes for interactive-all) to upgrade non-interactively.',
        );
        return [];
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        console.log(
            '\nSelect upgrades: comma- or space-separated indices, ' +
                ANSI.bold +
                'a' +
                ANSI.reset +
                ' for all, ranges like ' +
                ANSI.bold +
                '1-3' +
                ANSI.reset +
                ', or ' +
                ANSI.bold +
                'ENTER' +
                ANSI.reset +
                ' to skip:',
        );
        const answer = (await rl.question('> ')).trim();
        if (!answer) return [];
        if (answer.toLowerCase() === 'a' || answer.toLowerCase() === 'all') return [...candidates];
        const picked = new Set<number>();
        for (const token of answer.split(/[\s,]+/).filter(Boolean)) {
            const range = token.match(/^(\d+)-(\d+)$/);
            if (range) {
                const a = Number(range[1]);
                const b = Number(range[2]);
                for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(i - 1);
            } else if (/^\d+$/.test(token)) {
                picked.add(Number(token) - 1);
            }
        }
        return [...picked].filter((i) => i >= 0 && i < candidates.length).map((i) => candidates[i]!);
    } finally {
        rl.close();
    }
}

// ─── Write-back across all affected workspaces ─────────────────────────

/**
 * The range a dependency will be WRITTEN at.
 *
 * Preview and write share this deliberately. They were two expressions for one decision
 * for exactly one revision, and `--dry-run --exact` announced `^4.3.0` while the writer
 * would have produced `4.3.0` — a tool describing a change it was not about to make.
 */
export function targetRange(prefix: string, version: string, exact: boolean): string {
    return exact ? version : `${prefix}${version}`;
}

function applyToFiles(updates: readonly UpgradeGroup[], exact = false): number {
    // Group by workspace.location so each package.json is read + written once.
    const byLocation = new Map<string, UpgradeGroup[]>();
    for (const u of updates) {
        for (const occ of u.occurrences) {
            const list = byLocation.get(occ.workspaceLocation) ?? [];
            list.push({ ...u, occurrences: [occ] });
            byLocation.set(occ.workspaceLocation, list);
        }
    }
    let touched = 0;
    for (const [location, groups] of byLocation.entries()) {
        const pkgJsonPath = join(location, 'package.json');
        const raw = readFileSync(pkgJsonPath, 'utf-8');
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        let changed = false;
        const changedNames: string[] = [];
        for (const g of groups) {
            const occ = g.occurrences[0]!;
            const map = pkg[occ.field] as Record<string, string> | undefined;
            if (!map) continue;
            const next = targetRange(occ.prefix, g.latestVersion, exact);
            if (map[g.name] !== next) {
                map[g.name] = next;
                changed = true;
                changedNames.push(g.name);
            }
        }
        if (changed) {
            const indent = detectIndent(raw);
            const rewritten = JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : '');
            writeFileSync(pkgJsonPath, keepUntouchedLines(raw, rewritten, changedNames), 'utf-8');
            touched++;
        }
    }
    return touched;
}

/**
 * Take the re-serialised file, but keep every line that is not about a changed dep.
 *
 * A `JSON.parse` → `JSON.stringify` round trip rewrites the WHOLE file, and re-encoding
 * is not identity: measured on this repository, pinning `@girs/*` decoded `\u2014` into
 * an em dash inside three `description` fields nobody asked to touch, so a dependency
 * bump arrived as a diff over unrelated prose. Semantically equal, and still noise a
 * reviewer has to read past.
 *
 * Line-for-line only. Adding or removing a key changes the line count, and then the
 * mapping is not sound — so that case falls back to the plain re-serialisation rather
 * than guessing an alignment.
 */
function keepUntouchedLines(raw: string, rewritten: string, changedNames: readonly string[]): string {
    const before = raw.split('\n');
    const after = rewritten.split('\n');
    if (before.length !== after.length) return rewritten;
    return after
        .map((line, i) => (changedNames.some((name) => line.includes(`"${name}"`)) ? line : before[i]!))
        .join('\n');
}

function uniqueLocations(updates: readonly UpgradeGroup[]): string[] {
    const set = new Set<string>();
    for (const u of updates) {
        for (const occ of u.occurrences) {
            set.add(occ.workspaceLocation);
        }
    }
    return [...set];
}

function detectIndent(json: string): number {
    const m = json.match(/^\{\n( +)/);
    if (m) return m[1]!.length;
    return 2;
}

// ─── npmrc loader (lightweight, shared shape with install-backend) ─────

async function loadNpmrcLight(cwd: string): Promise<NpmrcConfig> {
    let parsed: NpmrcConfig = {
        registry: DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    // Layered .npmrc lookup (most-specific wins): home → cwd. Same precedence
    // as install-backend-native, except env-var `npm_config_registry` wins
    // over file values (matches npm's real semantics, lets the test harness
    // point at a mock registry without touching `~/.npmrc`).
    for (const candidate of [join(homedir(), '.npmrc'), join(cwd, '.npmrc')]) {
        if (!existsSync(candidate)) continue;
        try {
            const proj = parseNpmrc(readFileSync(candidate, 'utf-8'));
            parsed = {
                ...parsed,
                ...proj,
                scopes: { ...parsed.scopes, ...proj.scopes },
            };
        } catch {
            // ignore malformed .npmrc — same lenient policy as install-backend
        }
    }
    if (process.env.npm_config_registry) {
        parsed.registry = process.env.npm_config_registry;
    }
    return parsed;
}
