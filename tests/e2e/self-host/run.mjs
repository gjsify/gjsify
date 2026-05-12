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
//   - We invoke the GJS-CLI directly via `gjs -m dist/cli.gjs.mjs ...`
//     rather than going through `gjsify run` because we want the
//     environment under test to mirror what `gjsify dlx` etc. will
//     eventually need (no Node-side helper).
//   - Byte-equivalence vs the Node-CLI's output is NOT asserted yet.
//     The native rolldown facade currently collapses
//     `minify: { mangle: { keepNames: { … } } }` (npm rolldown's
//     shape) to plain `true`, which changes the bundle size though
//     not its semantics. Tracked in STATUS.md "Open TODOs".

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/self-host/run.mjs → ../../..
const MONOREPO_ROOT = resolvePath(__dirname, '..', '..', '..');
const NODE_CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const GJS_CLI_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SIMPLE_FIXTURE = join(FIXTURES_DIR, 'simple', 'main.mjs');
const YARGS_FIXTURE = join(MONOREPO_ROOT, 'tests', 'integration', 'yargs', 'src', 'test.mts');
const OUT_DIR = join(__dirname, 'out');

function collectPrebuildDirs() {
    // The bundled GJS-CLI uses `@gjsify/rolldown-native` at runtime; its
    // shared library + typelib live under
    // `node_modules/<pkg>/prebuilds/linux-<arch>/`. Walk the monorepo's
    // root `node_modules/@gjsify/` and pick every package that ships
    // a `prebuilds/<arch>/` dir so both LD_LIBRARY_PATH (for the .so)
    // and GI_TYPELIB_PATH (for the .typelib) are populated.
    const arch = process.arch === 'x64' ? 'x86_64' : process.arch;
    const platformArch = `linux-${arch}`;
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
        // Step 1 — bootstrap: Node-CLI builds the GJS-CLI bundle.
        // This step is intentionally Node-side; once the bundle exists
        // every subsequent step runs only via gjs(1).
        rmSync(OUT_DIR, { recursive: true, force: true });
        mkdirSync(OUT_DIR, { recursive: true });
        execFileSync('node', [
            NODE_CLI,
            'build',
            join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'index.ts'),
            '--app', 'gjs',
            '--outfile', GJS_CLI_BUNDLE,
        ], { cwd: MONOREPO_ROOT, stdio: 'pipe' });
        assert.ok(existsSync(GJS_CLI_BUNDLE), 'Node-CLI did not produce dist/cli.gjs.mjs');
    });

    it('GJS-CLI prints --version', () => {
        const r = gjs(['-m', GJS_CLI_BUNDLE, '--version']);
        assert.equal(r.status, 0, `--version exited ${r.status}: ${r.stderr}`);
        assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/, `unexpected version output: ${r.stdout}`);
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
        const r = gjs([
            '-m', GJS_CLI_BUNDLE,
            'build', SIMPLE_FIXTURE,
            '--app', 'gjs',
            '--outfile', outfile,
        ]);
        assert.equal(r.status, 0, `bundle build failed: ${r.stderr}`);
        assert.ok(existsSync(outfile), `bundle output missing: ${outfile}`);

        // Run the bundle.
        const out = gjs(['-m', outfile]);
        assert.equal(out.status, 0, `bundle run failed: ${out.stderr}`);
        // The fixture is `const sum = 1 + 2 + 4; console.log(sum);` — constant-
        // folded by rolldown's minifier to `console.log(7)` or similar.
        assert.match(out.stdout, /\b7\b/, `unexpected bundle stdout: ${JSON.stringify(out.stdout)}`);
    });

    it('GJS-CLI bundles the yargs integration suite and all 52 tests pass', () => {
        const outfile = join(OUT_DIR, 'yargs.gjs.mjs');
        const r = gjs([
            '-m', GJS_CLI_BUNDLE,
            'build', YARGS_FIXTURE,
            '--app', 'gjs',
            '--outfile', outfile,
        ]);
        assert.equal(r.status, 0, `yargs bundle build failed: ${r.stderr}`);
        assert.ok(existsSync(outfile), `yargs bundle output missing: ${outfile}`);

        const out = gjs(['-m', outfile]);
        assert.equal(out.status, 0, `yargs bundle run failed: ${out.stderr}`);
        // `@gjsify/unit` prints `✔ <count> completed` on success.
        assert.match(out.stdout, /\b52 completed\b/, `expected '52 completed' in output, got: ${out.stdout.slice(-500)}`);
    });
});

