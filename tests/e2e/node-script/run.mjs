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
import { join, dirname, basename, resolve } from 'node:path';
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
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

writeFileSync(join(here, 'sibling.marker'), here + '\\n');
console.log('ENTRY:' + basename(process.argv[1]));
console.log('ARGS:' + args.join(','));
if (args.includes('--fail')) process.exit(3);
console.log('OK');
`;

/**
 * A script that reports the two things a globals policy decides, both read at RUNTIME
 * rather than grepped out of the bundle:
 *
 *   `document`         — whether a GTK-backed register was injected at all.
 *   `process.versions` — WHICH `process` the bundle got. Without the register the bundle's
 *                        own banner stub stands and `versions` is empty; with it,
 *                        `@gjsify/process` answers `node: 20.0.0` — deliberately, for the
 *                        npm packages that gate an API LEVEL on it. dart-sass gates its
 *                        HOST STRATEGY on that same key, which is the incident this
 *                        policy exists for (#1053).
 *
 * The `document` half reads the identifier FOR REAL rather than through `typeof`, and the
 * try/catch is the price of that: `detect-free-globals.ts` treats a bare `typeof X` as a
 * presence-check guard and defers it until something actually uses X, so a typeof-only
 * probe never triggers the injection it is trying to observe (measured: it reported
 * `DOCUMENT:no` under a policy that excluded nothing). A bare read is a ReferenceError
 * when no register was injected — which is exactly the answer being asked for.
 */
const GLOBALS_PROBE = `let documentPresent = 'no';
try {
    documentPresent = document === undefined ? 'no' : 'yes';
} catch {
    documentPresent = 'no';
}
console.log('DOCUMENT:' + documentPresent);
console.log('VERSIONS_NODE:' + (typeof process.versions.node === 'string' ? 'yes' : 'no'));
`;

// NOTE for whoever extends this: you MAY now assert that nothing after
// `process.exit(3)` runs. This note used to say the opposite, and PINNED the
// divergence it described — `exitProcess` scheduled the syscall on a GLib idle
// source and returned, so the line after it still executed. That is fixed:
// `exitProcess` drives the main context itself and does not come back.
// `tests/e2e/process-exit-terminates` owns the four shapes of that claim,
// including the one a naive `system.exit()` still hangs on. What THIS suite
// holds is the part a build chain depends on: the CODE survives.

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

    it('keeps the SOURCE basename on the bundle, so an is-entry guard still fires', () => {
        // `process.argv[1]` is the second half of "the bundle does not live where the source
        // lives", and it was missed when `import.meta.url` got its define. The standard entry
        // guard — `scripts/audit-runtimes.mjs` asks whether `process.argv[1]` ENDS WITH
        // `audit-runtimes.mjs` — was false against a bundle named `<name>.mjs-<hash>.mjs`, so
        // `gjsify run --node-script scripts/audit-runtimes.mjs --platforms` printed NOTHING
        // and exited 0. The hash moved into the DIRECTORY; the file keeps the source's name.
        const { output } = runInFixture(['run', '--node-script', 'scripts/probe.mjs']);
        assert.match(output, /ENTRY:probe\.mjs\b/, `the entry name did not survive bundling:\n${output}`);
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

// The DECLARED half of `--node-script`, as opposed to the detected one.
//
// `--globals auto` answers a runtime question syntactically: it injects a register for
// every global the bundled code MENTIONS, and it cannot tell a live branch from a dead
// one. `@gjsify/adwaita-web`'s stylesheet build is where that bit: auto-detection saw
// dart-sass's browser half, injected the GTK-backed DOM registers and `@gjsify/process`,
// and the resulting bundle both demanded `gi://Gdk` at load and reported
// `process.versions.node` — which sent dart-sass down a host path whose `require("url")`
// a bundled ESM artifact cannot serve (#1053).
//
// The declaration lives in the script's package rather than on a flag because the shim
// path has no command line: a `package.json` spelling `node scripts/x.mjs` re-enters the
// CLI through a `node` on PATH, and that spelling has to stay (`writeNodeShim`).
describe('gjsify run --node-script globals policy', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let rootDir;

    /** A project whose only script is {@link GLOBALS_PROBE}, with the given `gjsify` block. */
    function writeProject(dir, gjsifyBlock) {
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: `policy-${basename(dir)}`, private: true, type: 'module', ...gjsifyBlock },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, 'scripts', 'probe.mjs'), GLOBALS_PROBE);
    }

    /** Run the probe under the GJS CLI bundle and return its stdout+stderr. */
    function runProbe(cwd, scriptPath) {
        return execFileSync('gjs', ['-m', CLI_BUNDLE, 'run', '--node-script', scriptPath], {
            cwd,
            stdio: 'pipe',
            timeout: 4 * 60 * 1000,
            encoding: 'utf-8',
        });
    }

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-node-script-globals-'));
        rootDir = join(tmpDir, 'root');
        // One node_modules at the root: resolution walks up, so every fixture below —
        // including the NESTED package — is served by it, and the nested case stays about
        // config anchoring rather than about installs.
        mkdirSync(join(rootDir, 'node_modules'), { recursive: true });
        for (const p of LINK_PKGS) {
            const src = join(WS_MODULES, p);
            if (existsSync(src)) symlinkSync(src, join(rootDir, 'node_modules', p), 'dir');
        }

        writeProject(join(rootDir, 'auto'), {});
        writeProject(join(rootDir, 'pkg-level'), { gjsify: { excludeGlobals: ['document', 'process'] } });
        // Package level excludes ONE of the two; the nodeScript layer excludes both. Which
        // `process` the probe reports is therefore the discriminator between "the override
        // applied" and "the package-level list applied".
        writeProject(join(rootDir, 'override'), {
            gjsify: {
                excludeGlobals: ['document'],
                nodeScript: { excludeGlobals: ['document', 'process'] },
            },
        });
        // The cwd's package says nothing; the script's package says everything.
        writeProject(join(rootDir, 'outer'), {});
        writeProject(join(rootDir, 'outer', 'inner'), {
            gjsify: { nodeScript: { excludeGlobals: ['document', 'process'] } },
        });
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('injects both registers when nothing is declared — the state that broke #1053', () => {
        const out = runProbe(join(rootDir, 'auto'), 'scripts/probe.mjs');
        assert.match(out, /DOCUMENT:yes/, out);
        assert.match(out, /VERSIONS_NODE:yes/, out);
    });

    it('honours package-level gjsify.excludeGlobals', () => {
        const out = runProbe(join(rootDir, 'pkg-level'), 'scripts/probe.mjs');
        assert.match(out, /DOCUMENT:no/, out);
        // The banner `process` is still there — only its `versions.node` claim is gone.
        assert.match(out, /VERSIONS_NODE:no/, out);
    });

    it('lets gjsify.nodeScript override the package-level list', () => {
        const out = runProbe(join(rootDir, 'override'), 'scripts/probe.mjs');
        assert.match(out, /VERSIONS_NODE:no/, `the package-level list won, so the override was ignored:\n${out}`);
    });

    it("reads the policy of the SCRIPT's package, not the cwd's", () => {
        const out = runProbe(join(rootDir, 'outer'), join('inner', 'scripts', 'probe.mjs'));
        assert.match(out, /DOCUMENT:no/, `the cwd's package answered instead of the script's:\n${out}`);
        assert.match(out, /VERSIONS_NODE:no/, out);
    });
});
