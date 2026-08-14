// `gjsify affected` — diff against `<base>` and emit the workspaces AFFECTED by
// the change set: seeds plus everything that transitively depends on them. CI
// feeds the output to `gjsify foreach test --include …`, so a single-package PR
// tests the touched workspace and its consumers instead of the whole monorepo.
//
// EVERY VERDICT HERE IS SCOPED TO ONE WORKFLOW: `main.yml`. That is the single
// most misread thing in this file. "Ignored" NEVER means "irrelevant to the
// repository" — it means "cannot change what `main.yml` builds or tests". Sibling
// workflows gate themselves with their own `paths:` filters, so `packages/node-gi/**`
// and `packages/napi/**` are load-bearing build inputs to THEIR workflows and still
// belong in IGNORE here.
//
// Classifier order, first match wins: IGNORE → GLOBAL_TRIGGERS → SCRIPT_COUPLINGS
// → TEST_ONLY → CODE (map file→workspace, then walk reverse-dep edges). IGNORE runs
// first and therefore WINS OVER GLOBAL: `packages/infra/cli/README.md` must not
// force a full run just because `packages/infra/cli/` is a global trigger.
//
// Integration suites run when a closure member is a dependency of an
// `@gjsify/integration-*` workspace, or on a global trigger; e2e runs on any
// global trigger, an explicit `tests/e2e/**` touch, or a coupling that declares it.
//
// `include-args` CONTRACT (github-actions format) — read before changing its
// shape. The value is a SPACE-SEPARATED list of ALREADY-SHELL-SAFE tokens
// (`--include @gjsify/fs --include @gjsify/stream`) whose only supported
// consumption is an UNQUOTED `$INCLUDE_ARGS` expansion, where word splitting is
// the intent. It carries NO quoting of its own, deliberately:
//
//   * `main.yml` splices it into a `su testuser -c "… sh -c '…'"` nesting, and the
//     result of a parameter expansion is never re-scanned for quotes. When this
//     emitted `--include '@gjsify/fs'` the apostrophes became part of the glob,
//     every pattern matched zero workspaces, and `foreach` exited 0 — CI "built"
//     nothing on every selective PR run, in 0.65 s. Pre-quoting for an unknown
//     number of nesting levels cannot work; emitting tokens that need no quoting
//     at any level can.
//   * The output has two kinds of consumer: shell splices, and
//     `contains(needs.changes.outputs.include-args, '@gjsify/…')` GitHub
//     expressions. Per-consumer unquoting would have to be repeated in the very
//     nesting that produced the bug, and `contains()` is unaffected either way —
//     it matched the quoted spelling too, which is why the gates kept working
//     while the build silently did nothing.
//
// Shell-safety is ENFORCED, not assumed: `assertShellSafeWorkspaceName` rejects
// any name outside `[A-Za-z0-9@._/-]`. npm names cannot contain those characters,
// so it never fires in practice; if it does, the non-zero exit leaves the classify
// step's outputs unset and CI falls back to a FULL run — failing towards "run
// everything" is the safe direction.
//
// `--changed-from-stdin` reads paths from stdin instead of running `git diff`.
// Slurped via `utils/stdin.ts`, NOT `readFileSync(0)`: `@gjsify/fs` has no
// numeric-fd path, so the Node idiom opens the relative file `./0` and the
// committed GJS bundle died with `ENOENT … read '0'` on every such run.

import type { LeafCommand } from '../types/index.js';
import { spawnSync } from 'node:child_process';
// STATIC, never a lazy `require('node:fs')`: this package is ESM, so a bare
// `require` is a ReferenceError — and the only line that would execute it sits
// behind `if (process.env.GITHUB_OUTPUT)`, so it survives every local run and
// every spec and fires only inside a GitHub Actions step.
import { appendFileSync } from 'node:fs';
import { readStdinLines } from '../utils/stdin.js';

import { discoverWorkspaces } from '@gjsify/workspace';
import { classifyAndExpand, type ClassifyResult } from './affected-classify.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface AffectedOptions {
    base?: string;
    head?: string;
    format: 'text' | 'json' | 'globs' | 'github-actions';
    'changed-from-stdin': boolean;
    cwd?: string;
}

export const affectedCommand: LeafCommand<unknown, AffectedOptions> = {
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

        const result = classifyAndExpand(workspaces, changedFiles);
        emit(args.format, result);
    },
};

function runGitDiff(cwd: string, base: string, head: string): string[] {
    // `base...head` lists changed paths on `head` relative to the MERGE-BASE, which
    // matches what a GitHub PR diff shows and survives stacked PRs without picking up
    // commits from base.
    const r = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], {
        cwd,
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        // CI falls back to a full run via `continue-on-error: true` on the classify
        // step.
        process.stderr.write(`gjsify affected: git diff failed (${r.status}): ${r.stderr.trim()}\n`);
        // Under GJS `process.exit()` is DEFERRED (no atexit — the call returns), so in
        // this synchronous, value-returning helper a bare exit fell through to the
        // `return` below and handed the caller a diff parsed from a failed git run.
        // `return process.exit(…)` cannot help either: it would hand the caller the
        // pending exit promise as a `string[]`. The throw is what stops the caller; on
        // Node the exit(2) halts first and the throw is dead.
        // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path; see the comment above.
        process.exit(2);
        throw new Error(`gjsify affected: git diff failed (${r.status})`);
    }
    return r.stdout.split('\n').filter(Boolean);
}

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
        // Unquoted, space-separated tokens — see the `include-args` CONTRACT at the
        // top of this file. Do NOT re-add quoting here.
        const includeArgs = r.global
            ? ''
            : r.workspaces.map((n) => `--include ${assertShellSafeWorkspaceName(n)}`).join(' ');
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

// A name that survives an UNQUOTED shell expansion unchanged: no whitespace, no
// quote/escape characters, no glob metacharacters, no `$`, nothing the shell reads
// as an operator. npm names are a strict subset, so this is a machine-checked
// restatement of the `include-args` contract rather than a real runtime branch.
const SHELL_SAFE_WORKSPACE_NAME = /^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/;

function assertShellSafeWorkspaceName(name: string): string {
    if (SHELL_SAFE_WORKSPACE_NAME.test(name)) return name;
    process.stderr.write(
        `gjsify affected: workspace name ${JSON.stringify(name)} is not shell-safe, so it cannot be emitted as an\n` +
            `  \`include-args\` token (the value is consumed by an UNQUOTED $INCLUDE_ARGS expansion — see the\n` +
            `  contract at the top of commands/affected.ts). Rename the workspace, or teach this command a\n` +
            `  transport the consumers can unquote. Refusing to emit a filter that would silently mis-match.\n`,
    );
    // NOT unreachable under GJS: `process.exit()` is DEFERRED there (no atexit — the
    // call returns), so the throw below is what stops an unsafe name from reaching the
    // emit site, and the exit code rides the scheduled teardown. On Node the exit(2)
    // halts first and the throw is dead code.
    // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path; see the comment above.
    process.exit(2);
    throw new Error(`gjsify affected: unsafe workspace name ${name}`);
}
