// E2E test for `gjsify run` script-runner (Phase D.5).
//
// Verifies the dual-mode dispatch of the `run` command:
//   - script mode: target matches a script in cwd's package.json, executed
//     via shell with PATH augmented for `node_modules/.bin` (workspace +
//     monorepo root) and yarn-compat env vars (`npm_lifecycle_event`, etc.).
//   - file mode: target resolves to a bundle on disk → existing
//     `runGjsBundle` behavior. We exercise the dispatch (and the
//     `./<file>` disambiguator) but stop short of actually invoking
//     `gjs -m` since that requires the runtime on PATH and is already
//     covered by other e2e suites.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// The GJS-only in-process fast path in `run.ts` only activates under `gjs`,
// not Node — so the double-execution regression can only be exercised by
// running the COMMITTED `dist/cli.gjs.mjs` bundle under `gjs -m`. Detect it.
function hasGjs() {
    try {
        return spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

function runGjs(bundleEntry, args, { cwd, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', bundleEntry, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {}
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => {
            stdout += c;
        });
        child.stderr.on('data', (c) => {
            stderr += c;
        });
        const kill = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {}
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

describe('gjsify run (Phase D.5)', { timeout: 60_000 }, () => {
    let root, cliEntry, wsDir;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-run-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;

        // Build a tiny monorepo so we can test:
        //   - script lookup in a workspace package
        //   - PATH augmentation: a fake bin at <root>/node_modules/.bin/ is
        //     reachable from a workspace script.
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'run-monorepo',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );

        // Root-level fake bin (simulates a hoisted dependency).
        mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
        const binPath = join(root, 'node_modules', '.bin', 'fake-bin');
        writeFileSync(binPath, '#!/usr/bin/env node\nconsole.log("fake-bin-from-root");\n');
        chmodSync(binPath, 0o755);

        wsDir = join(root, 'packages', 'app');
        mkdirSync(wsDir, { recursive: true });
        writeFileSync(
            join(wsDir, 'package.json'),
            JSON.stringify(
                {
                    name: '@test/app',
                    version: '0.0.1',
                    type: 'module',
                    scripts: {
                        hello: `node -e "console.log('hello-from-script')"`,
                        // Echoes back the npm_lifecycle_event yarn-compat env var.
                        lifecycle: `node -e "console.log('lifecycle=' + process.env.npm_lifecycle_event)"`,
                        // Echoes the package name env var.
                        pkgname: `node -e "console.log('pkg=' + process.env.npm_package_name)"`,
                        // Verifies that args appended after the script literal are forwarded.
                        echo: `node -e "console.log('argv=' + process.argv.slice(1).join(','))"`,
                        // Calls the fake-bin via plain name → only works if PATH includes
                        // monorepo-root node_modules/.bin.
                        viabin: `fake-bin`,
                    },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('runs a script from the current package.json', async () => {
        const r = await runCli(cliEntry, ['run', 'hello'], { cwd: wsDir });
        assert.equal(r.status, 0, `run failed: ${r.stderr}\n${r.stdout}`);
        assert.match(r.stdout, /hello-from-script/);
    });

    it('sets npm_lifecycle_event / npm_package_name env vars (yarn-compat)', async () => {
        const r1 = await runCli(cliEntry, ['run', 'lifecycle'], { cwd: wsDir });
        assert.equal(r1.status, 0);
        assert.match(r1.stdout, /lifecycle=lifecycle/);

        const r2 = await runCli(cliEntry, ['run', 'pkgname'], { cwd: wsDir });
        assert.equal(r2.status, 0);
        assert.match(r2.stdout, /pkg=@test\/app/);
    });

    it('forwards extra positional args to the script', async () => {
        const r = await runCli(cliEntry, ['run', 'echo', 'one', 'two', 'with space'], { cwd: wsDir });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /argv=one,two,with space/);
    });

    it('augments PATH with the monorepo-root node_modules/.bin', async () => {
        const r = await runCli(cliEntry, ['run', 'viabin'], { cwd: wsDir });
        assert.equal(r.status, 0, `viabin failed: ${r.stderr}`);
        assert.match(r.stdout, /fake-bin-from-root/);
    });

    it('errors clearly when the script does not exist', async () => {
        const r = await runCli(cliEntry, ['run', 'no-such-script'], { cwd: wsDir });
        assert.notEqual(r.status, 0);
        const combined = r.stdout + r.stderr;
        assert.match(combined, /no script "no-such-script"/);
        // Available-scripts hint should list at least one known script.
        assert.match(combined, /available:.*hello/);
    });

    it('errors clearly when no package.json is present', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'gjsify-e2e-run-empty-'));
        try {
            const r = await runCli(cliEntry, ['run', 'whatever'], { cwd: empty });
            assert.notEqual(r.status, 0);
            assert.match(r.stdout + r.stderr, /no package\.json/i);
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });

    it('propagates a non-zero exit code from the script', async () => {
        // Mutating the workspace pkg.json is fine for the lifetime of this
        // suite — `after` will rm the whole tree.
        const { readFileSync } = await import('node:fs');
        const pkgPath = join(wsDir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.scripts.fail = `node -e "process.exit(7)"`;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        const r = await runCli(cliEntry, ['run', 'fail'], { cwd: wsDir });
        assert.notEqual(r.status, 0, 'expected non-zero exit');
        assert.match(r.stderr, /exited with code 7/);
    });

    it('treats targets with a path-like prefix as files (file mode)', async () => {
        // We can't actually run gjs in this env, but we can verify the dispatch:
        // a path-prefixed target goes to runGjsBundle, which surfaces a
        // recognisable error from gjs/spawn when the file does not exist.
        const r = await runCli(cliEntry, ['run', './does-not-exist.js'], { cwd: wsDir });
        assert.notEqual(r.status, 0);
        // The script-mode "no script" hint must NOT appear — we are in file mode.
        assert.doesNotMatch(r.stdout + r.stderr, /no script "/);
    });

    it('treats targets with a JS extension as files (file mode)', async () => {
        const r = await runCli(cliEntry, ['run', 'phantom.mjs'], { cwd: wsDir });
        assert.notEqual(r.status, 0);
        assert.doesNotMatch(r.stdout + r.stderr, /no script "/);
    });

    // Regression (double-execution bug): under GJS, a script that is a single
    // `gjsify <subcommand>` takes the in-process fast path (dispatch via runCli,
    // no spawn). A missing `return` after that path's `process.exit()` — which
    // does NOT halt synchronously while the GLib main loop is armed — let
    // execution fall through to the shell-spawn fallback, running the command a
    // SECOND time. Assert single execution. GJS-only (the fast path is gated on
    // `isGjs()`); skipped when `gjs` isn't installed.
    it(
        'does not double-execute an in-process gjsify subcommand script (GJS)',
        { skip: hasGjs() ? false : 'gjs not on PATH' },
        async () => {
            const bundle = new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url).pathname;
            const pkgPath = join(wsDir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            // `gjsify --version` is a single gjsify subcommand → in-process path.
            pkg.scripts.ver = 'gjsify --version';
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

            const r = await runGjs(bundle, ['run', 'ver'], { cwd: wsDir });
            assert.equal(r.status, 0, `run ver failed: ${r.stderr}\n${r.stdout}`);
            // Each execution prints the version on its own line; count them.
            const versionLines = (r.stdout.match(/^\d+\.\d+\.\d+/gm) || []).length;
            assert.equal(
                versionLines,
                1,
                `version printed ${versionLines}× (expected exactly 1 — double-execution regression):\n${r.stdout}`,
            );
        },
    );

    // Regression: a `test:gjs`-shaped script — `gjsify run <bundle>` — must
    // propagate the bundle's non-zero exit through the in-process fast path.
    // runGjsBundle's failure branch used a deferred `process.exit(1)` that the
    // following `exitOnSuccess` `process.exit(0)` overrode (and it never set
    // `process.exitCode`), so `gjsify run <script>` returned 0 on failure —
    // silently masking a failing `test:gjs` in the `test` chain (and, via
    // `gjsify foreach test`, in CI). GJS-only (in-process dispatch is gated on
    // `isGjs()`); skipped when `gjs` isn't installed.
    it(
        'propagates a non-zero gjs bundle exit through an in-process run script (GJS)',
        { skip: hasGjs() ? false : 'gjs not on PATH' },
        async () => {
            const bundle = new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url).pathname;
            writeFileSync(join(wsDir, 'fail-bundle.js'), 'imports.system.exit(3);\n');
            const pkgPath = join(wsDir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            // Single `gjsify <subcommand>` → in-process fast path; a `.js`
            // target → file mode → runGjsBundle.
            pkg.scripts.gjsfail = 'gjsify run fail-bundle.js';
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

            const r = await runGjs(bundle, ['run', 'gjsfail'], { cwd: wsDir });
            assert.notEqual(r.status, 0, `expected non-zero exit, got 0:\n${r.stdout}\n${r.stderr}`);
        },
    );

    // Regression, sibling of the case above and the one that actually shipped
    // damage: when the in-process dispatched subcommand THROWS, the catch used
    // a BARE `process.exit(1)`. Under GJS that is deferred and RETURNS, so
    // execution fell through to the trailing exit-code line, which recomputed
    // the code and won — `gjsify run <script>` reported 0 for a command that
    // had just failed. Everything chaining on it got a false green: every
    // `a && b` build script, CI, and `gjsify onboard`, which published a
    // package whose build had failed and then reported "0 failed".
    //
    // `gjsify build` on a missing entry throws in every environment (either
    // "no usable bundler engine under GJS" on a workspace whose
    // @gjsify/rolldown-native facade is unbuilt, or an unresolved-entry error),
    // so the assertion is on the EXIT CODE, not on a particular message.
    // GJS-only (the fast path is gated on `isGjs()`).
    it(
        'propagates a THROWING in-process gjsify subcommand through run (GJS)',
        { skip: hasGjs() ? false : 'gjs not on PATH' },
        async () => {
            const bundle = new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url).pathname;
            const pkgPath = join(wsDir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            // Single `gjsify <subcommand>` → in-process fast path.
            pkg.scripts.throwfail = 'gjsify build ./definitely-missing-entry.ts';
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

            const r = await runGjs(bundle, ['run', 'throwfail'], { cwd: wsDir });
            assert.notEqual(r.status, 0, `expected non-zero exit, got 0:\n${r.stdout}\n${r.stderr}`);
        },
    );

    // `-w <name>` / `--workspace <name>` (npm/yarn parity): run the target as a
    // script in the named workspace's directory. Resolves by package name AND
    // by workspace-relative path (so both `-w @test/app` and `-w packages/app`
    // work, matching npm).
    it('runs a script in a named workspace via -w (npm/yarn parity)', async () => {
        const byName = await runCli(cliEntry, ['run', 'hello', '-w', '@test/app'], { cwd: root });
        assert.equal(byName.status, 0, `by-name failed: ${byName.stderr}`);
        assert.match(byName.stdout, /hello-from-script/);

        const byPath = await runCli(cliEntry, ['run', 'hello', '--workspace', 'packages/app'], { cwd: root });
        assert.equal(byPath.status, 0, `by-path failed: ${byPath.stderr}`);
        assert.match(byPath.stdout, /hello-from-script/);
    });

    it('errors clearly for an unknown -w workspace', async () => {
        const r = await runCli(cliEntry, ['run', 'hello', '-w', 'does-not-exist'], { cwd: root });
        assert.notEqual(r.status, 0);
        assert.match(r.stdout + r.stderr, /no workspace "does-not-exist"/);
    });

    // Regression (core-dump on a missing script under GJS): `runScript`'s error
    // branches called a BARE `process.exit(1)`, which does NOT halt
    // synchronously under GJS — execution fell through to
    // `tokenizeSimpleCommand(undefined)` → `cannot access property "length"` →
    // the throw raced the already-scheduled exit into a second `system.exit` →
    // `m_should_exit assertion failed` → SIGABRT core dump. Assert a clean
    // exit-1 with the helpful message instead. GJS-only (the fall-through is
    // gated on the `isGjs()` in-process path); skipped without `gjs`.
    it(
        'exits cleanly (no core dump) when the script is missing (GJS)',
        { skip: hasGjs() ? false : 'gjs not on PATH' },
        async () => {
            const bundle = new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url).pathname;
            const r = await runGjs(bundle, ['run', 'no-such-script-xyz'], { cwd: wsDir });
            assert.equal(
                r.status,
                1,
                `expected a clean exit 1; got status=${r.status} (a crash yields null/134):\n${r.stderr}`,
            );
            assert.doesNotMatch(r.stderr, /m_should_exit|core dumped|access property "length"/);
            assert.match(r.stdout + r.stderr, /no script "no-such-script-xyz"/);
        },
    );
});
