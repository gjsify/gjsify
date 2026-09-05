// E2E test for the gjsify CLI self-host loop: the Node-CLI bootstraps a GJS-target CLI
// bundle (the one place Node is still involved), and every step after that runs under stock
// `gjs -m`.
//
// The GJS-CLI is invoked as `gjs -m <bundle>` rather than through `gjsify run`, so the
// environment under test has no Node-side helper — what `gjsify dlx` will need.
//
// Byte-equivalence against the Node-CLI's output is NOT asserted: the native rolldown facade
// collapses npm rolldown's `minify: { mangle: { keepNames: { … } } }` to plain `true`, which
// changes bundle size but not semantics. Tracked in status/open-todos.md.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolvePath(__dirname, '..', '..', '..');
const NODE_CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CLI_PKG_JSON = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'package.json');
const CLI_VERSION = JSON.parse(readFileSync(CLI_PKG_JSON, 'utf-8')).version;
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SIMPLE_FIXTURE = join(FIXTURES_DIR, 'simple', 'main.mjs');
const YARGS_FIXTURE = join(MONOREPO_ROOT, 'tests', 'integration', 'yargs', 'src', 'test.mts');
const OUT_DIR = join(__dirname, 'out');
// The GJS-CLI under test — a SIBLING of the tracked build output, never `dist/cli.gjs.mjs`
// itself, and pinned to TWO constraints:
//
//  * NOT the tracked bundle. The `before()` build passes no `--shebang`, and that flag is
//    what "prepend a shebang and mark it executable (chmod 755)" means (`commands/build.ts`),
//    so writing there replaces a `100755` blob starting `#!/usr/bin/env -S gjs -m` with a
//    shebang-less one and never restores it. Nothing downstream notices: `.bin/gjsify` and
//    the flatpak launcher both `exec gjs -m <path>`, so a missing `#!` only surfaces where
//    the file is exec'd DIRECTLY and falls through to `/bin/sh` (the hazard
//    `utils/bin-shim.ts` documents at `writeBinEntry`). Untracked by construction: since ADR
//    0002 `.gitignore` re-ignores every child of `packages/infra/cli/dist/` and re-includes
//    only `affected.gjs.mjs`.
//  * EXACTLY ONE DIRECTORY BELOW `packages/infra/cli/`, not OUT_DIR. `--version` is answered
//    by `readBundleVersion()` (cli-app.ts), which reads `<bundle dir>/../package.json` and
//    returns `'unknown'` from a swallowing catch — so `dist/<anything>.gjs.mjs` finds
//    `packages/infra/cli/package.json` while OUT_DIR finds nothing. Neither the
//    `__PACKAGE_VERSION__` define nor `resolveCliVersion()` is consulted for `--version`
//    (that pair drives the npm user-agent / publish headers), so a `--define` cannot fix it.
const GJS_CLI_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.selfhost.gjs.mjs');

function collectPrebuildDirs() {
    // The bundled GJS-CLI uses `@gjsify/rolldown-native` at runtime, whose shared library +
    // typelib live under `node_modules/<pkg>/prebuilds/<os>-<arch>/` — so both
    // LD_LIBRARY_PATH (for the .so) and GI_TYPELIB_PATH (for the .typelib) need them.
    //
    // The target is `${process.platform}-${process.arch}` VERBATIM: the one spelling every
    // package declares in `gjsify.platforms`, that `scripts/stage-prebuild.mjs` creates and
    // that the CLI's `resolvePrebuildDirName()` resolves. Do NOT translate `process.arch`
    // into the `uname -m` machine — this used to read `x64 ? 'x86_64' : process.arch`, which
    // composed a directory that does not exist, so every prebuild silently dropped out and
    // the GJS legs failed much later with "no usable bundler engine under GJS".
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
        // The bootstrap, deliberately Node-side; once the bundle exists every step runs
        // through gjs(1) only.
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
        // The EXACT version, not merely a version-shaped string: `readBundleVersion()`
        // swallows its catch and returns `'unknown'`, so this is what fails loudly if the
        // bundle is ever moved out of the package again (see GJS_CLI_BUNDLE).
        assert.equal(r.stdout.trim(), CLI_VERSION, `unexpected version output: ${JSON.stringify(r.stdout)}`);
    });

    it('GJS-CLI prints --help with yargs subcommands registered', () => {
        const r = gjs(['-m', GJS_CLI_BUNDLE, '--help']);
        assert.equal(r.status, 0, `--help exited ${r.status}: ${r.stderr}`);
        assert.match(r.stdout, /gjsify build/);
        assert.match(r.stdout, /gjsify run/);
        assert.match(r.stdout, /gjsify info/);
    });

    it('GJS-CLI bundles a simple ESM fixture and the output runs', () => {
        const outfile = join(OUT_DIR, 'simple.gjs.mjs');
        const r = gjs(['-m', GJS_CLI_BUNDLE, 'build', SIMPLE_FIXTURE, '--app', 'gjs', '--outfile', outfile]);
        assert.equal(r.status, 0, `bundle build failed: ${r.stderr}`);
        assert.ok(existsSync(outfile), `bundle output missing: ${outfile}`);

        const out = gjs(['-m', outfile]);
        assert.equal(out.status, 0, `bundle run failed: ${out.stderr}`);
        // The fixture is `const sum = 1 + 2 + 4; console.log(sum)`, constant-folded by
        // rolldown's minifier.
        assert.match(out.stdout, /\b7\b/, `unexpected bundle stdout: ${JSON.stringify(out.stdout)}`);
    });

    it('GJS-CLI --library build writes nested chunk subdirs (native runNativeBundle regression)', () => {
        // Regression: under the native GJS engine `runNativeBundle` only mkdir'd the
        // top-level outDir, so a multi-module `--library` build — whose output includes a
        // nested chunk like `_virtual/_rolldown/runtime.js` — threw ENOENT on the missing
        // parent. npm rolldown's `.write()` creates those dirs; the native path must too.
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
        // The GJS-CLI rebuilds its OWN entry, and it is the only build that hits BOTH
        // native-bridge edge cases that used to break the self-build:
        //   A) `transform` on rolldown's virtual `\0rolldown/empty.js` (the externalized
        //      typescript/lib stub, code "") — the C glue returned NULL for an
        //      empty-but-present payload → "missing payload bytes".
        //   B) the `unicorn-magic` alias shim resolved relative to the BUNDLE rather than the
        //      plugin under the GJS-bundled CLI → NotFound.
        // Both fire during the single bundling pass, so exit 0 plus a real multi-MB bundle is
        // the proof. `--globals none` skips the slow auto-globals multi-pass: the bridge fix
        // is what is guarded here, and `--globals auto` over the whole CLI blows past gjs()'s
        // 120 s spawn cap on CI (~5 s vs ~21 s locally).
        const cliEntry = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'index.ts');
        const outfile = join(OUT_DIR, 'cli-self.gjs.mjs');
        const r = gjs(
            ['-m', GJS_CLI_BUNDLE, 'build', cliEntry, '--app', 'gjs', '--globals', 'none', '--outfile', outfile],
            { timeout: 240 * 1000 },
        );
        assert.equal(r.status, 0, `CLI self-rebuild failed (native bridge regression?): ${r.stderr}`);
        assert.ok(existsSync(outfile), `self-rebuilt CLI bundle missing: ${outfile}`);
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
        // `@gjsify/unit` prints `✔ <tests> tests passed · <assertions> assertions`
        // on success. 52 is the ASSERTION count — the number this line has always
        // asserted, under its old name "completed" (#1557).
        assert.match(
            out.stdout,
            /\b52 assertions\b/,
            `expected '52 assertions' in output, got: ${out.stdout.slice(-500)}`,
        );
    });

    it('GJS-CLI and Node-CLI yargs bundles are size-equivalent (within 15%)', () => {
        // Byte-equivalence is blocked by rolldown's internal compress heuristics: even with
        // identical top-level `keepNames: true` the two engines emit different module-init
        // code (arrow-fn `__name()` wrappers vs named methods) while staying semantically
        // identical, so only a size envelope can be asserted until upstream unifies.
        const nodeOut = join(OUT_DIR, 'yargs.node.mjs');
        const gjsOut = join(OUT_DIR, 'yargs.gjs.mjs');
        execFileSync('node', [NODE_CLI, 'build', YARGS_FIXTURE, '--app', 'gjs', '--outfile', nodeOut], {
            cwd: MONOREPO_ROOT,
            stdio: 'pipe',
        });
        assert.ok(existsSync(nodeOut), 'Node-CLI did not produce yargs.node.mjs');
        assert.ok(existsSync(gjsOut), 'GJS-CLI bundle from previous test is missing');

        const nodeSize = statSync(nodeOut).size;
        const gjsSize = statSync(gjsOut).size;
        const ratio = Math.abs(nodeSize - gjsSize) / Math.max(nodeSize, gjsSize);
        assert.ok(
            ratio < 0.15,
            `bundle size delta too large: node=${nodeSize} gjs=${gjsSize} ratio=${ratio.toFixed(3)}`,
        );

        const fromNode = gjs(['-m', nodeOut]);
        assert.equal(fromNode.status, 0, `node-built bundle failed under gjs: ${fromNode.stderr}`);
        assert.match(fromNode.stdout, /\b52 assertions\b/);
    });
});
