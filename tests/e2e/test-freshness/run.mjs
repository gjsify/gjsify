// E2E test for `gjsify test`'s bundle-freshness decision (#1651).
//
// The defect this pins was invisible to every existing guard, and CI is the
// reason: a fresh container has no `dist/`, so `isFresh` returns false and the
// bundle is always built. The only party that meets a wrong freshness answer is
// whoever runs `gjsify test` locally — i.e. the person verifying a dependency
// bump or a refactor before pushing. So the suite must drive the REAL command
// twice over a tree that already has a bundle; a unit test on the predicate
// cannot see the argument the command passes it, and the argument was the bug
// (`dirname(<test entry>)` — `tests/`, never `src/`).
//
// Both arms, and the negative one is not optional:
//   POSITIVE — an edit under `src/` must rebuild. Before the fix this suite is
//              red: `gjsify test` reran the previous bundle and reported ✅ on
//              a version of the code that was no longer on disk.
//   NEGATIVE — a file OUTSIDE the input set must NOT rebuild. Without it the
//              suite also passes against `isFresh() { return false }`, which is
//              not a fix, it is the freshness check deleted.
//
// The marker is a STRING, deliberately. A comment does not survive
// minification, a genuine rebuild then comes out byte-identical, and an A/B
// over file hashes proves nothing.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT, e2eSkipReason, prebuildDir } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CLI_GJS_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

/**
 * The `--app gjs` arm needs the GJS bundle, an interpreter, and the engine's
 * typelib. Each is DECLARED rather than guarded by an `if`: a host that cannot
 * run the arm says which precondition was missing, and one that claims it can
 * (via `GJSIFY_E2E_REQUIRE`) fails instead of going quiet.
 */
const GJS_ARCH = process.arch === 'x64' ? 'linux-x64' : process.arch === 'arm64' ? 'linux-arm64' : null;
const ROLLDOWN_PREBUILD = GJS_ARCH === null ? null : prebuildDir('infra', 'rolldown-native', GJS_ARCH);
const GJS_FRESHNESS_SKIP = e2eSkipReason('test-freshness (GJS arm)', [
    ['linux', process.platform === 'linux'],
    ['a supported arch', GJS_ARCH !== null],
    ['gjs on PATH', spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0],
    ['the built cli.gjs.mjs', existsSync(CLI_GJS_BUNDLE)],
    [
        'the rolldown-native prebuild typelib',
        ROLLDOWN_PREBUILD !== null && existsSync(join(ROLLDOWN_PREBUILD, 'GjsifyRolldown-1.0.typelib')),
    ],
]);

/**
 * An isolated fixture has no `node_modules/@gjsify/rolldown-native`, so the
 * engine's typelib is not on the GI search path the way it is inside the repo.
 * Point both variables at the repo's prebuild — `GjsifyRolldown.typelib` is the
 * engine, `libgjsify_rolldown.so` its library.
 */
const GJS_ENGINE_ENV = {
    ...process.env,
    GI_TYPELIB_PATH: ROLLDOWN_PREBUILD ?? '',
    LD_LIBRARY_PATH: ROLLDOWN_PREBUILD ?? '',
};

/** `gjs -m <cli.gjs.mjs> …`, the launcher a consumer's GJS host actually uses. */
function runCliGjs(args, { cwd, env }) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', CLI_GJS_BUNDLE, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (d) => {
            stdout += d;
        });
        child.stderr.on('data', (d) => {
            stderr += d;
        });
        // A kill with a known signal never throws, and a GJS bundle that wedges
        // on the main loop would otherwise hold the suite open until CI's cap.
        const kill = setTimeout(() => child.kill('SIGKILL'), 180_000);
        child.on('close', (status) => {
            clearTimeout(kill);
            resolve({ status, stdout, stderr });
        });
        child.on('error', reject);
    });
}

/**
 * A package whose suite lives in `tests/` and whose code under test lives in
 * `src/` — the split that made `dirname(entry)` the wrong root. It is also the
 * layout `gjsify create` leaves behind and the one the consumer that found this
 * (postbote) has.
 */
function writeProject(projectDir, marker) {
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    mkdirSync(join(projectDir, 'tests'), { recursive: true });
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify(
            {
                name: 'test-freshness-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
                gjsify: { test: { entry: 'tests/test.mts' } },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeMarker(projectDir, marker);
    writeFileSync(
        join(projectDir, 'tests', 'test.mts'),
        ["import { MARKER } from '../src/lib.js';", 'console.log(`fixture marker: ${MARKER}`);', ''].join('\n'),
        'utf-8',
    );
}

function writeMarker(projectDir, marker) {
    writeFileSync(join(projectDir, 'src', 'lib.ts'), `export const MARKER = '${marker}';\n`, 'utf-8');
}

const bundleOf = (projectDir) => readFileSync(join(projectDir, 'dist', 'test.node.mjs'), 'utf-8');

/** What a run decided, read off the verbose log rather than inferred. */
function rebuilt(result) {
    assert.equal(result.status, 0, `gjsify test failed:\n${result.stdout}\n${result.stderr}`);
    const log = `${result.stdout}${result.stderr}`;
    const built = log.includes('building →');
    const skipped = log.includes('bundle is up-to-date');
    assert.ok(built !== skipped, `log says neither built nor skipped:\n${log}`);
    return built;
}

describe('gjsify test — bundle freshness (#1651)', { timeout: 300_000 }, () => {
    let projectDir;

    const runTest = () =>
        runCli(CLI_ENTRY, ['test', '--runtime', 'node', '--verbose'], { cwd: projectDir, timeoutMs: 120_000 });

    before(async () => {
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-test-freshness-'));
        writeProject(projectDir, 'ALPHA_MARKER');
        assert.ok(rebuilt(await runTest()), 'the cold run must build');
        assert.match(bundleOf(projectDir), /ALPHA_MARKER/);
    });

    after(() => {
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('rebuilds when the code UNDER TEST changes (positive arm)', async () => {
        writeMarker(projectDir, 'BRAVO_MARKER');
        assert.ok(rebuilt(await runTest()), 'an edit under src/ must invalidate the bundle');
        // The artifact, not the log: the run has to have MEASURED the new code.
        const bundle = bundleOf(projectDir);
        assert.match(bundle, /BRAVO_MARKER/);
        assert.doesNotMatch(bundle, /ALPHA_MARKER/);
    });

    it('rebuilds for an input in a directory no allow-list anticipated', async () => {
        // `src/` and `tests/` are not privileged names — anything in the package
        // that is not an output is an input. A build genuinely may read `po/`,
        // `files/`, `data/`; `@gjsify/adwaita-fonts` has no `src/` at all.
        mkdirSync(join(projectDir, 'po'), { recursive: true });
        writeFileSync(join(projectDir, 'po', 'de.po'), 'msgid ""\n', 'utf-8');
        assert.ok(rebuilt(await runTest()), 'a file outside src/ and tests/ is still an input');
    });

    it('rebuilds when the dependency tree moves (lockfile)', async () => {
        // The bump that surfaced #1651 touched no file in the package at all.
        // `node_modules` is too large to stat per run, so the lockfile stands
        // in for it.
        writeFileSync(join(projectDir, 'gjsify-lock.json'), '{}\n', 'utf-8');
        assert.ok(rebuilt(await runTest()), 'a lockfile write must invalidate the bundle');
    });

    it('does NOT rebuild for its own output, or for node_modules and dot-dirs (negative arm)', async () => {
        assert.equal(rebuilt(await runTest()), false, 'an untouched tree must not rebuild');

        writeFileSync(join(projectDir, 'dist', 'stray.txt'), 'output\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'the command’s own outdir is not an input');

        mkdirSync(join(projectDir, 'node_modules', 'dep'), { recursive: true });
        writeFileSync(join(projectDir, 'node_modules', 'dep', 'index.js'), '// dep\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'node_modules is not walked');

        mkdirSync(join(projectDir, '.cache'), { recursive: true });
        writeFileSync(join(projectDir, '.cache', 'blob'), 'x\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'dot-entries are tool state, not inputs');

        mkdirSync(join(projectDir, 'lib'), { recursive: true });
        writeFileSync(join(projectDir, 'lib', 'out.js'), '// built\n', 'utf-8');
        assert.equal(rebuilt(await runTest()), false, 'a conventional output dir is not an input');
    });

    it('still rebuilds after the negative arm, so the cache was not simply switched off', async () => {
        writeMarker(projectDir, 'CHARLIE_MARKER');
        assert.ok(rebuilt(await runTest()));
        assert.match(bundleOf(projectDir), /CHARLIE_MARKER/);
    });
});

/**
 * A consumer whose test bundle imports a SIBLING workspace package — the
 * layout of postbote (`app/` + `packages/*`, one repo, the packages symlinked
 * into the app's `node_modules`), and the shape that found the second half of
 * this defect: the package walk sees every file under the APP, and a workspace
 * package is not under the app. An edit to `packages/signal/src/receiver.ts`
 * therefore left the bundle "fresh" and the run reported on code that was no
 * longer on disk — a stale GREEN, the worst kind of wrong.
 *
 * The input set that can answer this is the BUNDLE's, not the app's: the
 * bundler is the only party that knows a bare specifier resolved through
 * `node_modules/@fixture/signal` into `packages/signal/src/`.
 */
function writeWorkspace(root) {
    mkdirSync(join(root, 'app', 'src'), { recursive: true });
    mkdirSync(join(root, 'app', 'node_modules', '@fixture'), { recursive: true });
    mkdirSync(join(root, 'packages', 'signal', 'src'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            { name: 'freshness-workspace-root', private: true, workspaces: ['app', 'packages/*'] },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'app', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/app',
                version: '1.0.0',
                type: 'module',
                private: true,
                dependencies: { '@fixture/signal': 'workspace:*' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'packages', 'signal', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/signal',
                version: '1.0.0',
                type: 'module',
                private: true,
                exports: { '.': './src/index.ts' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'app', 'src', 'test.mts'),
        ["import { MARKER } from '@fixture/signal';", 'console.log(`fixture marker: ${MARKER}`);', ''].join('\n'),
        'utf-8',
    );
    // What `yarn install`/`npm install` lays down for a workspace member.
    symlinkSync(
        join('..', '..', '..', 'packages', 'signal'),
        join(root, 'app', 'node_modules', '@fixture', 'signal'),
        'dir',
    );
    writeSignal(root, 'ALPHA_SIGNAL');
}

function writeSignal(root, marker) {
    writeFileSync(join(root, 'packages', 'signal', 'src', 'index.ts'), `export const MARKER = '${marker}';\n`, 'utf-8');
}

describe('gjsify test — a workspace package outside the app (postbote)', { timeout: 300_000 }, () => {
    let root;

    const runTest = () =>
        runCli(CLI_ENTRY, ['test', '--runtime', 'node', '--verbose'], {
            cwd: join(root, 'app'),
            timeoutMs: 120_000,
        });

    const bundle = () => readFileSync(join(root, 'app', 'dist', 'test.node.mjs'), 'utf-8');

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-test-freshness-ws-'));
        writeWorkspace(root);
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('rebuilds when a workspace package it imports changes', async () => {
        assert.ok(rebuilt(await runTest()), 'the cold run must build');
        assert.match(bundle(), /ALPHA_SIGNAL/);

        // Nothing in `app/` moves: only a sibling package the bundle imports.
        writeSignal(root, 'BRAVO_SIGNAL');
        assert.ok(rebuilt(await runTest()), 'an edit in packages/signal must invalidate the app bundle');
        const emitted = bundle();
        assert.match(emitted, /BRAVO_SIGNAL/);
        assert.doesNotMatch(emitted, /ALPHA_SIGNAL/);
    });

    it('leaves the recorded input set untouched when the build FAILS, and rebuilds after', async () => {
        const manifest = join(root, 'app', 'dist', 'test.node.mjs.inputs.json');
        const before = readFileSync(manifest, 'utf-8');
        const bundleBefore = bundle();

        // A build that fails leaves the OLD bundle and the OLD manifest: a
        // half-recorded set would describe modules the artifact does not
        // contain, and the next run would trust it.
        writeSignal(root, 'export const MARKER = ;\n');
        const failed = await runTest();
        assert.equal(failed.status, 1, `a syntax error must fail the run:\n${failed.stdout}\n${failed.stderr}`);
        assert.ok(
            `${failed.stdout}${failed.stderr}`.includes('building →'),
            'a changed source must still reach the build stage',
        );
        assert.equal(readFileSync(manifest, 'utf-8'), before, 'a failed build must not rewrite the input set');
        assert.equal(bundle(), bundleBefore, 'a failed build must leave the previous bundle in place');

        // …and the repair is picked up, which is the point of keeping it.
        writeSignal(root, 'DELTA_SIGNAL');
        assert.ok(rebuilt(await runTest()), 'the repair must rebuild');
        assert.match(bundle(), /DELTA_SIGNAL/);
    });

    it('does NOT rebuild when neither the app nor the package moved (negative arm)', async () => {
        assert.equal(rebuilt(await runTest()), false, 'an untouched workspace must not rebuild');
    });
});

/**
 * The bundler is not the only party that reads an input. `gjsify-css-as-string`
 * follows a stylesheet's own `@import` chain itself — `flattenCssImports` on
 * the GJS-native backend, the shared resolver on npm — and none of those files
 * is a module, so no module graph mentions `base.css`. An edit to it left this
 * suite's app "fresh" and the run reporting a CSS bundle flattened before the
 * edit.
 */
function writeCssWorkspace(root) {
    mkdirSync(join(root, 'app', 'src'), { recursive: true });
    mkdirSync(join(root, 'app', 'node_modules', '@fixture'), { recursive: true });
    mkdirSync(join(root, 'packages', 'theme', 'src'), { recursive: true });
    writeFileSync(
        join(root, 'app', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/app',
                version: '1.0.0',
                type: 'module',
                private: true,
                dependencies: { '@fixture/theme': '*' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'packages', 'theme', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/theme',
                version: '1.0.0',
                type: 'module',
                private: true,
                exports: { '.': './src/index.css' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'app', 'src', 'test.mts'),
        ["import css from '@fixture/theme';", 'console.log(`css bytes: ${css.length}`);', ''].join('\n'),
        'utf-8',
    );
    symlinkSync(
        join('..', '..', '..', 'packages', 'theme'),
        join(root, 'app', 'node_modules', '@fixture', 'theme'),
        'dir',
    );
    writeFileSync(
        join(root, 'packages', 'theme', 'src', 'index.css'),
        '@import "./base.css";\n.themed { color: red; }\n',
        'utf-8',
    );
    writeBaseCss(root, false);
}

/**
 * The IMPORTED stylesheet, and only it. `index.css` IS a module of the graph,
 * so touching it rebuilds for a reason that has nothing to do with the
 * `@import` chain — and would let this arm pass against the unfixed code.
 */
function writeBaseCss(root, edited) {
    writeFileSync(
        join(root, 'packages', 'theme', 'src', 'base.css'),
        `.base { color: rebeccapurple; }\n${edited ? '.edited { padding: 3px; }\n' : ''}`,
        'utf-8',
    );
}

/**
 * A file a PLUGIN inlined, reached through the NATIVE engine.
 *
 * Two gaps in one arm, both of which no Node-run suite can reach: the
 * `--app gjs` path is where `@gjsify/rolldown-native` reports `watchedFiles`
 * (npm rolldown answers `RolldownBuild.watchFiles` instead, and the node arms
 * exercise that), and `gjsify-node-modules-path-rewrite` folds
 * `readFileSync(new URL('./token.txt', import.meta.url))` into a literal, so
 * the file's bytes are in the bundle while no module graph names it.
 *
 * Measured red before the fix: the run reported `bundle is up-to-date` and
 * printed the OLD token.
 */
function writeInlinedReadWorkspace(root) {
    mkdirSync(join(root, 'app', 'src'), { recursive: true });
    mkdirSync(join(root, 'app', 'node_modules', '@fixture'), { recursive: true });
    mkdirSync(join(root, 'packages', 'signal', 'src'), { recursive: true });
    writeFileSync(
        join(root, 'app', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/app',
                version: '1.0.0',
                type: 'module',
                private: true,
                dependencies: { '@fixture/signal': '*' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'packages', 'signal', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/signal',
                version: '1.0.0',
                type: 'module',
                private: true,
                exports: { '.': './src/index.ts' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(root, 'packages', 'signal', 'src', 'index.ts'),
        [
            "import { readFileSync } from 'node:fs';",
            "export const TOKEN = readFileSync(new URL('./token.txt', import.meta.url), 'utf8').trim();",
            '',
        ].join('\n'),
        'utf-8',
    );
    writeFileSync(
        join(root, 'app', 'src', 'test.mts'),
        ["import { TOKEN } from '@fixture/signal';", 'console.log(`token: ${TOKEN}`);', ''].join('\n'),
        'utf-8',
    );
    symlinkSync(
        join('..', '..', '..', 'packages', 'signal'),
        join(root, 'app', 'node_modules', '@fixture', 'signal'),
        'dir',
    );
    writeToken(root, 'ALPHA_TOKEN');
}

function writeToken(root, token) {
    writeFileSync(join(root, 'packages', 'signal', 'src', 'token.txt'), `${token}\n`, 'utf-8');
}

describe(
    'gjsify test — an inlined read, through the GJS engine',
    { skip: GJS_FRESHNESS_SKIP, timeout: 600_000 },
    () => {
        let root;

        const runTest = () =>
            runCliGjs(['test', '--runtime', 'gjs', '--verbose'], { cwd: join(root, 'app'), env: GJS_ENGINE_ENV });

        before(() => {
            root = mkdtempSync(join(tmpdir(), 'gjsify-test-freshness-gjs-'));
            writeInlinedReadWorkspace(root);
        });

        after(() => {
            if (root) rmSync(root, { recursive: true, force: true });
        });

        it('rebuilds when a file the rewriter INLINED changes', async () => {
            const cold = await runTest();
            assert.equal(cold.status, 0, `gjsify test failed:\n${cold.stdout}\n${cold.stderr}`);
            assert.ok(rebuilt(cold), 'the cold run must build');
            assert.match(`${cold.stdout}${cold.stderr}`, /token: ALPHA_TOKEN/);

            // Only `token.txt` moves: its bytes are IN the bundle, no graph names
            // it, and it is not under the app — so only a declaration can see it.
            writeToken(root, 'BRAVO_TOKEN');
            const warm = await runTest();
            assert.equal(warm.status, 0, `gjsify test failed:\n${warm.stdout}\n${warm.stderr}`);
            assert.ok(rebuilt(warm), 'an inlined read must invalidate the app bundle');
            assert.match(`${warm.stdout}${warm.stderr}`, /token: BRAVO_TOKEN/);
        });

        it('does NOT rebuild when nothing moved (negative arm)', async () => {
            const run = await runTest();
            assert.equal(run.status, 0, `gjsify test failed:\n${run.stdout}\n${run.stderr}`);
            assert.equal(rebuilt(run), false, 'an untouched tree must not rebuild');
        });
    },
);

describe('gjsify test — a file the bundler never saw (an `@import`ed stylesheet)', { timeout: 300_000 }, () => {
    let root;

    const runTest = () =>
        runCli(CLI_ENTRY, ['test', '--runtime', 'node', '--verbose'], {
            cwd: join(root, 'app'),
            timeoutMs: 120_000,
        });

    const bundle = () => readFileSync(join(root, 'app', 'dist', 'test.node.mjs'), 'utf-8');

    /**
     * The flattened stylesheet's byte count, as the RUN reported it. The CSS
     * itself is constant-folded into that number and never reaches the artifact,
     * so a count that grew is the evidence that the rebuild measured the bigger
     * stylesheet — no hardcoded length, which would rot with every
     * lightningcss version.
     */
    const cssBytes = (result) => {
        const match = `${result.stdout}${result.stderr}`.match(/css bytes: (\d+)/);
        assert.ok(match, `the run did not print the stylesheet size:\n${result.stdout}\n${result.stderr}`);
        return Number(match[1]);
    };

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-test-freshness-css-'));
        writeCssWorkspace(root);
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('rebuilds when a stylesheet the CSS plugin @imported changes', async () => {
        const cold = await runTest();
        assert.ok(rebuilt(cold), 'the cold run must build');
        const before = cssBytes(cold);

        // Only `base.css` moves — the file `index.css` pulls in, in another
        // package, that is not a module of the graph.
        writeBaseCss(root, true);
        const warm = await runTest();
        assert.ok(rebuilt(warm), 'an @import-ed stylesheet must invalidate the app bundle');
        assert.ok(
            cssBytes(warm) > before,
            `the rebuild must measure the grown stylesheet: ${before} → ${cssBytes(warm)}`,
        );
    });

    it('refuses to call the bundle fresh when a RECORDED input is gone', async () => {
        // The other half of "vanished": a recorded input we cannot read is not
        // evidence that the artifact is current. Deleting a declared stylesheet
        // must not leave a fresh answer behind — the run reaches the build
        // stage, where the CSS plugin's read of it fails loudly. What must never
        // happen is a SKIP, and a manifest rewritten by a build that failed.
        const manifest = join(root, 'app', 'dist', 'test.node.mjs.inputs.json');
        const before = readFileSync(manifest, 'utf-8');
        rmSync(join(root, 'packages', 'theme', 'src', 'base.css'));
        const run = await runTest();
        const log = `${run.stdout}${run.stderr}`;
        assert.ok(!log.includes('bundle is up-to-date'), `a deleted recorded input must not read as fresh:\n${log}`);
        assert.ok(log.includes('building →'), `the run must reach the build stage:\n${log}`);
        assert.equal(run.status, 1, `the unreadable stylesheet must fail the build:\n${log}`);
        assert.equal(readFileSync(manifest, 'utf-8'), before, 'a failed build must not rewrite the input set');

        // …and the restored file is picked up, so the arm leaves no trap.
        writeBaseCss(root, true);
        const warm = await runTest();
        assert.equal(warm.status, 0, `gjsify test failed:\n${warm.stdout}\n${warm.stderr}`);
        assert.ok(rebuilt(warm), 'the restored stylesheet must rebuild');
    });

    it('does NOT rebuild when the whole stylesheet chain is untouched (negative arm)', async () => {
        assert.equal(rebuilt(await runTest()), false, 'an untouched chain must not rebuild');
    });
});
