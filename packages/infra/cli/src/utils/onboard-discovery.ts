// Package-set discovery for `gjsify onboard`, and the ONE thing that decides
// whether the command is a gjsify-repo chore or a monorepo tool.
//
// Onboard used to enumerate exactly one way: `discoverWorkspaces` over the root
// manifest's `workspaces` globs, plus this repo's two carved-out publishable
// directories. That set is correct HERE and empty in the repo the sweep is most
// needed for — `gjsify/types` publishes 703 `@girs/*` packages from a root whose
// only tracked file is `.gitignore`. There is no manifest, so there are no
// globs, so `discoverWorkspaces` throws before anything is enumerated.
//
// So the package set is now built from up to three SOURCES, and every one of
// them is REPORTED with its count. That reporting is not decoration: a sweep
// that writes to npm derives its whole blast radius from this list, and the two
// ways it goes wrong — enumerating nothing, and enumerating the wrong tree —
// look identical in a summary that only prints a total. `--packages` matching
// no directory is a HARD ERROR for the same reason `gjsify foreach --include`
// is: a filter that selects nothing is a typo or a shell-quoting bug, never an
// intent (and onboard's own history has the sharper version of this — it once
// reported "127 already done" while `@gjsify/napi` was simply absent from the
// list it had built).

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { discoverWorkspaces, type Workspace } from '@gjsify/workspace';
import { join } from 'node:path';
import { mergePublishables } from './publishable-packages.js';
import { parseRepoFromGitRemote } from './trust-registry.js';
import { findWorkspaceRoot } from './workspace-root.js';

/** One enumeration source and how much it contributed. */
export interface DiscoverySource {
    /** `workspaces` (root manifest globs) | `packages` (--packages globs) | `scanned-dirs`. */
    kind: 'workspaces' | 'packages' | 'scanned-dirs';
    /** The globs this source used, when it had any. */
    patterns?: readonly string[];
    /** How many packages this source contributed AFTER dedupe against earlier sources. */
    count: number;
}

export interface PackageSet {
    packages: Workspace[];
    sources: DiscoverySource[];
}

/**
 * The directory the globs and the workspace manifest are resolved against.
 *
 * A workspace root wins, because that is what `discoverWorkspaces` needs. When
 * there is none, the GIT top level is the answer and the cwd is only the last
 * resort: `--packages '*'` run from anywhere inside a non-workspace monorepo
 * must mean the same set every time, and resolving it against the cwd would
 * quietly mean "the packages below wherever I happen to stand".
 */
export function resolveRepoRoot(cwd: string): string {
    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot) return wsRoot;
    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    if (git.status === 0) {
        const top = git.stdout.trim();
        if (top && existsSync(top)) return top;
    }
    return cwd;
}

/**
 * Every `--packages` glob must match at least one directory holding a
 * `package.json` with a name. Throws with the unmatched patterns otherwise.
 *
 * Mirrors `gjsify foreach`'s `--include` rule, and matters more here: foreach's
 * empty selection runs no scripts, while onboard's empty selection is a sweep
 * that reports itself complete having examined nothing.
 */
export function assertEveryPatternMatches(root: string, patterns: readonly string[]): void {
    const unmatched = patterns.filter((pattern) => {
        try {
            return discoverWorkspaces(root, { patterns: [pattern] }).length === 0;
        } catch {
            return true;
        }
    });
    if (unmatched.length === 0) return;
    const lines = [
        `gjsify onboard: --packages matched no package directory (${unmatched.length} of ${patterns.length} pattern(s)) under ${root}:`,
    ];
    for (const pattern of unmatched) lines.push(`  ${JSON.stringify(pattern)}`);
    lines.push(
        '  Patterns are DIRECTORY globs resolved against the repo root, and only `*` is supported',
        '  (one path segment). A matched directory needs a package.json with a "name".',
    );
    throw new Error(lines.join('\n'));
}

/**
 * Collect the publishable package set from every source that applies.
 *
 * Order is precedence: a real workspace beats a `--packages` hit beats a scanned
 * directory, deduped by package NAME, so the manifest a build would use is the
 * manifest the sweep publishes.
 */
export function collectOnboardPackages(
    root: string,
    cwd: string,
    options: { patterns?: readonly string[] } = {},
): PackageSet {
    const sources: DiscoverySource[] = [];
    const packages: Workspace[] = [];
    const seen = new Set<string>();

    const take = (kind: DiscoverySource['kind'], found: Workspace[], patterns?: readonly string[]): void => {
        let added = 0;
        for (const ws of found) {
            if (!ws.name || seen.has(ws.name)) continue;
            seen.add(ws.name);
            packages.push(ws);
            added++;
        }
        sources.push({ kind, patterns, count: added });
    };

    // 1. The root manifest's own `workspaces` globs, when the repo has them.
    if (existsSync(join(root, 'package.json'))) {
        try {
            take('workspaces', discoverWorkspaces(root, { includeRoot: true }));
        } catch {
            // A root package.json without `workspaces` is not an error here —
            // `--packages` or the scanned dirs may still carry the whole set.
        }
    }

    // 2. Explicit `--packages` globs — the path for a monorepo that is not an
    //    npm/yarn workspace. Callers run `assertEveryPatternMatches` first, so
    //    an empty result here can only mean "everything was already covered".
    if (options.patterns && options.patterns.length > 0) {
        take('packages', discoverWorkspaces(root, { patterns: [...options.patterns] }), options.patterns);
    }

    // 3. This repo's publishable-but-not-workspace directories. A no-op in any
    //    repo that does not have them; see publishable-packages.ts for the
    //    incident that put it here.
    take('scanned-dirs', mergePublishables([], cwd));

    return { packages, sources };
}

/** One-line rendering of where the package set came from. */
export function describeSources(sources: readonly DiscoverySource[]): string {
    return sources
        .filter((s) => s.count > 0)
        .map((s) => (s.patterns ? `${s.kind}(${s.patterns.join(',')})=${s.count}` : `${s.kind}=${s.count}`))
        .join(' + ');
}

/** The `owner/repo` a package's own manifest claims, or null if it claims none. */
export function declaredRepository(ws: Workspace): string | null {
    const repo = ws.manifest.repository as string | { url?: string } | undefined;
    const url = typeof repo === 'string' ? repo : repo?.url;
    if (typeof url !== 'string' || url.length === 0) return null;
    return parseRepoFromGitRemote(url);
}

/**
 * Refuse to configure a Trusted Publisher for a package whose OWN manifest says
 * it lives in a different repository.
 *
 * This replaces a hardcoded `exclude: ['@girs/*']`, and it is worth more than
 * the thing it replaces. Measured: `gjsify onboard` in `gjsify/ts-for-gir`
 * selects 716 packages, ~703 of them the generated `@girs/*` under
 * `types-dev/*` — which are workspaces there, but are PUBLISHED FROM
 * `gjsify/types`. Trusting them for `gjsify/ts-for-gir`'s `release.yml` would
 * point their OIDC exchange at a workflow that never publishes them, i.e. break
 * the release the sweep exists to protect.
 *
 * A name pattern only ever covered the one case somebody had already been bitten
 * by. The manifest's `repository` is the package's own claim about where it
 * comes from, so this covers every monorepo that has another project's packages
 * inside it — vendored, submoduled, or generated.
 *
 * Silence is the only safe default in the other direction: a package that
 * declares NO repository is not evidence of a mismatch, so it passes.
 */
export function assertRepositoryAgreement(selected: readonly Workspace[], repository: string): void {
    const target = repository.toLowerCase();
    const foreign = selected
        .map((ws) => ({ ws, declared: declaredRepository(ws) }))
        .filter((e) => e.declared !== null && e.declared.toLowerCase() !== target);
    if (foreign.length === 0) return;

    const byRepo = new Map<string, string[]>();
    for (const { ws, declared } of foreign) {
        const list = byRepo.get(declared as string) ?? [];
        list.push(ws.name);
        byRepo.set(declared as string, list);
    }
    const lines = [
        `gjsify onboard: ${foreign.length} selected package(s) declare a DIFFERENT repository than ${repository}:`,
    ];
    for (const [repo, names] of byRepo) {
        const shown = names.slice(0, 5).join(', ');
        const more = names.length > 5 ? `, … (+${names.length - 5} more)` : '';
        lines.push(`  ${repo}: ${names.length} package(s) — ${shown}${more}`);
    }
    lines.push(
        "  A Trusted Publisher scoped to the wrong repository points that package's OIDC exchange",
        '  at a workflow that does not publish it, which breaks the release this sweep protects.',
        '  Either exclude them (--exclude), select only what belongs here (--include), or point',
        '  --repository at the repo that actually publishes them.',
    );
    throw new Error(lines.join('\n'));
}
