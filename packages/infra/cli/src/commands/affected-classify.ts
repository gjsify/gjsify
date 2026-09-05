// SPDX-License-Identifier: MIT
// The `gjsify affected` CLASSIFIER — the pure decision, separated from the command.
//
// WHY THIS MODULE EXISTS (#1161). The spec used to reach `classifyAndExpand` by spawning
// the built CLI for all 40 cases, deliberately: the spawns kept the helper unexported.
// Measured, they cost 12.81 s against a 30 s per-`describe()` budget (11.68 s / 12.30 s on
// two other hosts, so it is the suite's property, not a host's). A runner 2.6x slower per
// spawn blows it, which CI macOS ordinarily is — so the failure was a BUDGET, never an
// assertion, on the legs that run on `main` rather than on PRs: a red `main` naming no test.
//
// The privacy survives without them: this module is NOT in the package's `exports` map, so
// the spec's relative import is the only way in. The seven cases that genuinely cross a
// process boundary — both emit branches, a real `sh` word-split — still spawn.

import {
    affectedClosure,
    buildDependencyGraph,
    buildReverseDependencyGraph,
    workspacesForChangedFiles,
    type Workspace,
} from '@gjsify/workspace';

export interface ClassifyResult {
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
    // N-API host over SpiderMonkey) is a gjsify workspace member — WHY is ADR 0031,
    // which this comment used to carry alone. The short of it: node-gi's `build` is
    // `node-gyp rebuild`, so a member would enter `foreach build` in a container with
    // no GTK/GI toolchain. `main.yml` therefore neither builds nor tests them and
    // their own workflows are the source of truth. Without the carve-outs their files
    // map to no workspace, land in `unmatched`, and force a full run on every
    // node-gi/napi PR.
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
    {
        // THE SAME SHAPE AS `.githooks/` ABOVE, one layer up: the guard's trigger names
        // the TEST's path instead of the thing under test. `AppRegistry.runApplication`
        // holds three lines observable only by RUNNING the loop —
        // `registerBuiltinWidgets()`, the `toShellOptions` passthrough and
        // `provideWindowChrome()` — and their one external observer is
        // `tests/e2e/react-native-devtools`, which main.yml's `e2e` job now runs under
        // xvfb + a session bus (#1550). Without this entry a change confined to
        // `packages/framework/react-native/**` seeds its own workspace, the e2e tier
        // stays OFF (it turns on for a `tests/e2e/**` touch), and the suite is silent
        // for exactly the PRs it exists to catch. Measured on #1540: deleting
        // `provideWindowChrome()` left format, lint, tsc and all in-process assertions
        // green while the application drew two header bars.
        //
        // No extra seeds — the package is a workspace and already seeds itself. The
        // TIER is the point, as for `.githooks/`.
        match: /^packages\/framework\/react-native\//,
        seeds: [],
        runE2E: true,
        why: 'tests/e2e/react-native-devtools is the only external observer of AppRegistry.runApplication',
    },
];

export function classifyAndExpand(workspaces: readonly Workspace[], changedFiles: readonly string[]): ClassifyResult {
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
            // `|| couplingRunE2E`: this shortcut skips CLOSURE EXPANSION, and a
            // declared tier is not part of the closure. Dropping it here made a
            // coupling's reach depend on the SHAPE of the changed path — the
            // `.githooks/` entry survived only because a hook is not a spec file,
            // while `packages/framework/react-native/src/widgets.spec.ts` fell
            // through and turned the e2e tier back off. Measured by the vector
            // "a react-native spec file ALSO turns the e2e tier on", which was RED
            // when it was written (#1550).
            runE2E: touchedE2E || couplingRunE2E,
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
