// SPDX-License-Identifier: MIT
// Unit tests for the `gjsify affected` classifier.
//
// Branches are exercised by CALLING `classifyAndExpand` on a real temp monorepo; the CLI
// is still spawned where the process boundary IS the thing under test (both emit
// branches, and a real `sh` doing the word split). Why it is split that way, and what
// the all-spawn version cost: `commands/affected-classify.ts` (#1161).

import { describe, it, expect } from '@gjsify/unit';
import { discoverWorkspaces } from '@gjsify/workspace';
import { classifyAndExpand } from './commands/affected-classify.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Resolve the CLI entry from the workspace root rather than `import.meta.url`.
// `gjsify run test:node` runs `node dist/test.node.mjs` after bundling the
// spec, so `import.meta.url` at runtime points at the bundle in `dist/`,
// not at the original `src/` or `lib/` location. The workspace's npm script
// always runs from the package root, so `process.cwd()` is stable here and
// points at `packages/infra/cli`; the tsc-emitted CLI entry is `lib/index.js`.
const CLI_ENTRY = resolve(process.cwd(), 'lib/index.js');

interface ClassifyOutput {
    global: boolean;
    reason: string;
    workspaces: string[];
    runE2E: boolean;
    runIntegration: boolean;
    skipAll: boolean;
}

/**
 * @param withCreateApp mirror the real tree, where `@gjsify/create-app` is the
 *   declared seed of the `templates/**` script coupling. Pass `false` to build
 *   the DRIFTED tree (templates present, the seed gone) that the
 *   stale-SCRIPT_COUPLINGS guard has to catch.
 */
function makeMonorepo(withCreateApp = true): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-affected-spec-'));
    // Root manifest. `templates/*` mirrors the real root manifest: a template
    // IS a workspace, which is exactly why the templates gap was invisible —
    // the change mapped cleanly to its own package and looked fully handled.
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'monorepo-root',
            version: '0.0.0',
            private: true,
            workspaces: ['packages/*/*', 'templates/*'],
        }) + '\n',
    );
    const pkgs = [
        { rel: 'packages/node/fs', name: '@gjsify/fs', deps: {}, devDeps: {} },
        { rel: 'packages/node/path', name: '@gjsify/path', deps: {}, devDeps: {} },
        // A depends on fs at RUNTIME — an fs change must cascade to A.
        {
            rel: 'packages/node/A',
            name: '@gjsify/A',
            deps: { '@gjsify/fs': 'workspace:*' },
            devDeps: {},
        },
        // B depends on fs only as a DEV dependency (the build/test-tooling edge
        // shape). The prod-deps-only closure must NOT pull B in when fs changes.
        {
            rel: 'packages/node/B',
            name: '@gjsify/B',
            deps: {},
            devDeps: { '@gjsify/fs': 'workspace:*' },
        },
        // A template. Note it declares NO dependency on create-app and
        // create-app declares none on it — the coupling is a build SCRIPT
        // (`node scripts/process-template.mjs`), so there is deliberately no
        // manifest edge here for the closure walk to find. That absence is the
        // fixture's whole point.
        {
            rel: 'templates/adw-canvas2d',
            name: '@gjsify/template-adw-canvas2d',
            deps: {},
            devDeps: {},
        },
        // The React Native layer. It IS a workspace and needs no extra seed — the
        // coupling exists for the TIER, because its only external observer is an e2e
        // suite that a `packages/framework/react-native/**` diff would otherwise not
        // turn on.
        {
            rel: 'packages/framework/react-native',
            name: '@gjsify/react-native',
            deps: {},
            devDeps: {},
        },
    ];
    if (withCreateApp) {
        // Directory name `create-gjsify`, package name `@gjsify/create-app` —
        // the real mismatch, which is why searching by directory misses it.
        pkgs.push({
            rel: 'packages/infra/create-gjsify',
            name: '@gjsify/create-app',
            deps: {},
            devDeps: {},
        });
    }
    for (const p of pkgs) {
        const dir = join(root, p.rel);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({
                name: p.name,
                version: '0.0.0',
                dependencies: p.deps,
                devDependencies: p.devDeps,
            }) + '\n',
        );
    }
    return root;
}

/**
 * Run any argv and return the raw streams.
 *
 * `githubOutput` PINS the child's `GITHUB_OUTPUT` — `null` deletes it, a string
 * sets it. Never inherited, and that is the whole point: `emit()` branches on
 * `process.env.GITHUB_OUTPUT`, GitHub Actions exports it into EVERY step, and a
 * spawned child inherits it. So these tests took the stdout branch locally and
 * the append-to-file branch in CI — the same input, two different code paths,
 * decided by an env var no test mentioned. Pinning it makes the branch a
 * PARAMETER of the test instead of a property of the machine.
 */
async function run(
    argv: string[],
    stdin?: string,
    githubOutput?: string | null,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const env = { ...process.env } as Record<string, string>;
    if (githubOutput === null || githubOutput === undefined) delete env.GITHUB_OUTPUT;
    else env.GITHUB_OUTPUT = githubOutput;
    return new Promise((res, rej) => {
        // oxlint-disable-next-line gjsify/spawn-node-binary -- re-entering the CURRENT runtime IS the intent here: this suite is built `--app node` and run by node, bun and deno (`test:cross-runtime`), so the child has to be whichever of the three is under test. It never runs under GJS, so the wrong-interpreter hazard the rule guards cannot arise.
        const child = spawn(process.execPath, argv, { stdio: ['pipe', 'pipe', 'pipe'], env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += String(d)));
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.on('error', rej);
        child.on('close', (code) => res({ code: code ?? -1, stdout, stderr }));
        child.stdin.end(stdin ?? '');
    });
}

const AFFECTED_ARGV = (cwd: string): string[] => [
    CLI_ENTRY,
    'affected',
    '--changed-from-stdin',
    '--format=github-actions',
    '--cwd',
    cwd,
];

/** Pull the `include-args=` value out of a `key=value` block. */
function pickIncludeArgs(block: string, whence: string): string {
    const line = block.split('\n').find((l) => l.startsWith('include-args='));
    if (line === undefined) throw new Error(`no include-args line in ${whence}:\n${block}`);
    return line.slice('include-args='.length);
}

/** Emit with GITHUB_OUTPUT UNSET → the stdout branch. */
async function includeArgsFor(cwd: string, changedFiles: string[]): Promise<string> {
    const r = await run(AFFECTED_ARGV(cwd), changedFiles.join('\n') + '\n', null);
    if (r.code !== 0) throw new Error(`affected exited ${r.code}: ${r.stderr}`);
    return pickIncludeArgs(r.stdout, 'stdout');
}

/**
 * Emit with GITHUB_OUTPUT SET to a temp file → the `appendFileSync` branch,
 * which is the one CI actually takes and the one nothing covered.
 */
async function emitToGithubOutput(
    cwd: string,
    changedFiles: string[],
): Promise<{ code: number; stdout: string; stderr: string; file: string }> {
    const file = join(mkdtempSync(join(tmpdir(), 'gjsify-gh-output-')), 'out.txt');
    const r = await run(AFFECTED_ARGV(cwd), changedFiles.join('\n') + '\n', file);
    return { ...r, file: r.code === 0 ? readFileSync(file, 'utf-8') : '' };
}

/**
 * Word-split `value` exactly as the CONSUMER does — an unquoted `$V` expansion
 * in a real POSIX shell. This is the assertion that actually matters: a unit
 * test comparing strings cannot tell a token from a token-with-quotes-attached,
 * which is the whole of repo task #75.
 */
async function shellWordSplit(value: string): Promise<string[]> {
    return new Promise((res, rej) => {
        // The value rides in as a positional (`$1`), then is expanded UNQUOTED
        // exactly like `$INCLUDE_ARGS` in main.yml. Positional rather than env
        // so the test needs no env plumbing on either runtime.
        const child = spawn('sh', ['-c', 'V="$1"; for a in $V; do printf "%s\\n" "$a"; done', 'sh', value], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (d) => (out += String(d)));
        child.on('error', rej);
        child.on('close', () => res(out.split('\n').filter((s) => s.length > 0)));
    });
}

/** Classify DIRECTLY — the handler's own two calls, on a really-walked temp monorepo. */
function runClassify(cwd: string, changedFiles: string[]): ClassifyOutput {
    return classifyAndExpand(discoverWorkspaces(cwd, { includeRoot: true }), changedFiles);
}

export default async (): Promise<void> => {
    await describe('gjsify affected classifier', async () => {
        const root = makeMonorepo();

        await it('empty diff → skipAll=true', async () => {
            const r = runClassify(root, []);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('only docs → skipAll=true', async () => {
            const r = runClassify(root, ['README.md', 'docs/foo.md', 'STATUS.md']);
            expect(r.skipAll).toBe(true);
        });

        await it('flatpak SDK-extension manifest → skipAll (build tooling, ignored)', async () => {
            const r = runClassify(root, [
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.json',
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.metainfo.xml',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('flatpak manifest alongside a real src change → flatpak ignored, no full run', async () => {
            // The flatpak manifest is dropped by IGNORE, so it neither forces a
            // global run nor widens the closure — only the real `fs` change drives it.
            const r = runClassify(root, [
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.json',
                'packages/node/fs/src/index.ts',
            ]);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('packages/node-gi change → skipAll (own node-gi.yml, not a workspace)', async () => {
            // node-gi is not a gjsify workspace; its own workflow builds + tests
            // it. Its files are ignored so a node-gi-only PR skips the main run.
            const r = runClassify(root, [
                'packages/node-gi/node-gi/src/addon.cc',
                'packages/node-gi/node-gi/index.js',
                'packages/node-gi/node-gi/test/callbacks.test.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('node-gi.yml workflow change → ignored (its own workflow)', async () => {
            const r = runClassify(root, ['.github/workflows/node-gi.yml']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('node-gi alongside a real src change → node-gi ignored, no full run', async () => {
            const r = runClassify(root, ['packages/node-gi/node-gi/src/addon.cc', 'packages/node/fs/src/index.ts']);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('packages/napi change → skipAll (own napi.yml, not a workspace)', async () => {
            // napi is not a gjsify workspace; its own workflow builds + tests it
            // (Vala+C++/meson shim + node-gyp addons). Its files are ignored so a
            // napi-only PR skips the main run.
            const r = runClassify(root, [
                'packages/napi/napi/src/cc/value.cc',
                'packages/napi/napi/conformance/programs/test_number.mjs',
                'packages/napi/napi/scripts/conformance.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('napi.yml workflow change → ignored (its own workflow)', async () => {
            const r = runClassify(root, ['.github/workflows/napi.yml']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('napi alongside a real src change → napi ignored, no full run', async () => {
            const r = runClassify(root, ['packages/napi/napi/src/cc/value.cc', 'packages/node/fs/src/index.ts']);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('docs inside a global-trigger dir → skipAll (ignore wins over global)', async () => {
            // A README in a GLOBAL_TRIGGERS path (packages/infra/cli/,
            // workspace/, …) must NOT force a full run — IGNORE is applied
            // before the global-trigger check.
            const r = runClassify(root, ['packages/infra/cli/README.md', 'packages/infra/workspace/README.md']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('real src in a global-trigger dir still triggers global (alongside a README)', async () => {
            const r = runClassify(root, ['packages/infra/cli/README.md', 'packages/infra/cli/src/commands/build.ts']);
            expect(r.global).toBe(true);
        });

        await it('infra workspace touched → global=true', async () => {
            const r = runClassify(root, ['packages/infra/workspace/src/index.ts']);
            expect(r.global).toBe(true);
            expect(r.runIntegration).toBe(true);
            expect(r.runE2E).toBe(true);
        });

        await it('root lockfile bump → global=true', async () => {
            const r = runClassify(root, ['gjsify-lock.json']);
            expect(r.global).toBe(true);
        });

        await it('root tsconfig → global=true', async () => {
            const r = runClassify(root, ['tsconfig.json']);
            expect(r.global).toBe(true);
        });

        await it('workflow files (other than main.yml) → ignored', async () => {
            const r = runClassify(root, [
                '.github/workflows/deploy-docs.yml',
                '.github/workflows/audit-runtimes.yml',
                // `cancel-pr-runs.yml` is listed by NAME in OTHER_WORKFLOW_INPUTS,
                // like every sibling — the table is an alternation, not a glob, so
                // a new workflow is `unmatched` (a conservative FULL run) until it
                // is added. Asserting it here is what makes that a test failure
                // rather than a silent slowdown on every PR touching the file.
                '.github/workflows/cancel-pr-runs.yml',
            ]);
            expect(r.skipAll).toBe(true);
        });

        await it('single-pkg code change → seeds + prod dependents only', async () => {
            const r = runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.global).toBe(false);
            // fs and its RUNTIME dependent A — closure size 2. B (devDep on fs)
            // is intentionally excluded by the prod-deps-only closure.
            expect(r.workspaces.length).toBe(2);
            expect(r.workspaces.includes('@gjsify/fs')).toBeTruthy();
            expect(r.workspaces.includes('@gjsify/A')).toBeTruthy();
        });

        await it('devDependent is NOT pulled into the closure (prod-deps only)', async () => {
            // @gjsify/B devDepends @gjsify/fs; a change to fs must not re-test B.
            // This is the core of the prod-only closure — build/test-tool devDep
            // edges no longer fan a single-package change out across the monorepo
            // (the cause of the historical 210/221-workspace closure explosion).
            const r = runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.workspaces.includes('@gjsify/B')).toBe(false);
            expect(r.workspaces.includes('@gjsify/A')).toBeTruthy();
        });

        await it('@gjsify/unit (universal test framework) change → global=true', async () => {
            // packages/gjs/unit is a GLOBAL_TRIGGERS path: under the prod-deps-
            // only closure a unit change would otherwise yield a near-empty
            // closure, but a matcher bug can break assertions anywhere — so a
            // change to the test framework must force a full run.
            const r = runClassify(root, ['packages/gjs/unit/src/index.ts']);
            expect(r.global).toBe(true);
        });

        await it('test-only change for one ws → no closure expansion', async () => {
            const r = runClassify(root, ['packages/node/fs/src/foo.spec.ts']);
            expect(r.global).toBe(false);
            expect(r.workspaces.length).toBe(1);
            expect(r.workspaces[0]).toBe('@gjsify/fs');
        });

        await it('unmatched-but-not-ignored file → conservative global', async () => {
            const r = runClassify(root, ['scripts/unknown.mjs']);
            // scripts/ is not in IGNORE and not in any workspace; classifier
            // bails out conservatively.
            expect(r.global).toBe(true);
        });

        // ── Inputs owned by ANOTHER workflow (repo task #73, gaps 1+2) ──────
        // Both directories are real, load-bearing build inputs — just not to
        // `main.yml`, the only workflow this classifier gates. Each is covered
        // by the `paths:` filter of the workflow that DOES run it, so ignoring
        // them here drops no coverage; leaving them out only bought a full
        // ~90-minute `main.yml` run on every change to either.

        await it('.github/prebuild-toolchain/** → skipAll (prebuilds.yml owns it)', async () => {
            const r = runClassify(root, [
                '.github/prebuild-toolchain/emulated-build.sh',
                '.github/prebuild-toolchain/changed-packages.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('scripts/manifest-conformance/** → skipAll (audit-runtimes.yml owns it)', async () => {
            const r = runClassify(root, [
                'scripts/manifest-conformance/rules/tier.mjs',
                'scripts/manifest-conformance/unchecked-fields.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('the manifest-conformance PACKAGE is NOT ignored', async () => {
            // The carve-out is scoped to the `scripts/` half deliberately.
            // `main.yml` DOES run manifest-conformance code — through
            // `scripts/verify-package-outputs.mjs` importing
            // `packages/infra/manifest-conformance/lib/**` — so that half must
            // keep behaving like the ordinary workspace it is. A regex widened
            // to `manifest-conformance` anywhere would silence a real input.
            const r = runClassify(root, ['packages/infra/manifest-conformance/lib/rules/field-coverage.mjs']);
            expect(r.skipAll).toBe(false);
        });

        await it('status/ + its generator → skipAll (audit-runtimes.yml owns them)', async () => {
            // The authored status data (ADR 0016). `status/status.json` matched
            // NOTHING before this entry existed: not a workspace, not ignored,
            // so it landed in `unmatched` and forced a full CI run for a file
            // `main.yml` never opens. The `.md` siblings were only ignored by
            // accident, through the generic `/\.md$/i`, which is why the gap
            // showed on the JSON alone. `audit-runtimes.yml`'s `status-data`
            // rule reads all of it on every PR.
            const r = runClassify(root, ['status/status.json', 'status/open-todos.md', 'scripts/generate-status.mjs']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('release-cut.yml → ignored (its own workflow)', async () => {
            // The same class as the two above, found while fixing them: the
            // workflow shipped without an IGNORE entry, so every change to it
            // forced a full run.
            const r = runClassify(root, ['.github/workflows/release-cut.yml']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('other-workflow input alongside a real src change → no full run', async () => {
            const r = runClassify(root, [
                '.github/prebuild-toolchain/emulated-build.sh',
                'scripts/manifest-conformance/rules/tier.mjs',
                'packages/node/fs/src/index.ts',
            ]);
            expect(r.global).toBe(false);
            expect(r.workspaces.length).toBe(2);
        });

        // ── Script-based coupling: templates/ (repo task #73, gap 3) ────────
        // `templates/*` are workspaces, so a template change ALWAYS seeded its
        // own `@gjsify/template-<name>` and looked handled. The consumer that
        // actually rebuilds is `@gjsify/create-app`, which reads `templates/`
        // from a BUILD SCRIPT (`node scripts/process-template.mjs`) rather than
        // a dependency — no edge, so no closure walk can reach it. Its output
        // `dist-templates/` is a build-cache candidate, so the stale copy was
        // then served indefinitely, and `run-e2e:false` skipped
        // `tests/e2e/create-app`, the one suite that would have noticed.

        await it('templates/** seeds @gjsify/create-app (no manifest edge exists)', async () => {
            const r = runClassify(root, ['templates/adw-canvas2d/package.json']);
            expect(r.global).toBe(false);
            expect(r.workspaces.includes('@gjsify/create-app')).toBe(true);
            // The template still seeds itself — the coupling ADDS a seed, it
            // does not replace the ordinary file→workspace mapping.
            expect(r.workspaces.includes('@gjsify/template-adw-canvas2d')).toBe(true);
        });

        await it('templates/** turns the e2e tier on', async () => {
            // tests/e2e/create-app scaffolds from dist-templates/ and builds
            // the result: it is the only real coverage a template change has.
            const r = runClassify(root, ['templates/adw-canvas2d/src/main.ts']);
            expect(r.runE2E).toBe(true);
        });

        await it('templates/** reports the coupling in its reason', async () => {
            // The reason string is what a human reads in the CI log to see
            // WHY create-app is in a closure it has no dependency edge into.
            const r = runClassify(root, ['templates/adw-canvas2d/package.json']);
            expect(r.reason.includes('script-coupling')).toBe(true);
        });

        await it('a templates spec file does NOT take the test-only shortcut', async () => {
            // TEST_ONLY skips closure expansion because test code has no
            // downstream consumers. A coupled directory does have one, so the
            // shortcut must not swallow the extra seed.
            const r = runClassify(root, ['templates/adw-canvas2d/src/foo.spec.ts']);
            expect(r.workspaces.includes('@gjsify/create-app')).toBe(true);
        });

        // ── Script-based coupling: packages/framework/react-native (#1550) ──
        await it('packages/framework/react-native/** turns the e2e tier on', async () => {
            // tests/e2e/react-native-devtools is the only external observer of
            // `AppRegistry.runApplication`, and the e2e tier otherwise turns on only
            // for a `tests/e2e/**` touch — so the suite was silent for exactly the
            // diffs it exists to catch.
            const r = runClassify(root, ['packages/framework/react-native/src/app-registry.ts']);
            expect(r.runE2E).toBe(true);
        });

        await it('the react-native coupling adds NO seed of its own', async () => {
            // The package is a workspace and seeds itself; a coupling that also
            // seeded something would be claiming a rebuild edge that does not exist.
            const r = runClassify(root, ['packages/framework/react-native/src/app-registry.ts']);
            expect(r.workspaces.includes('@gjsify/react-native')).toBe(true);
            expect(r.workspaces.includes('@gjsify/create-app')).toBe(false);
        });

        await it('a react-native spec file ALSO turns the e2e tier on', async () => {
            // TEST_ONLY skips closure expansion, and the coupling must survive that
            // shortcut: a change to a react-native vector is exactly when the loop
            // observer is worth running.
            const r = runClassify(root, ['packages/framework/react-native/src/widgets.spec.ts']);
            expect(r.runE2E).toBe(true);
        });

        await it('a non-templates change does NOT seed create-app', async () => {
            // The coupling must stay scoped — otherwise it is just a second,
            // quieter global trigger.
            const r = runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.workspaces.includes('@gjsify/create-app')).toBe(false);
            expect(r.runE2E).toBe(false);
        });

        await it('a stale SCRIPT_COUPLINGS seed fails LOUDLY to a full run', async () => {
            // The table names workspaces by string, so a rename/move/removal
            // can desync it. Degrading quietly would restore the exact silent
            // no-rebuild this table exists to prevent, so a missing seed goes
            // global and names itself.
            const drifted = makeMonorepo(false);
            try {
                const r = runClassify(drifted, ['templates/adw-canvas2d/package.json']);
                expect(r.global).toBe(true);
                expect(r.reason.includes('SCRIPT_COUPLINGS')).toBe(true);
                expect(r.reason.includes('@gjsify/create-app')).toBe(true);
            } finally {
                rmSync(drifted, { recursive: true, force: true });
            }
        });

        // ── include-args transport (repo task #75) ──────────────────────
        // `include-args` is consumed as an UNQUOTED `$INCLUDE_ARGS` expansion
        // inside main.yml's `su … -c "… sh -c '…'"` nesting. It therefore must
        // carry NO quoting of its own: an expansion result is never re-scanned
        // for quotes, so a pre-quoted token arrives with the quotes glued on,
        // matches zero workspaces, and `gjsify foreach` exits 0 — CI built
        // nothing on every selective run for as long as that shipped.

        await it('github-actions include-args carries NO quoting', async () => {
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            expect(value.includes("'")).toBe(false);
            expect(value.includes('"')).toBe(false);
            // Sorted closure = @gjsify/A (prod dependent) + @gjsify/fs (seed).
            expect(value).toBe('--include @gjsify/A --include @gjsify/fs');
        });

        await it('include-args word-splits into exactly the argv CI intends', async () => {
            // The real proof: run the consumer's own expansion in a real shell.
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            const argv = await shellWordSplit(value);
            expect(argv.join('|')).toBe('--include|@gjsify/A|--include|@gjsify/fs');
            // Belt and braces: no surviving token may carry a quote character.
            // Pre-quoting produced `'@gjsify/fs'` here, which is what silently
            // matched nothing.
            expect(argv.some((a) => a.includes("'") || a.includes('"'))).toBe(false);
        });

        await it('global run emits an EMPTY include-args (the full-run signal)', async () => {
            // main.yml keys FULL off `include-args == ''`, so a global
            // classification must not smuggle tokens into the value.
            const value = await includeArgsFor(root, ['gjsify-lock.json']);
            expect(value).toBe('');
        });

        // The $GITHUB_OUTPUT branch — the one CI takes and the one that had
        // never executed anywhere. `emit()` wrote it with a BARE `require`
        // ('node:fs') in an ESM package: a ReferenceError, reachable only when
        // GITHUB_OUTPUT is set, i.e. only inside a GitHub Actions step. Present
        // since the command's first commit; it surfaced the moment a test
        // exercised `--format=github-actions` under CI, because the runner
        // exports GITHUB_OUTPUT into every step and the spawned CLI inherits it.

        await it('writes key=value lines to $GITHUB_OUTPUT (not stdout)', async () => {
            const r = await emitToGithubOutput(root, ['packages/node/fs/src/index.ts']);
            expect(r.code).toBe(0);
            // The ReferenceError killed the process here; assert on the code
            // AND the message so a future regression is self-describing.
            expect(r.stderr.includes('require is not defined')).toBe(false);
            expect(r.file.includes('include-args=')).toBe(true);
            expect(r.file.includes('skip-all=false')).toBe(true);
            expect(r.file.includes('global=false')).toBe(true);
            // Routed to the FILE, so stdout carries no key=value block.
            expect(r.stdout.includes('include-args=')).toBe(false);
        });

        await it('$GITHUB_OUTPUT and stdout carry the SAME include-args', async () => {
            // Both branches format one value; only the sink differs. A drift
            // here would mean CI and every local `gjsify affected` disagree.
            const viaFile = await emitToGithubOutput(root, ['packages/node/fs/src/index.ts']);
            expect(viaFile.code).toBe(0);
            const viaStdout = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            expect(pickIncludeArgs(viaFile.file, '$GITHUB_OUTPUT')).toBe(viaStdout);
        });

        await it("include-args still satisfies the workflow's contains() gates", async () => {
            // Thirteen `contains(needs.changes.outputs.include-args, '@gjsify/…')`
            // expressions substring-match this value. They matched the quoted
            // spelling too — which is exactly why the gates kept firing while
            // the build did nothing — so this pins that unquoting them did not
            // break the gates either.
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            expect(value.includes('@gjsify/fs')).toBe(true);
            expect(value.includes('@gjsify/example-')).toBe(false);
        });

        // Cleanup last so failing tests still surface the fixture state.
        await it('teardown', async () => {
            rmSync(root, { recursive: true, force: true });
            expect(true).toBe(true);
        });
    });
};
