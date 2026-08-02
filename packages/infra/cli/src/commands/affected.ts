// `gjsify affected --base <sha> [--head <ref>] [--format=...]`
//
// Diffs the working tree against `<base>` and emits the set of workspaces
// that are AFFECTED by the change set — i.e. seeds plus everything that
// transitively depends on them. CI uses the output as the `--include`
// filter for `gjsify foreach test`, so a typical single-package PR ends
// up running the touched workspace + its downstream consumers instead of
// the whole monorepo.
//
// EVERY VERDICT THIS FILE EMITS IS SCOPED TO ONE WORKFLOW: `main.yml`. That
// scoping is the single most misread thing here, so it is stated before the
// tables rather than after. The classifier is booted only by `main.yml`'s
// `changes` job, and `main.yml` is the only workflow whose jobs consume its
// outputs. So "ignored" NEVER means "irrelevant to the repository" — it means
// "cannot change what `main.yml` builds or tests". Sibling workflows
// (`prebuilds.yml`, `audit-runtimes.yml`, `node-gi.yml`, `napi.yml`,
// `deploy-docs.yml`, …) gate themselves with their OWN `paths:` filters and are
// unaffected by anything decided here. `IGNORE` has always worked this way —
// `packages/node-gi/**` and `packages/napi/**` are load-bearing build inputs to
// their own workflows and ignored here — but the table read as a global claim,
// which is how a directory that is genuinely irrelevant to `main.yml` still
// looks like something that must not be ignored.
//
// Classifier table (first-match wins) handles the cases that aren't a
// straightforward "file lives in workspace X":
//
//   1. IGNORE  — cannot change what `main.yml` builds or tests: pure-docs /
//      *.md / website / refs/ submodule / other workflows' files and their
//      inputs / LICENSE / .gitignore. Discarded FIRST, before every other
//      rule: an ignored file is never build-relevant to this workflow, not
//      even inside a GLOBAL_TRIGGERS directory (e.g.
//      `packages/infra/cli/README.md` must not force a full run just because
//      `packages/infra/cli/` is a global trigger). Ignore wins over global.
//
//   2. GLOBAL_TRIGGERS  — a non-ignored change touching infra the classifier
//      itself depends on (`@gjsify/workspace`, `@gjsify/cli`, the bundler
//      plugins, the lockfile, root tsconfig / package.json, this very
//      workflow file). Emits `global=true` → CI must run the full suite. We
//      can't trust the closure when the algorithm that computes it just
//      changed.
//
//   3. SCRIPT_COUPLINGS  — a build input that reaches its consumer through a
//      BUILD SCRIPT instead of a dependency, so the closure walk has no edge
//      to follow. Contributes EXTRA seeds (and may force a test tier). See
//      the table for why this cannot be inferred and must be declared.
//
//   4. TEST_ONLY  — every changed file under ONE workspace is a spec
//      file, e2e fixture, or integration test. Seed = that workspace
//      but SKIP the closure expansion (downstream consumers don't care
//      about test code changes).
//
//   5. CODE (default)  — `workspacesForChangedFiles` maps file → ws,
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
// `include-args` CONTRACT (github-actions format) — read this before changing
// its shape. The value is a SPACE-SEPARATED list of ALREADY-SHELL-SAFE tokens:
//
//     include-args=--include @gjsify/fs --include @gjsify/stream
//
// and its only supported consumption is an UNQUOTED `$INCLUDE_ARGS` expansion
// in a POSIX shell, where word splitting is exactly the intent. It carries NO
// quoting of its own, deliberately:
//
//   * `main.yml` splices it into a `su testuser -c "… sh -c '…'"` nesting, and
//     the result of a parameter expansion is NEVER re-scanned for quotes. When
//     this emitted `--include '@gjsify/fs'`, the apostrophes became part of the
//     glob, every pattern matched zero workspaces, and `foreach` exited 0 —
//     CI "built" nothing on every selective PR run in 0.65 s (repo task #75).
//     Pre-quoting a value for an unknown number of nesting levels cannot work;
//     emitting tokens that need no quoting at any level can.
//   * There are FIVE consumers of this one output — the build / browser-bundle
//     / check / test steps splice it into a command line, and thirteen
//     `contains(needs.changes.outputs.include-args, '@gjsify/…')` GitHub
//     expressions substring-match it. A format that requires per-consumer
//     unquoting would have to be repeated five times in the very nesting that
//     produced the bug; `contains()` is unaffected either way (it matched the
//     quoted spelling too, which is why the gates kept working while the build
//     silently did nothing).
//
// Shell-safety is ENFORCED, not assumed: `assertShellSafeWorkspaceName` rejects
// any workspace name outside `[A-Za-z0-9@._/-]` before it is emitted. npm names
// cannot contain those characters, so this never fires in practice — and if it
// somehow does, the command exits non-zero, the classify step's
// `continue-on-error` leaves the outputs unset, and CI falls back to a FULL
// run. Failing towards "run everything" is the safe direction.
//
// `--changed-from-stdin` skips `git diff` entirely and reads a newline-
// separated list of paths from stdin. Useful for local debugging and
// for the spec suite. Stdin is slurped via `utils/stdin.ts`, NOT
// `readFileSync(0)` — `@gjsify/fs` has no numeric-fd path, so the Node
// idiom opens the relative file `./0` and the committed GJS classifier
// bundle died with `ENOENT … read '0'` on every `--changed-from-stdin` run.

import type { Command } from '../types/index.js';
import { spawnSync } from 'node:child_process';
// STATIC import, never a lazy `require('node:fs')`. This package is ESM
// (`"type": "module"`), so a bare `require` is a ReferenceError the moment the
// line executes — and the only line that executes it sits behind
// `if (process.env.GITHUB_OUTPUT)`, i.e. exclusively inside a GitHub Actions
// step. That is why it survived from the command's first commit: every local
// run and every spec took the stdout branch. There is no reason for laziness
// here — the command already statically imports `node:child_process`, and the
// classifier bundle resolves `node:fs` through `@gjsify/fs` like any other.
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

        const result = classifyAndExpand(workspaces, changedFiles);
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
    // The test framework every spec imports. It is a *devDependency* of
    // virtually every workspace, so with the prod-deps-only closure below
    // (`includeDev: false`) a change to it would otherwise yield a near-empty
    // closure and silently skip every downstream test — yet a bug in a matcher
    // can break assertions anywhere. Treat it as a global trigger so a
    // `@gjsify/unit` change re-runs the full suite.
    /^packages\/gjs\/unit\//,
    // The composite action every CI job runs to set itself up. A change here
    // alters the environment of the whole matrix, so it must force a full run
    // EXPLICITLY — it already did, but only by falling through to the
    // conservative "unmatched files" path, which is luck rather than intent.
    /^\.github\/actions\//,
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

/**
 * Inputs OWNED BY ANOTHER WORKFLOW — build-relevant, just not to `main.yml`.
 *
 * This is the sub-table where the workflow scoping stated at the top of the
 * file is load-bearing, so each entry NAMES the workflow that does gate it.
 * The test for membership is not "is this file unimportant" (none of these
 * are) but "can `main.yml` build or test differently because of it" — and for
 * every entry the answer is no, while the owning workflow has the path in its
 * own `paths:` filter and would go red on a break.
 *
 * Adding a regex here is therefore a claim with two halves, and BOTH must
 * hold: `main.yml` must not read the path, and some other workflow must.
 */
const OTHER_WORKFLOW_INPUTS = [
    // Each sibling workflow's own definition. `main.yml` is deliberately
    // absent — it is a GLOBAL_TRIGGER, since a job-shape change there is
    // invisible until the workflow re-runs.
    /^\.github\/workflows\/(deploy-docs|commitlint|release|release-cut|audit-runtimes|prebuilds|node-gi|napi|cli-cross-platform|build-ci-image|cancel-pr-runs)\.yml$/,
    // `prebuilds.yml`'s toolchain (#838): the QEMU-emulated build script and
    // the `changed-packages` classifier that decides which native packages a
    // prebuild run rebuilds. `prebuilds.yml` lists `.github/prebuild-toolchain/**`
    // in BOTH its `push` and `pull_request` `paths:` filters, so a break here
    // reds that workflow on the same PR. `main.yml` never executes any of it —
    // it builds no prebuild and runs no emulated leg.
    /^\.github\/prebuild-toolchain\//,
    // The REPO-SCOPED manifest-conformance rules (#847) — `tier`, `refs-pin`,
    // `platforms-ci` plus the `unchecked-fields` ledger. Their gate is
    // `audit-runtimes.yml`, which runs `node scripts/audit-runtimes.mjs
    // --check --strict` on EVERY pull_request with no `paths:` filter at all,
    // so this content is verified on every PR regardless of what is ignored
    // here; `prebuilds.yml` additionally declares it a shared input (#843) and
    // rebuilds every native package when it changes.
    //
    // The distinction that makes this safe is a real one, not a technicality:
    // `main.yml` DOES run manifest-conformance code, but it reaches it through
    // `scripts/verify-package-outputs.mjs` importing
    // `packages/infra/manifest-conformance/lib/**` — the PACKAGE, a normal
    // workspace under the `packages/infra/*` glob that maps and seeds like any
    // other. Only the `scripts/`-side repo-scoped half is ignored, and that
    // half is precisely the half `main.yml` does not load.
    /^scripts\/manifest-conformance\//,
];

/** Patterns that contribute no seed and don't force a full run. */
const IGNORE = [
    /\.md$/i,
    /^refs\//,
    /^website\//,
    /^docs\//,
    ...OTHER_WORKFLOW_INPUTS,
    /^\.githooks\//,
    // @gjsify/node-gi (the Node-native GObject-Introspection engine, Axis 5) is
    // NOT a gjsify workspace member — the GJS-first install/foreach tooling can't
    // build its node-gyp addon, so the main workflow neither builds nor tests it.
    // Its own `.github/workflows/node-gi.yml` is the source of truth (built +
    // tested on Node). Without this carve-out its files map to no workspace and
    // land in `unmatched`, forcing a conservative full run on every node-gi PR.
    /^packages\/node-gi\//,
    // @gjsify/napi (the N-API host over GJS's SpiderMonkey, the forward mirror of
    // node-gi) is likewise NOT a gjsify workspace member — the GJS-first
    // install/foreach tooling can't build its Vala+C++/meson shim or its node-gyp
    // test addons, so the main workflow neither builds nor tests it. Its own
    // `.github/workflows/napi.yml` is the source of truth. Without this carve-out
    // its files map to no workspace and force a conservative full run on every
    // napi PR.
    /^packages\/napi\//,
    // Flatpak build/distribution tooling (SDK-extension manifest + metainfo).
    // Like `.githooks/`, it has no package-test consumers; its own
    // `tests/e2e/flatpak-sdk-extension` runs on `tests/e2e/**` / global triggers.
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
 * The closure walk is a graph walk, and its only edges are `dependencies` /
 * `optionalDependencies` in a `package.json`. When directory A is a real build
 * input to workspace B because B's BUILD SCRIPT reads it — a `node scripts/…`,
 * a `cpSync`, a glob over the repo — there is no such edge, so no amount of
 * graph walking will ever reach B. The coupling has to be DECLARED.
 *
 * This failure is silent, and silent in the worse direction. An unmodelled
 * input that lands in `unmatched` at least fails towards a full run; this one
 * looks completely healthy: the input's own workspace is seeded, a small green
 * closure is reported, B is never rebuilt, and B's build-output cache keeps
 * serving the copy it made before the change. Nothing goes red.
 *
 * ADD AN ENTRY whenever you wire a build script to read outside its own
 * package. `why` is mandatory and names the script, so the coupling is
 * greppable from the thing that created it.
 *
 * KNOWN COUPLINGS THAT ARE DELIBERATELY NOT LISTED — and the trap they set.
 * A repo-wide sweep (repo task #73) found three more script couplings, all
 * rooted at `scripts/`:
 *
 *   scripts/stage-prebuild.mjs          → 11 native packages (`build:prebuilds`)
 *   scripts/check-refs-pin.mjs          → the 3 Rust bridges (`build:meson`)
 *   scripts/bootstrap-native-facades.mjs → the infra facades (`build:infra`)
 *
 * They need no entry TODAY only because `scripts/` is in neither IGNORE nor
 * any workspace, so a change there lands in `unmatched` and already fails
 * towards a full run. That is safety by accident, and it is load-bearing:
 * **anyone who carves `scripts/` (or any subtree of it) out into IGNORE to
 * save a full run MUST add the matching entries here in the same change**,
 * or those three couplings convert straight from "expensive but correct" into
 * the silent stale-artifact failure this table exists to prevent. The
 * `scripts/manifest-conformance/**` carve-out above is exactly that kind of
 * edit, and it is safe only because nothing under it is a build input to a
 * workspace — it is a CI gate, which is a different thing.
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
        // `templates/*` ARE workspaces (root `package.json#workspaces` carries
        // a `templates/*` glob), so a template change already seeds its own
        // `@gjsify/template-<name>`. That is not the consumer that matters.
        //
        // The consumer is `@gjsify/create-app`, and it is unreachable twice
        // over: it lives at `packages/infra/create-gjsify/`, so no
        // directory-name search finds it, and it takes the templates in
        // through `node scripts/process-template.mjs` in its `build` script
        // (which resolves each template's `workspace:^` specifiers and copies
        // the result into `dist-templates/`), so there is no dependency edge
        // either. `dist-templates/` is a build-output cache candidate, so once
        // it is stale it stays stale.
        match: /^templates\//,
        seeds: ['@gjsify/create-app'],
        // …and `tests/e2e/create-app` is the ONLY thing that would notice: it
        // scaffolds a project out of `dist-templates/` and builds it. Without
        // this a templates-only PR got neither the regenerated templates nor
        // the suite that exercises them. PR #853 passed only by accident of
        // also touching root `package.json` and tripping a global trigger.
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
    // Drop ignored files FIRST — before the global-trigger check. An ignored
    // file (docs, *.md, LICENSE, .gitignore, …) is never build-relevant, not
    // even inside a GLOBAL_TRIGGERS directory: `packages/infra/cli/README.md`
    // must NOT force a full run just because `packages/infra/cli/` is a global
    // trigger. Ignore wins over global.
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
    // Map files → workspaces. Files outside any workspace stay in `unmatched`.
    const { matched, unmatched } = workspacesForChangedFiles(workspaces, remaining);
    // SCRIPT_COUPLINGS: add the seeds no graph edge can reach. Applied BEFORE
    // the `unmatched` bail-out so the table works for a coupled directory that
    // is NOT itself a workspace — such a file would otherwise force a full run
    // and the declared seeds would never be consulted.
    const knownNames = new Set(workspaces.map((w) => w.name));
    const couplingSeeds = new Set<string>();
    const couplingAccounted = new Set<string>();
    let couplingRunE2E = false;
    for (const c of SCRIPT_COUPLINGS) {
        const hits = remaining.filter((f) => c.match.test(f));
        if (hits.length === 0) continue;
        for (const h of hits) couplingAccounted.add(h);
        for (const s of c.seeds) {
            // A declared seed that is not a workspace means the table has
            // drifted from the tree (package renamed, moved, removed). Fail
            // towards the full run and SAY SO — the whole point of this table
            // is that a missing rebuild here is otherwise invisible, so it must
            // never degrade quietly back into the bug it exists to prevent.
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
    // Unmatched-but-not-ignored files are suspicious enough to fall back to
    // the conservative "full run" path. Examples: a new top-level dotfile,
    // a script in `scripts/` we haven't carved out, a refs/-adjacent file.
    // A file a coupling claimed is accounted for and does not count here.
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
    // TEST_ONLY shortcut: every remaining file is a spec / e2e / integration
    // path, all under ONE workspace. Skip the closure expansion — test code
    // has no downstream consumers. A coupling deliberately disables it: the
    // extra seeds exist precisely because a downstream consumer DOES care.
    const testOnly = couplingSeeds.size === 0 && remaining.every((f) => TEST_PATHS.some((re) => re.test(f)));
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
    // Default: closure walk over PRODUCTION dependencies only (`includeDev:
    // false`). The closure answers "whose tests must re-run because a package
    // they depend on changed" — and that is a RUNTIME relationship. Walking
    // devDependency edges instead conflated it with the build/test toolchain:
    // every workspace devDepends `@gjsify/cli`/`@gjsify/tsc`/`@gjsify/unit`,
    // and the umbrella `@gjsify/node-polyfills` prod-depends every polyfill, so
    // ANY single-package change fanned out to ~210 of 221 workspaces — the
    // closure was the whole monorepo and selective CI bought almost nothing.
    // Prod-only collapses a typical seed to a handful (e.g. sqlite 210→4,
    // fetch 210→34) while keeping every real runtime dependent. Safe against
    // under-selection: no `*.spec.ts` imports a *cross-package* sibling via a
    // devDependency (the only such spec imports are self-imports, which are
    // covered by the package being its own seed); the universal test framework
    // `@gjsify/unit` is handled by GLOBAL_TRIGGERS above; and every push-to-
    // main + the nightly cron still run the FULL suite as the backstop.
    const reverse = buildReverseDependencyGraph(workspaces, { includeDev: false });
    const closure = affectedClosure(reverse, [...matched]);
    // Integration suites whose forward deps overlap with the closure also
    // need to run. We walk the forward graph with `includeDev: true` here
    // (deliberately broader than the reverse closure) so an integration suite
    // is never missed: integration packages declare the pillars they exercise
    // as `dependencies`, but the wider walk also tolerates a devDep-declared
    // edge. Over-running an integration suite is cheap; missing one is not.
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
    // A `tests/e2e/**` touch turns the tier on, and so does any coupling that
    // declares e2e as its only real coverage (see SCRIPT_COUPLINGS).
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
        process.stderr.write(`gjsify affected: git diff failed (${r.status}): ${r.stderr.trim()}\n`);
        // Under GJS `process.exit()` is DEFERRED (no atexit — the call
        // returns), so in this synchronous, value-returning helper a bare
        // exit fell through to the `return` below and handed the caller a
        // diff parsed from a failed git run. `return process.exit(…)` cannot
        // help here either — it would hand the caller the pending exit
        // promise as a `string[]`. The throw is what actually stops the
        // caller; on Node the exit(2) halts first and the throw is dead.
        // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path; see the comment above.
        process.exit(2);
        throw new Error(`gjsify affected: git diff failed (${r.status})`);
    }
    return r.stdout.split('\n').filter(Boolean);
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
        // Unquoted, space-separated tokens — see the `include-args` CONTRACT
        // block at the top of this file. Do NOT re-add quoting here.
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
            // GitHub Actions: append to $GITHUB_OUTPUT.
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

// A workspace name that survives an UNQUOTED shell expansion unchanged: no
// whitespace, no quote/escape characters, no glob metacharacters, no `$`, and
// nothing the shell would treat as an operator. npm package names are a strict
// subset of this, so the guard is a machine-checked restatement of the
// `include-args` contract rather than a real runtime branch. Returns the name
// so it can be used inline at the emit site.
const SHELL_SAFE_WORKSPACE_NAME = /^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/;

function assertShellSafeWorkspaceName(name: string): string {
    if (SHELL_SAFE_WORKSPACE_NAME.test(name)) return name;
    process.stderr.write(
        `gjsify affected: workspace name ${JSON.stringify(name)} is not shell-safe, so it cannot be emitted as an\n` +
            `  \`include-args\` token (the value is consumed by an UNQUOTED $INCLUDE_ARGS expansion — see the\n` +
            `  contract at the top of commands/affected.ts). Rename the workspace, or teach this command a\n` +
            `  transport the consumers can unquote. Refusing to emit a filter that would silently mis-match.\n`,
    );
    // NOT unreachable under GJS: `process.exit()` is DEFERRED there (no atexit
    // — the call returns), so the throw below is what actually stops an unsafe
    // name from reaching the emit site; the exit code rides the scheduled
    // teardown. On Node the exit(2) halts first and the throw is dead code.
    // oxlint-disable-next-line gjsify/deferred-process-exit -- the throw below IS the halt for the GJS path; see the comment above.
    process.exit(2);
    throw new Error(`gjsify affected: unsafe workspace name ${name}`);
}
