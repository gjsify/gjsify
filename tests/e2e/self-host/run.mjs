// E2E test for the gjsify CLI self-host loop (Phase D-3).
//
// Flow:
//   1. Build the gjsify CLI for the GJS target via the Node-CLI.
//      This is the "bootstrap" step — the only place Node is still
//      involved in the CLI's lifecycle.
//   2. Run the GJS-CLI under stock `gjs -m` and verify it prints
//      its --version + --help (yargs subcommand registration works).
//   3. Use the GJS-CLI to bundle a 5-line ESM fixture (no @gjsify/*
//      dependencies). The output must run under `gjs -m` and print
//      the expected constant-folded result.
//   4. Use the GJS-CLI to bundle the yargs integration suite fixture.
//      The output must run under `gjs -m` with all 52 yargs tests
//      green (exits 0, last line includes `52 completed`).
//
// Notes:
//   - We invoke the GJS-CLI directly via `gjs -m dist/cli.selfhost.gjs.mjs ...`
//     rather than going through `gjsify run` because we want the
//     environment under test to mirror what `gjsify dlx` etc. will
//     eventually need (no Node-side helper).
//   - Byte-equivalence vs the Node-CLI's output is NOT asserted yet.
//     The native rolldown facade currently collapses
//     `minify: { mangle: { keepNames: { … } } }` (npm rolldown's
//     shape) to plain `true`, which changes the bundle size though
//     not its semantics. Tracked in status/open-todos.md.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/self-host/run.mjs → ../../..
const MONOREPO_ROOT = resolvePath(__dirname, '..', '..', '..');
const NODE_CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CLI_PKG_JSON = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'package.json');
const CLI_VERSION = JSON.parse(readFileSync(CLI_PKG_JSON, 'utf-8')).version;
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SIMPLE_FIXTURE = join(FIXTURES_DIR, 'simple', 'main.mjs');
const YARGS_FIXTURE = join(MONOREPO_ROOT, 'tests', 'integration', 'yargs', 'src', 'test.mts');
const OUT_DIR = join(__dirname, 'out');
// The GJS-CLI under test — a SIBLING of the tracked bundle, never the tracked
// bundle itself. Untracked: `.gitignore` re-includes exactly `cli.gjs.mjs` and
// `affected.gjs.mjs` out of the ignored `dist/`, so any other name here is
// ignored by construction.
//
// This used to BE `dist/cli.gjs.mjs`, which made running this suite a
// destructive act on the working tree: the `before()` build passes no
// `--shebang`, and that flag is what "prepend a shebang and mark it executable
// (chmod 755)" means (`commands/build.ts`), so each run replaced a `100755`
// blob starting `#!/usr/bin/env -S gjs -m` with a shebang-less one and never
// restored it. Nothing here reverted it and nothing downstream noticed:
// `.bin/gjsify` and the flatpak launcher both `exec gjs -m <path>`, so the
// missing `#!` only surfaces where the file is exec'd DIRECTLY — which falls
// through to `/bin/sh` (the hazard `utils/bin-shim.ts` documents at
// `writeBinEntry`).
//
// It has to stay EXACTLY ONE DIRECTORY BELOW `packages/infra/cli/` rather than
// moving to OUT_DIR, and that is not cosmetic: `--version` is answered by
// `readBundleVersion()` (cli-app.ts), which reads `<bundle dir>/../package.json`
// and returns `'unknown'` from a swallowing catch when that read fails. So
// `dist/<anything>.gjs.mjs` resolves `packages/infra/cli/package.json` while
// OUT_DIR resolves the absent `tests/e2e/self-host/package.json`. Measured both
// ways: the identical build reports `0.26.1` from `cli/dist/` and `unknown` from
// anywhere else.
//
// NB it is neither the `__PACKAGE_VERSION__` define nor `resolveCliVersion()`
// (utils/publish-headers.ts) that answers `--version` — that pair drives the npm
// user-agent / publish headers, and it DOES honour the define (verified: a
// `--define` build folds `typeof __PACKAGE_VERSION__` away and inlines the
// value). `readBundleVersion()` has never consulted either, which is also why it
// is the fragile twin of `readOwnCliVersion()` in utils/build-cache.ts — that one
// walks up to four levels and checks `pkg.name === '@gjsify/cli'`, and its own
// comment says it "mirrors cli-app's readBundleVersion but tolerates both
// directory depths". Making `--version` use the robust one would remove this
// positional coupling altogether; it touches `cli/src` (and so the committed
// bundle), so it is not part of this change.
const GJS_CLI_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.selfhost.gjs.mjs');

function collectPrebuildDirs() {
    // The bundled GJS-CLI uses `@gjsify/rolldown-native` at runtime; its
    // shared library + typelib live under
    // `node_modules/<pkg>/prebuilds/<os>-<arch>/`. Walk the monorepo's
    // root `node_modules/@gjsify/` and pick every package that ships
    // a `prebuilds/<target>/` dir so both LD_LIBRARY_PATH (for the .so)
    // and GI_TYPELIB_PATH (for the .typelib) are populated.
    //
    // The target is `${process.platform}-${process.arch}` verbatim — the one
    // spelling every package declares in `gjsify.platforms`, that
    // `scripts/stage-prebuild.mjs` creates and that the CLI's
    // `resolvePrebuildDirName()` resolves. Do NOT translate `process.arch`
    // into the `uname -m` machine here: this used to read
    // `process.arch === 'x64' ? 'x86_64' : process.arch`, which composed a
    // directory name that no longer exists, so every prebuild silently
    // dropped out of the environment and the GJS legs failed much later with
    // "no usable bundler engine under GJS".
    const platformArch = `${process.platform}-${process.arch}`;
    const root = join(MONOREPO_ROOT, 'node_modules', '@gjsify');
    if (!existsSync(root)) return [];
    const out = [];
    for (const name of readdirSync(root)) {
        const candidate = join(root, name, 'prebuilds', platformArch);
        if (existsSync(candidate)) out.push(candidate);
    }
    return out;
}

function gjsEnv() {
    const prebuilds = collectPrebuildDirs();
    const joined = prebuilds.join(':');
    return {
        ...process.env,
        LD_LIBRARY_PATH: joined + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''),
        GI_TYPELIB_PATH: joined + (process.env.GI_TYPELIB_PATH ? ':' + process.env.GI_TYPELIB_PATH : ''),
    };
}

function gjs(args, opts = {}) {
    return spawnSync('gjs', args, {
        encoding: 'utf-8',
        timeout: 120 * 1000,
        env: gjsEnv(),
        ...opts,
    });
}

describe('CLI self-host loop', { timeout: 5 * 60 * 1000 }, () => {
    before(() => {
        // Step 1 — bootstrap: Node-CLI builds the GJS-CLI bundle to the
        // untracked sibling path (never over the tracked `dist/cli.gjs.mjs` —
        // see GJS_CLI_BUNDLE). This step is intentionally Node-side; once the
        // bundle exists every subsequent step runs only via gjs(1).
        rmSync(OUT_DIR, { recursive: true, force: true });
        rmSync(GJS_CLI_BUNDLE, { force: true });
        mkdirSync(OUT_DIR, { recursive: true });
        execFileSync(
            'node',
            [
                NODE_CLI,
                'build',
                join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'index.ts'),
                '--app',
                'gjs',
                '--outfile',
                GJS_CLI_BUNDLE,
            ],
            { cwd: MONOREPO_ROOT, stdio: 'pipe' },
        );
        assert.ok(existsSync(GJS_CLI_BUNDLE), `Node-CLI did not produce ${GJS_CLI_BUNDLE}`);
    });

    it('GJS-CLI prints --version', () => {
        const r = gjs(['-m', GJS_CLI_BUNDLE, '--version']);
        assert.equal(r.status, 0, `--version exited ${r.status}: ${r.stderr}`);
        // The EXACT version, not merely a version-shaped string. `--version` is
        // answered by the position-dependent `readBundleVersion()` (see
        // GJS_CLI_BUNDLE), whose failure mode is a swallowed catch returning
        // `'unknown'` — so this is the assertion that fails loudly if the bundle
        // is ever moved out of the package again.
        assert.equal(r.stdout.trim(), CLI_VERSION, `unexpected version output: ${JSON.stringify(r.stdout)}`);
    });

    it('GJS-CLI prints --help with yargs subcommands registered', () => {
        const r = gjs(['-m', GJS_CLI_BUNDLE, '--help']);
        assert.equal(r.status, 0, `--help exited ${r.status}: ${r.stderr}`);
        // At least the build/run/info subcommands must surface.
        assert.match(r.stdout, /gjsify build/);
        assert.match(r.stdout, /gjsify run/);
        assert.match(r.stdout, /gjsify info/);
    });

    it('GJS-CLI bundles a simple ESM fixture and the output runs', () => {
        const outfile = join(OUT_DIR, 'simple.gjs.mjs');
        const r = gjs(['-m', GJS_CLI_BUNDLE, 'build', SIMPLE_FIXTURE, '--app', 'gjs', '--outfile', outfile]);
        assert.equal(r.status, 0, `bundle build failed: ${r.stderr}`);
        assert.ok(existsSync(outfile), `bundle output missing: ${outfile}`);

        // Run the bundle.
        const out = gjs(['-m', outfile]);
        assert.equal(out.status, 0, `bundle run failed: ${out.stderr}`);
        // The fixture is `const sum = 1 + 2 + 4; console.log(sum);` — constant-
        // folded by rolldown's minifier to `console.log(7)` or similar.
        assert.match(out.stdout, /\b7\b/, `unexpected bundle stdout: ${JSON.stringify(out.stdout)}`);
    });

    it('GJS-CLI --library build writes nested chunk subdirs (native runNativeBundle regression)', () => {
        // Regression: under the native GJS engine, `runNativeBundle` only
        // mkdir'd the top-level outDir, so a multi-module `--library` build
        // — whose output includes a nested chunk like rolldown's
        // `_virtual/_rolldown/runtime.js` — threw ENOENT on the missing
        // parent dir. npm rolldown's `.write()` creates those dirs; the
        // native path must too. The build exiting non-zero is the failure.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-selfhost-lib-'));
        try {
            writeFileSync(join(dir, 'entry.js'), "import { x } from './lib.js';\nexport const y = x + 1;\n");
            writeFileSync(join(dir, 'lib.js'), 'export const x = 41;\n');
            const outdir = join(dir, 'out');
            const r = gjs(['-m', GJS_CLI_BUNDLE, 'build', '--library', join(dir, 'entry.js'), '--outdir', outdir]);
            assert.equal(r.status, 0, `--library build failed (nested-chunk ENOENT regression?): ${r.stderr}`);
            assert.ok(existsSync(join(outdir, 'entry.js')), `library entry output missing under ${outdir}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('GJS-CLI rebuilds ITSELF under gjs + native rolldown (Node-free self-host; bridge bugs A+B)', () => {
        // The GJS-CLI rebuilds its OWN entry — the "previous gjsify builds next
        // gjsify" milestone. This is the only build that hits BOTH
        // native-bridge edge cases that broke the self-build before:
        //   A) `transform` on rolldown's virtual `\0rolldown/empty.js` (the
        //      externalized typescript/lib stub, code "") — the C glue returned
        //      NULL for an empty-but-present payload → "missing payload bytes"
        //      (@gjsify/rolldown-native glue fix).
        //   B) the `unicorn-magic` alias shim was resolved relative to the
        //      bundle (not the plugin) under the GJS-bundled CLI → NotFound
        //      (rolldown-plugin-gjsify `resolveShim` exports-map fallback).
        // Both bugs fire during the single bundling pass, so a clean exit 0 +
        // a real multi-MB bundle is the proof. We pass `--globals none` to skip
        // the (slow) auto-globals multi-pass — it's the BRIDGE fix we guard, not
        // the globals detector, and the full `--globals auto` build of the whole
        // CLI under native rolldown blows past gjs()'s 120 s spawn cap on CI
        // (~5 s with `none` locally vs ~21 s with `auto`).
        const cliEntry = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'index.ts');
        const outfile = join(OUT_DIR, 'cli-self.gjs.mjs');
        const r = gjs(
            ['-m', GJS_CLI_BUNDLE, 'build', cliEntry, '--app', 'gjs', '--globals', 'none', '--outfile', outfile],
            { timeout: 240 * 1000 },
        );
        assert.equal(r.status, 0, `CLI self-rebuild failed (native bridge regression?): ${r.stderr}`);
        assert.ok(existsSync(outfile), `self-rebuilt CLI bundle missing: ${outfile}`);
        // A real multi-MB bundle, not an empty/partial file.
        assert.ok(
            statSync(outfile).size > 1_000_000,
            `self-rebuilt CLI bundle implausibly small: ${statSync(outfile).size} B`,
        );
    });

    it('GJS-CLI bundles the yargs integration suite and all 52 tests pass', () => {
        const outfile = join(OUT_DIR, 'yargs.gjs.mjs');
        const r = gjs(['-m', GJS_CLI_BUNDLE, 'build', YARGS_FIXTURE, '--app', 'gjs', '--outfile', outfile]);
        assert.equal(r.status, 0, `yargs bundle build failed: ${r.stderr}`);
        assert.ok(existsSync(outfile), `yargs bundle output missing: ${outfile}`);

        const out = gjs(['-m', outfile]);
        assert.equal(out.status, 0, `yargs bundle run failed: ${out.stderr}`);
        // `@gjsify/unit` prints `✔ <count> completed` on success.
        assert.match(
            out.stdout,
            /\b52 completed\b/,
            `expected '52 completed' in output, got: ${out.stdout.slice(-500)}`,
        );
    });

    it('GJS-CLI and Node-CLI yargs bundles are size-equivalent (within 15%)', () => {
        // Strong byte-equivalence is blocked by rolldown's internal compress
        // heuristics: even with identical top-level `keepNames: true`, the
        // two engines emit slightly different module-init code (arrow-fn
        // `__name()` wrappers vs. named methods). Both produce semantically
        // identical bundles (52/52 yargs tests pass on both), so we assert
        // a sane size envelope here and revisit a stricter check once the
        // upstream rolldown behavior is unified.
        const nodeOut = join(OUT_DIR, 'yargs.node.mjs');
        const gjsOut = join(OUT_DIR, 'yargs.gjs.mjs');
        execFileSync('node', [NODE_CLI, 'build', YARGS_FIXTURE, '--app', 'gjs', '--outfile', nodeOut], {
            cwd: MONOREPO_ROOT,
            stdio: 'pipe',
        });
        assert.ok(existsSync(nodeOut), 'Node-CLI did not produce yargs.node.mjs');
        // gjsOut was created by the previous test; sanity-check.
        assert.ok(existsSync(gjsOut), 'GJS-CLI bundle from previous test is missing');

        const nodeSize = statSync(nodeOut).size;
        const gjsSize = statSync(gjsOut).size;
        const ratio = Math.abs(nodeSize - gjsSize) / Math.max(nodeSize, gjsSize);
        assert.ok(
            ratio < 0.15,
            `bundle size delta too large: node=${nodeSize} gjs=${gjsSize} ratio=${ratio.toFixed(3)}`,
        );

        // Both bundles must produce the same test result under gjs.
        const fromNode = gjs(['-m', nodeOut]);
        assert.equal(fromNode.status, 0, `node-built bundle failed under gjs: ${fromNode.stderr}`);
        assert.match(fromNode.stdout, /\b52 completed\b/);
    });
});
