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
    // The test framework every spec imports, as a *devDependency* — which the
    // prod-deps-only closure below does not walk, so a change to it would yield a
    // near-empty closure and silently skip every downstream test, while a bug in a
    // matcher can break assertions anywhere.
    /^packages\/gjs\/unit\//,
    // The composite action every CI job sets itself up with: a change alters the
    // environment of the whole matrix. Listed EXPLICITLY — it previously forced a
    // full run only by falling through to the "unmatched files" path, which is luck
    // rather than intent.
    /^\.github\/actions\//,
    // Cross-cutting dep + lockfile + root config.
    /^gjsify-lock\.json$/,
    /^package\.json$/,
    /^tsconfig[^/]*\.json$/,
    // The workflow file itself: a job-shape change is invisible until the workflow
    // re-runs, so a path-filtered job cannot safely apply the new shape to an
    // in-flight PR.
    /^\.github\/workflows\/main\.yml$/,
    /^scripts\/audit-runtimes\.mjs$/,
];

/**
 * Inputs OWNED BY ANOTHER WORKFLOW — build-relevant, just not to `main.yml`.
 *
 * Adding a regex here is a claim with two halves and BOTH must hold: `main.yml`
 * must not read the path, and some other workflow must have it in its own
 * `paths:` filter so a break still reds a PR. The test is never "is this file
 * unimportant" — none of these are.
 */
const OTHER_WORKFLOW_INPUTS = [
    // Each sibling workflow's own definition. `main.yml` is deliberately absent: it
    // is a GLOBAL_TRIGGER instead.
    /^\.github\/workflows\/(deploy-docs|commitlint|release|release-cut|audit-runtimes|prebuilds|node-gi|napi|cli-cross-platform|build-ci-image|cancel-pr-runs)\.yml$/,
    // `prebuilds.yml`'s toolchain (#838): the QEMU-emulated build script and the
    // classifier deciding which native packages a prebuild run rebuilds. It is in
    // both of that workflow's `paths:` filters; `main.yml` builds no prebuild and
    // runs no emulated leg.
    /^\.github\/prebuild-toolchain\//,
    // The REPO-SCOPED manifest-conformance rules (#847), gated by
    // `audit-runtimes.yml`, which runs on EVERY pull_request with no `paths:` filter;
    // `prebuilds.yml` also treats it as a shared input (#843).
    //
    // The distinction is real, not a technicality: `main.yml` DOES run
    // manifest-conformance code, but reaches it through
    // `packages/infra/manifest-conformance/` — the PACKAGE, a normal workspace that
    // maps and seeds like any other. Only the `scripts/`-side repo-scoped half is
    // ignored, and that is precisely the half `main.yml` does not load.
    /^scripts\/manifest-conformance\//,
    // The authored status data (ADR 0016) + its generator. Same two halves:
    // `main.yml` never runs `status:generate` and never opens `status/`, while
    // `audit-runtimes.yml` runs the `status-data` rule over it on every PR.
    //
    // Naming the directory makes the `.md` case intentional rather than incidental:
    // `status/*.md` already fell into IGNORE via the generic `/\.md$/i`, so the gap
    // showed up only on `status/status.json`, which matched nothing, landed in
    // `unmatched`, and paid for a FULL matrix run over a file `main.yml` cannot read.
    /^status\//,
    /^scripts\/generate-status\.mjs$/,
];

/** Patterns that contribute no seed and don't force a full run. */
const IGNORE = [
    /\.md$/i,
    /^refs\//,
    /^website\//,
    /^docs\//,
    ...OTHER_WORKFLOW_INPUTS,
    // Neither `@gjsify/node-gi` (the Node-native GI engine) nor `@gjsify/napi` (the
    // N-API host over SpiderMonkey) is a gjsify workspace member: the GJS-first
    // install/foreach tooling cannot build their node-gyp addons or Vala+C++/meson
    // shim, so `main.yml` neither builds nor tests them and their own workflows are
    // the source of truth. Without the carve-outs their files map to no workspace,
    // land in `unmatched`, and force a full run on every node-gi/napi PR.
    /^packages\/node-gi\//,
    /^packages\/napi\//,
    // Flatpak build/distribution tooling (SDK-extension manifest + metainfo). No
    // package-test consumers; its own `tests/e2e/flatpak-sdk-extension` runs on
    // `tests/e2e/**` and global triggers. Worth revisiting: ignoring `.githooks/`
    // for the same reason is what let a change walk past the suite guarding it (see
    // SCRIPT_COUPLINGS), and IGNORE wins over every other rule.
    /^flatpak\//,
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

/**
 * SCRIPT-BASED COUPLINGS — a build input whose consumer has NO edge to follow.
 *
 * The closure is a graph walk whose only edges are `dependencies` /
 * `optionalDependencies`. When directory A is a real build input to workspace B
 * because B's BUILD SCRIPT reads it, there is no such edge, so no amount of graph
 * walking reaches B. The coupling has to be DECLARED.
 *
 * The failure is silent in the worse direction: an unmodelled input landing in
 * `unmatched` at least fails towards a full run, while this one looks healthy —
 * the input's own workspace is seeded, a small green closure is reported, B is
 * never rebuilt, and B's build-output cache keeps serving the copy it made before
 * the change. Nothing goes red.
 *
 * ADD AN ENTRY whenever you wire a build script to read outside its own package.
 * `why` is mandatory and names the script, so the coupling is greppable from the
 * thing that created it.
 *
 * THREE MORE COUPLINGS ARE DELIBERATELY UNLISTED, and they set a trap:
 * `scripts/stage-prebuild.mjs` → 11 native packages, `scripts/check-refs-pin.mjs`
 * → the 3 Rust bridges, `scripts/bootstrap-native-facades.mjs` → the infra
 * facades. They need no entry only because `scripts/` is in neither IGNORE nor any
 * workspace, so a change there lands in `unmatched` and already fails towards a
 * full run. That is safety by accident, and it is load-bearing: **anyone who
 * carves `scripts/` or a subtree of it into IGNORE MUST add the matching entries
 * here in the same change**, or all three convert from "expensive but correct"
 * into the silent stale-artifact failure this table exists to prevent. The
 * `scripts/manifest-conformance/**` carve-out above is exactly that kind of edit,
 * safe only because nothing under it is a build input to a workspace — a CI gate
 * is a different thing.
 */
interface ScriptCoupling {
    /** Files whose change implies the coupling fired. */
    match: RegExp;
    /** Workspaces to seed IN ADDITION to whatever the file itself maps to. */
    seeds: string[];
    /** Force the e2e tier — for a coupling whose only real coverage is e2e. */
    runE2E?: boolean;
    /** The script that creates the coupling. Mandatory: it is the evidence. */
    why: string;
}

const SCRIPT_COUPLINGS: readonly ScriptCoupling[] = [
    {
        // `.githooks/pre-commit` is guarded by an e2e suite and reachable from no
        // workspace at all — not source, not a dependency, its consumer is git. So a
        // change to it selected NOTHING and the e2e tier stayed off (that turns on
        // for a `tests/e2e/**` touch): #1095 edited the hook's command line, merged
        // green, and turned `main` red on the push run. Same shape #1028 noted —
        // whoever changes the GUARDED thing walks past the guard, because the guard's
        // trigger names the TEST's path instead of the thing under test.
        //
        // No extra seeds: there is no workspace to rebuild. The tier is the point.
        match: /^\.githooks\//,
        seeds: [],
        runE2E: true,
        why: 'tests/e2e/git-hooks-cli-bundle-staleness drives .githooks/pre-commit',
    },
    {
        // `templates/*` ARE workspaces, so a template change already seeds its own
        // `@gjsify/template-<name>` — not the consumer that matters. That consumer is
        // `@gjsify/create-app`, unreachable twice over: it lives at
        // `packages/infra/create-gjsify/`, so no directory-name search finds it, and
        // it pulls the templates in through its own `scripts/process-template.mjs`
        // build step (which resolves each `workspace:^` specifier and copies the
        // result into `dist-templates/`), so there is no dependency edge either.
        // `dist-templates/` is a build-output cache candidate, so once stale it
        // stays stale.
        match: /^templates\//,
        seeds: ['@gjsify/create-app'],
        // `tests/e2e/create-app` is the ONLY thing that would notice — it scaffolds a
        // project out of `dist-templates/` and builds it. Without this a
        // templates-only PR got neither the regenerated templates nor that suite;
        // #853 passed only by also touching root `package.json`.
        runE2E: true,
        why: '@gjsify/create-app build → node scripts/process-template.mjs reads templates/',
    },
];

function classifyAndExpand(workspaces: readonly Workspace[], changedFiles: readonly string[]): ClassifyResult {
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
    // Ignored files go FIRST, before the global-trigger check: ignore wins over
    // global, so `packages/infra/cli/README.md` must not force a full run.
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
    // Global triggers short-circuit — checked on the non-ignored remainder.
    for (const f of remaining) {
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
    const { matched, unmatched } = workspacesForChangedFiles(workspaces, remaining);
    // Seeds no graph edge can reach. BEFORE the `unmatched` bail-out, so the table
    // also works for a coupled directory that is not itself a workspace — such a
    // file would otherwise force a full run and never consult the declared seeds.
    const knownNames = new Set(workspaces.map((w) => w.name));
    const couplingSeeds = new Set<string>();
    const couplingAccounted = new Set<string>();
    let couplingRunE2E = false;
    for (const c of SCRIPT_COUPLINGS) {
        const hits = remaining.filter((f) => c.match.test(f));
        if (hits.length === 0) continue;
        for (const h of hits) couplingAccounted.add(h);
        for (const s of c.seeds) {
            // A declared seed that is not a workspace means the table drifted from the
            // tree (renamed, moved, removed). Fail towards the full run and SAY SO: a
            // missing rebuild here is invisible, so this must never degrade quietly
            // back into the bug the table exists to prevent.
            if (!knownNames.has(s)) {
                return {
                    global: true,
                    reason:
                        `script-coupling seed ${s} is not a workspace (${c.match.source} → ${c.why}); ` +
                        `SCRIPT_COUPLINGS in commands/affected.ts is stale`,
                    workspaces: workspaces.map((w) => w.name),
                    runE2E: true,
                    runIntegration: true,
                    skipAll: false,
                };
            }
            couplingSeeds.add(s);
        }
        if (c.runE2E) couplingRunE2E = true;
    }
    // Unmatched-but-not-ignored (a new top-level dotfile, an uncarved `scripts/`
    // file) falls back to the full run. A file a coupling claimed does not count.
    const stillUnmatched = unmatched.filter((f) => !couplingAccounted.has(f));
    if (stillUnmatched.length > 0) {
        return {
            global: true,
            reason: `unmatched files (${stillUnmatched.length}): ${stillUnmatched.slice(0, 3).join(', ')}${stillUnmatched.length > 3 ? '…' : ''}`,
            workspaces: workspaces.map((w) => w.name),
            runE2E: true,
            runIntegration: true,
            skipAll: false,
        };
    }
    for (const s of couplingSeeds) matched.add(s);
    // Every remaining file is a spec / e2e / integration path under ONE workspace, so
    // skip the closure: test code has no downstream consumers. A coupling disables
    // this — its extra seeds exist precisely because a consumer DOES care.
    const testOnly = couplingSeeds.size === 0 && remaining.every((f) => TEST_PATHS.some((re) => re.test(f)));
    if (testOnly && matched.size === 1) {
        const only = [...matched][0]!;
        // An e2e- or integration-only change still needs its own job.
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
    // PRODUCTION dependencies only. The closure answers "whose tests must re-run
    // because a package they depend on changed", which is a RUNTIME relationship;
    // walking devDependency edges conflated it with the build/test toolchain, so ANY
    // single-package change fanned out to ~210 of 221 workspaces and selective CI
    // bought almost nothing. Prod-only collapses a typical seed to a handful (sqlite
    // 210→4, fetch 210→34) while keeping every real runtime dependent.
    //
    // Safe against under-selection: no `*.spec.ts` imports a CROSS-PACKAGE sibling
    // via a devDependency (the only such imports are self-imports, covered by the
    // package being its own seed), `@gjsify/unit` is a GLOBAL_TRIGGER above, and
    // every push-to-main plus the nightly cron still run the FULL suite.
    const reverse = buildReverseDependencyGraph(workspaces, { includeDev: false });
    const closure = affectedClosure(reverse, [...matched]);
    // `includeDev: true`, deliberately broader than the reverse closure: integration
    // packages declare the pillars they exercise as `dependencies`, but the wider
    // walk tolerates a devDep-declared edge too. Over-running an integration suite is
    // cheap; missing one is not.
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
    const runE2E = remaining.some((f) => f.startsWith('tests/e2e/')) || couplingRunE2E;
    return {
        global: false,
        reason:
            `closure (${closure.size} ws from ${matched.size} seed(s))` +
            (couplingSeeds.size > 0 ? `, ${couplingSeeds.size} via script-coupling` : ''),
        workspaces: [...closure].sort(),
        runE2E,
        runIntegration,
        skipAll: false,
    };
}

function isIntegrationWorkspace(name: string): boolean {
    return name.startsWith('@gjsify/integration-');
}

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
