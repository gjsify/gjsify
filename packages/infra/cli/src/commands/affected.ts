// `gjsify affected --base <sha> [--head <ref>] [--format=...]`
//
// Diffs the working tree against `<base>` and emits the set of workspaces
// that are AFFECTED by the change set — i.e. seeds plus everything that
// transitively depends on them. CI uses the output as the `--include`
// filter for `gjsify foreach test`, so a typical single-package PR ends
// up running the touched workspace + its downstream consumers instead of
// the whole monorepo.
//
// Classifier table (first-match wins) handles the cases that aren't a
// straightforward "file lives in workspace X":
//
//   1. GLOBAL_TRIGGERS  — change touches infra the classifier itself
//      depends on (`@gjsify/workspace`, `@gjsify/cli`, the bundler
//      plugins, the lockfile, root tsconfig / package.json, this very
//      workflow file). Emits `global=true` → CI must run the full
//      suite. We can't trust the closure when the algorithm that
//      computes it just changed.
//
//   2. IGNORE  — pure-docs / website / refs/ submodule / unrelated
//      workflow files. Discard; do not contribute to seeds.
//
//   3. TEST_ONLY  — every changed file under ONE workspace is a spec
//      file, e2e fixture, or integration test. Seed = that workspace
//      but SKIP the closure expansion (downstream consumers don't care
//      about test code changes).
//
//   4. CODE (default)  — `workspacesForChangedFiles` maps file → ws,
//      then `affectedClosure` walks reverse-dep edges.
//
// Integration tests are gated separately: they run when any workspace
// in the closure appears as a `dependencies` entry of any
// `@gjsify/integration-*` workspace, OR on a `globalTrigger`. Same for
// e2e: any infra change OR explicit `tests/e2e/**` touch turns the e2e
// gate on.
//
// Output formats:
//
//   --format=text             (default)   human-readable summary
//   --format=json                         { global, workspaces[], runIntegration, runE2E, skipAll, reason }
//   --format=globs                        one `@gjsify/<name>` per line
//   --format=github-actions                $GITHUB_OUTPUT key=value lines
//
// `--changed-from-stdin` skips `git diff` entirely and reads a newline-
// separated list of paths from stdin. Useful for local debugging and
// for the spec suite.

import type { Command } from '../types/index.js';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
    discoverWorkspaces,
    buildDependencyGraph,
    buildReverseDependencyGraph,
    affectedClosure,
    workspacesForChangedFiles,
    type Workspace,
} from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface AffectedOptions {
    base?: string;
    head?: string;
    format: 'text' | 'json' | 'globs' | 'github-actions';
    'changed-from-stdin': boolean;
    cwd?: string;
}

export const affectedCommand: Command<unknown, AffectedOptions> = {
    command: 'affected',
    description:
        'Classify changed files against the workspace tree and print the set of workspaces affected (seeds + transitive dependents). Designed for CI to gate `gjsify foreach test --include …` so unrelated workspaces are not re-tested on every PR.',
    builder: (yargs) =>
        yargs
            .option('base', {
                description:
                    'Diff base. Default: `origin/main`. Resolved via `git rev-parse`. On a PR set this to `${{ github.event.pull_request.base.sha }}`.',
                type: 'string',
            })
            .option('head', {
                description: 'Diff head. Default: `HEAD`.',
                type: 'string',
                default: 'HEAD',
            })
            .option('format', {
                description: 'Output shape.',
                choices: ['text', 'json', 'globs', 'github-actions'] as const,
                default: 'text',
            })
            .option('changed-from-stdin', {
                description:
                    'Skip `git diff`. Read a newline-separated list of repo-relative paths from stdin instead. Lets callers — tests, ad-hoc scripts — control the input exactly.',
                type: 'boolean',
                default: false,
            })
            .option('cwd', {
                description: 'Workspace root. Default: discovered from `process.cwd()`.',
                type: 'string',
            }),
    handler: async (args) => {
        const rootDir = args.cwd ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();
        const workspaces = discoverWorkspaces(rootDir, { includeRoot: true });

        const changedFiles = args['changed-from-stdin']
            ? readStdinLines()
            : runGitDiff(rootDir, args.base ?? 'origin/main', args.head ?? 'HEAD');

        const result = classifyAndExpand(workspaces, rootDir, changedFiles);
        emit(args.format, result);
    },
};

// ─── Classifier ────────────────────────────────────────────────────────────

interface ClassifyResult {
    /** Cannot decide precisely — caller should run full suite. */
    global: boolean;
    /** Reason string surfaced in logs / debugging. */
    reason: string;
    /** Sorted workspace names. Includes every test-targeted workspace. */
    workspaces: string[];
    /** Should `tests/e2e/**` run? */
    runE2E: boolean;
    /** Should `@gjsify/integration-*` workspaces run? */
    runIntegration: boolean;
    /** Diff was empty AND no triggers fired → CI can skip the whole job. */
    skipAll: boolean;
}

/** Patterns that force a full run. First-match wins; order is intentional. */
const GLOBAL_TRIGGERS = [
    // The classifier itself + everything in its plumbing.
    /^packages\/infra\/workspace\//,
    /^packages\/infra\/cli\//,
    /^packages\/infra\/rolldown-plugin-gjsify\//,
    /^packages\/infra\/resolve-npm\//,
    // Cross-cutting dep + lockfile + root config.
    /^gjsify-lock\.json$/,
    /^package\.json$/,
    /^tsconfig[^/]*\.json$/,
    // The workflow file itself — a job-shape change is invisible until
    // the workflow re-runs, so a path-filtered job can't safely apply
    // the new shape to an in-flight PR.
    /^\.github\/workflows\/main\.yml$/,
    /^scripts\/audit-runtimes\.mjs$/,
];

/** Patterns that contribute no seed and don't force a full run. */
const IGNORE = [
    /\.md$/i,
    /^refs\//,
    /^website\//,
    /^docs\//,
    /^\.github\/workflows\/(deploy-docs|commitlint|release|audit-runtimes|prebuilds)\.yml$/,
    /^\.githooks\//,
    /^LICENSE/,
    /^\.gitignore$/,
    /^\.gjsify-[^/]*\.md$/,
    /^STATUS\.md$/,
    /^CHANGELOG\.md$/,
    /^AGENTS\.md$/,
    /^CLAUDE\.md$/,
    /^README\.md$/,
];

/** Patterns that suggest a test-only change. */
const TEST_PATHS = [/\.spec\.[mc]?[tj]sx?$/, /^tests\/(e2e|integration)\//];

function classifyAndExpand(
    workspaces: readonly Workspace[],
    rootDir: string,
    changedFiles: readonly string[],
): ClassifyResult {
    const files = changedFiles.map((f) => f.replace(/\\/g, '/')).filter((f) => f.length > 0);
    if (files.length === 0) {
        return {
            global: false,
            reason: 'empty-diff',
            workspaces: [],
            runE2E: false,
            runIntegration: false,
            skipAll: true,
        };
    }
    // Global triggers short-circuit immediately.
    for (const f of files) {
        for (const re of GLOBAL_TRIGGERS) {
            if (re.test(f)) {
                return {
                    global: true,
                    reason: `global-trigger ${re.source} matched ${f}`,
                    workspaces: workspaces.map((w) => w.name),
                    runE2E: true,
                    runIntegration: true,
                    skipAll: false,
                };
            }
        }
    }
    // Drop ignored files; collect the remainder.
    const remaining: string[] = [];
    for (const f of files) {
        if (IGNORE.some((re) => re.test(f))) continue;
        remaining.push(f);
    }
    if (remaining.length === 0) {
        return {
            global: false,
            reason: 'ignored-only',
            workspaces: [],
            runE2E: false,
            runIntegration: false,
            skipAll: true,
        };
    }
    // Map files → workspaces. Files outside any workspace stay in `unmatched`.
    const { matched, unmatched } = workspacesForChangedFiles(workspaces, rootDir, remaining);
    // Unmatched-but-not-ignored files are suspicious enough to fall back to
    // the conservative "full run" path. Examples: a new top-level dotfile,
    // a script in `scripts/` we haven't carved out, a refs/-adjacent file.
    if (unmatched.length > 0) {
        return {
            global: true,
            reason: `unmatched files (${unmatched.length}): ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '…' : ''}`,
            workspaces: workspaces.map((w) => w.name),
            runE2E: true,
            runIntegration: true,
            skipAll: false,
        };
    }
    // TEST_ONLY shortcut: every remaining file is a spec / e2e / integration
    // path, all under ONE workspace. Skip the closure expansion — test code
    // has no downstream consumers.
    const testOnly = remaining.every((f) => TEST_PATHS.some((re) => re.test(f)));
    if (testOnly && matched.size === 1) {
        const only = [...matched][0]!;
        // E2E or integration test-only changes still need their own job.
        const touchedE2E = remaining.some((f) => f.startsWith('tests/e2e/'));
        const touchedIntegration = remaining.some((f) => f.startsWith('tests/integration/'));
        return {
            global: false,
            reason: `test-only (${remaining.length} file(s) in ${only})`,
            workspaces: [only],
            runE2E: touchedE2E,
            runIntegration: touchedIntegration || isIntegrationWorkspace(only),
            skipAll: false,
        };
    }
    // Default: closure walk.
    const reverse = buildReverseDependencyGraph(workspaces, { includeDev: true });
    const closure = affectedClosure(reverse, [...matched]);
    // Integration suites whose forward deps overlap with the closure also
    // need to run. We walk the forward graph and pull any integration ws
    // that depends on something inside the closure.
    const forward = buildDependencyGraph(workspaces, { includeDev: true });
    let runIntegration = false;
    for (const [from, deps] of forward.edges) {
        if (!isIntegrationWorkspace(from)) continue;
        for (const dep of deps) {
            if (closure.has(dep)) {
                closure.add(from);
                runIntegration = true;
                break;
            }
        }
    }
    const runE2E = remaining.some((f) => f.startsWith('tests/e2e/'));
    return {
        global: false,
        reason: `closure (${closure.size} ws from ${matched.size} seed(s))`,
        workspaces: [...closure].sort(),
        runE2E,
        runIntegration,
        skipAll: false,
    };
}

function isIntegrationWorkspace(name: string): boolean {
    return name.startsWith('@gjsify/integration-');
}

// ─── git diff + stdin ──────────────────────────────────────────────────────

function runGitDiff(cwd: string, base: string, head: string): string[] {
    // `git diff --name-only base...head` lists changed paths on `head`
    // relative to the merge-base. That matches what GitHub PR diffs show
    // and survives stacked PRs without picking up commits from base.
    const r = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], {
        cwd,
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        // Surface a clear error — caller (CI) will fall back to full run
        // via `continue-on-error: true` on the classify step.
        process.stderr.write(
            `gjsify affected: git diff failed (${r.status}): ${r.stderr.trim()}\n`,
        );
        process.exit(2);
    }
    return r.stdout.split('\n').filter(Boolean);
}

function readStdinLines(): string[] {
    const data = readFileSync(0, 'utf8');
    return data.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ─── Output ────────────────────────────────────────────────────────────────

function emit(format: AffectedOptions['format'], r: ClassifyResult): void {
    if (format === 'json') {
        process.stdout.write(JSON.stringify(r) + '\n');
        return;
    }
    if (format === 'globs') {
        for (const name of r.workspaces) process.stdout.write(`${name}\n`);
        return;
    }
    if (format === 'github-actions') {
        const includeArgs = r.global
            ? ''
            : r.workspaces.map((n) => `--include '${escSingleQuote(n)}'`).join(' ');
        const out = process.env.GITHUB_OUTPUT;
        const lines = [
            `skip-all=${r.skipAll}`,
            `global=${r.global}`,
            `include-args=${includeArgs}`,
            `run-integration=${r.runIntegration}`,
            `run-e2e=${r.runE2E}`,
            `reason=${r.reason}`,
        ];
        if (out) {
            // GitHub Actions: append to $GITHUB_OUTPUT.
            const { appendFileSync } = require('node:fs') as typeof import('node:fs');
            for (const l of lines) appendFileSync(out, `${l}\n`);
        } else {
            for (const l of lines) process.stdout.write(`${l}\n`);
        }
        return;
    }
    // text (default)
    process.stdout.write(`affected:\n`);
    process.stdout.write(`  reason:          ${r.reason}\n`);
    process.stdout.write(`  global:          ${r.global}\n`);
    process.stdout.write(`  skip-all:        ${r.skipAll}\n`);
    process.stdout.write(`  run-integration: ${r.runIntegration}\n`);
    process.stdout.write(`  run-e2e:         ${r.runE2E}\n`);
    process.stdout.write(`  workspaces (${r.workspaces.length}):\n`);
    for (const name of r.workspaces) process.stdout.write(`    - ${name}\n`);
}

function escSingleQuote(s: string): string {
    return s.replace(/'/g, `'\\''`);
}
