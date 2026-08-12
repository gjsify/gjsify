// E2E: `gjsify run --node-script <file>` runs an UNBUNDLED Node-style script on a host with
// no usable Node.
//
// The mechanism behind "A Node-less host cannot bootstrap a fresh CLONE"
// (status/open-todos.md): the `node scripts/*.mjs` calls in `build:infra` import nothing but
// `node:fs` / `node:path` / `node:url`, and were unrunnable under GJS only because GJS's ESM
// loader cannot resolve `node:` specifiers for a file on disk.
//
// TWO ENTRY POINTS, both covered: the FLAG for a direct call, and the SHIM — a `node` on PATH
// that re-enters the flag, which is how the build chain reaches it, because its manifests must
// keep spelling `node scripts/x.mjs` (a new flag there cannot be bootstrapped by the previous
// release's CLI — see `writeNodeShim`).
//
// Skipped off a capable host (non-Linux / no gjs / no built bundle).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const WS_MODULES = join(REPO_ROOT, 'node_modules');

// The `--app gjs` substitution resolves `node:fs` → `@gjsify/fs` FROM THE SCRIPT's location,
// so the fixture needs these the way a real project that installed gjsify has them (same set
// and reason as `tests/e2e/gjs-cli-config-load`). Without them the build fails loudly rather
// than silently externalising `node:fs` — correct behaviour, but not what this suite measures.
const LINK_PKGS = ['@gjsify', '@girs', 'rolldown', '@rolldown'];

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

/** PATH with every directory that carries a `node` removed. */
function noNodePath() {
    return (process.env.PATH ?? '')
        .split(':')
        .filter((dir) => dir && !existsSync(join(dir, 'node')))
        .join(':');
}

/**
 * Can we build a PATH that has no `node` but still has `gjs`?
 *
 * Not a given: if a host ships both from the SAME directory, dropping it takes
 * gjs with it and the shim cases would fail for a reason that has nothing to do
 * with the shim. They are skipped there instead of reported as broken. (On the
 * CI image gjs is `/usr/bin/gjs` while Node comes from `actions/setup-node`'s
 * tool cache, so the two are separable; on a maintainer box with nvm, likewise.)
 */
function canDropNodeKeepingGjs() {
    const dirs = noNodePath().split(':').filter(Boolean);
    return dirs.some((dir) => existsSync(join(dir, 'gjs')));
}

const SKIP = process.platform !== 'linux' || !hasGjs() || !existsSync(CLI_BUNDLE);
/** The shim cases additionally need a PATH that can lose `node` and keep `gjs`. */
const SKIP_SHIM = SKIP || !canDropNodeKeepingGjs();

/**
 * A script in the shape of the ones this feature exists for: `node:` builtins
 * only, its own directory derived from `import.meta.url`, a sibling write, args
 * off `process.argv`, and an exit code the caller must see.
 */
const PROBE = `import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

writeFileSync(join(here, 'sibling.marker'), here + '\\n');
console.log('ARGS:' + args.join(','));
if (args.includes('--fail')) process.exit(3);
console.log('OK');
`;

// NOTE for whoever extends this: do NOT assert that nothing after
// `process.exit(3)` runs. Under GJS `process.exit()` SCHEDULES the syscall on a
// GLib idle source and RETURNS (see `@gjsify/process`'s `exitProcess`), so the
// line after it still executes — a documented, pre-existing divergence from Node
// that has nothing to do with this runner, recorded in `status/open-todos.md`.
// What this suite holds is the part a build chain depends on: the CODE survives.

describe('gjsify run --node-script on a Node-less GJS host', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let scriptsDir;
    let fakeBinDir;

    /**
     * Run the GJS CLI bundle.
     *
     * `path: 'sabotaged'` keeps a `node` on PATH that exits 127 and announces
     * itself — the arrangement that proves an explicit `--node-script` never
     * falls back to Node.
     *
     * `path: 'no-node'` removes every directory that carries a `node` instead.
     * The shim is written only when `node` resolves NOWHERE (that is what makes
     * it unable to shadow a working Node), so a sabotaged `node` is still a
     * `node` and would correctly suppress it. Dropping the directories is the
     * only faithful way to be a Node-less host — and it is why `gjs` has to be
     * re-checked afterwards (see `noNodePath`).
     */
    function runInFixture(argv, { expectFail = false, path = 'sabotaged' } = {}) {
        const opts = {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 4 * 60 * 1000,
            encoding: 'utf-8',
            env: {
                ...process.env,
                // `no-node` uses the filtered PATH ALONE — prepending the
                // sabotage dir would put a `node` back and suppress the shim,
                // which is the whole thing under test. Nothing here spawns npm,
                // and a real npm could not run without node anyway.
                PATH: path === 'no-node' ? noNodePath() : `${fakeBinDir}:${process.env.PATH}`,
            },
        };
        try {
            const stdout = execFileSync('gjs', ['-m', CLI_BUNDLE, ...argv], opts);
            assert.ok(!expectFail, `expected a non-zero exit, got 0:\n${stdout}`);
            return { status: 0, output: stdout };
        } catch (err) {
            const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
            assert.ok(expectFail, `expected exit 0, got ${err.status}:\n${output}`);
            return { status: err.status, output };
        }
    }

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-node-script-'));
        projectDir = join(tmpDir, 'proj');
        scriptsDir = join(projectDir, 'scripts');
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
        for (const p of LINK_PKGS) {
            const src = join(WS_MODULES, p);
            if (existsSync(src)) symlinkSync(src, join(projectDir, 'node_modules', p), 'dir');
        }
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'probe-project',
                    private: true,
                    type: 'module',
                    scripts: {
                        // Exactly how the repo's own build chain spells it.
                        build: 'node scripts/probe.mjs from-script',
                        // Compound → executed through `/bin/sh`, which resolves
                        // `node` from PATH. Only a shim can serve this.
                        'build:compound': 'echo step-one && node scripts/probe.mjs compound',
                        'build:nodeflag': 'node --test scripts/probe.mjs',
                    },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(scriptsDir, 'probe.mjs'), PROBE);

        fakeBinDir = join(tmpDir, 'fakebin');
        mkdirSync(fakeBinDir, { recursive: true });
        for (const name of ['node', 'npm']) {
            writeFileSync(join(fakeBinDir, name), `#!/bin/sh\necho "!!! FAKE ${name} CALLED: $*" >&2\nexit 127\n`, {
                mode: 0o755,
            });
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('runs the script, forwards argv, and never touches Node', () => {
        const { output } = runInFixture(['run', '--node-script', 'scripts/probe.mjs', 'alpha', 'beta']);

        assert.ok(!/FAKE (node|npm) CALLED/.test(output), `Node/npm was spawned:\n${output}`);
        assert.match(output, /ARGS:alpha,beta/, `argv was not forwarded:\n${output}`);
        assert.match(output, /\bOK\b/, `script did not reach its end:\n${output}`);
    });

    it("resolves import.meta.url to the SOURCE file, not the bundle's cache dir", () => {
        // Written by the run above. The bundle lives under
        // node_modules/.cache/gjsify/node-scripts/, so an unrewritten
        // `import.meta.url` lands the marker there and this file never appears.
        const marker = join(scriptsDir, 'sibling.marker');
        assert.ok(existsSync(marker), `sibling write went somewhere else — import.meta.url was not rewritten`);
        assert.equal(readFileSync(marker, 'utf-8').trim(), scriptsDir);
    });

    it('propagates a non-zero exit code', () => {
        const { status, output } = runInFixture(['run', '--node-script', 'scripts/probe.mjs', '--fail'], {
            expectFail: true,
        });
        assert.equal(status, 3, `expected the script's own exit code to survive:\n${output}`);
    });

    it('reports a missing script instead of bundling nothing', () => {
        const { output } = runInFixture(['run', '--node-script', 'scripts/does-not-exist.mjs'], { expectFail: true });
        assert.match(output, /no such file/i, output);
    });

    it('rejects --node-script combined with --runtime', () => {
        const { output } = runInFixture(['run', '--node-script', '--runtime', 'node', 'scripts/probe.mjs'], {
            expectFail: true,
        });
        assert.match(output, /cannot be combined with --runtime/, output);
    });

    // The path the BUILD CHAIN actually takes. Its manifests say
    // `node scripts/x.mjs` and must keep saying it (a new flag there cannot be
    // bootstrapped by the previous release's CLI — see `writeNodeShim`), so what
    // has to work is a `node` on PATH that re-enters the CLI. The compound form
    // is the one that matters: it goes through `/bin/sh`, which no per-command
    // rewrite inside the CLI would ever see.
    it('runs `node <file>` from a package script through the PATH shim', { skip: SKIP_SHIM }, () => {
        const { output } = runInFixture(['run', 'build'], { path: 'no-node' });
        assert.match(output, /ARGS:from-script/, output);
        assert.match(output, /\bOK\b/, output);
    });

    it('runs `node <file>` inside a COMPOUND script (`a && node b`)', { skip: SKIP_SHIM }, () => {
        const { output } = runInFixture(['run', 'build:compound'], { path: 'no-node' });
        assert.match(output, /step-one/, output);
        assert.match(output, /ARGS:compound/, output);
    });

    it('refuses `node <flag>` with a message instead of mis-parsing it', { skip: SKIP_SHIM }, () => {
        // `node --test x.mjs` wants Node's own test runner. Forwarding the flag
        // would make yargs take `--test` FOR the script path.
        const { output } = runInFixture(['run', 'build:nodeflag'], { expectFail: true, path: 'no-node' });
        assert.match(output, /runs a SCRIPT FILE only/, output);
    });
});
