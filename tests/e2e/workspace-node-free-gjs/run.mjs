// E2E: node-free multi-package orchestration under the GJS CLI.
//
// `gjsify workspace --with-dependencies` (and compound package scripts like
// `gjsify run a && gjsify run b`) must run WITHOUT Node — the Flatpak sandbox
// has none. Two mechanisms make that work, both exercised here:
//   1. `detectPackageManager()` returns `gjsify` under GJS, so the per-package
//      runner spawns `gjsify run` (not `npm run`).
//   2. `ensureGjsifyShimOnPath()` puts a GJS-runnable `gjsify` on PATH (ahead
//      of `node_modules/.bin/gjsify`, the Node bin) so compound scripts resolve
//      `gjsify` to GJS.
//
// The test runs the committed `dist/cli.gjs.mjs` under `gjs -m` against a tiny
// two-package workspace, with FAKE `node`/`npm` that exit 127 on PATH — so any
// fallback to Node fails loudly. It asserts the build completes and the FAKEs
// were never called.
//
// SKIP when off a capable host (non-Linux / no gjs / no committed bundle).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const SKIP = process.platform !== 'linux' || !hasGjs() || !existsSync(CLI_BUNDLE);

describe('node-free workspace orchestration under the GJS CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let fakeBinDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-nodefree-ws-'));
        projectDir = join(tmpDir, 'ws');

        // Root workspace.
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'root', private: true, type: 'module', workspaces: ['packages/*'] }, null, 2) + '\n',
        );

        // pkg-b: a COMPOUND build script that calls `gjsify run` twice — this is
        // what shells out and must resolve `gjsify` to the GJS shim, not Node.
        const b = join(projectDir, 'packages', 'b');
        mkdirSync(b, { recursive: true });
        writeFileSync(
            join(b, 'package.json'),
            JSON.stringify(
                {
                    name: '@t/b',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    scripts: {
                        'mk:x': 'sh -c "echo x > x.marker"',
                        'mk:y': 'sh -c "echo y > y.marker"',
                        build: 'gjsify run mk:x && gjsify run mk:y',
                    },
                },
                null,
                2,
            ) + '\n',
        );

        // pkg-a depends on pkg-b; its build just drops a marker.
        const a = join(projectDir, 'packages', 'a');
        mkdirSync(a, { recursive: true });
        writeFileSync(
            join(a, 'package.json'),
            JSON.stringify(
                {
                    name: '@t/a',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    dependencies: { '@t/b': 'workspace:^' },
                    scripts: { build: 'sh -c "echo a > a.marker"' },
                },
                null,
                2,
            ) + '\n',
        );

        // Wire the workspace symlink @t/b so the closure walk resolves it.
        const nmScope = join(projectDir, 'node_modules', '@t');
        mkdirSync(nmScope, { recursive: true });
        spawnSync('ln', ['-sfn', join(projectDir, 'packages', 'b'), join(nmScope, 'b')]);
        spawnSync('ln', ['-sfn', join(projectDir, 'packages', 'a'), join(nmScope, 'a')]);

        // FAKE node + npm that fail loudly — any Node fallback aborts the build.
        fakeBinDir = join(tmpDir, 'fakebin');
        mkdirSync(fakeBinDir, { recursive: true });
        for (const name of ['node', 'npm']) {
            const p = join(fakeBinDir, name);
            writeFileSync(p, `#!/bin/sh\necho "!!! FAKE ${name} CALLED: $*" >&2\nexit 127\n`, { mode: 0o755 });
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('builds the dep closure node-free (no npm/node spawn, compound gjsify resolves to GJS)', () => {
        const out = execFileSync(
            'gjs',
            ['-m', CLI_BUNDLE, 'workspace', '@t/a', 'build', '--with-dependencies'],
            {
                cwd: projectDir,
                stdio: 'pipe',
                timeout: 4 * 60 * 1000,
                encoding: 'utf-8',
                env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
            },
        );

        // The FAKE node/npm must never have been invoked.
        assert.ok(!/FAKE (node|npm) CALLED/.test(out), `Node/npm was spawned:\n${out}`);

        // pkg-b's compound `gjsify run mk:x && gjsify run mk:y` ran node-free.
        assert.ok(existsSync(join(projectDir, 'packages', 'b', 'x.marker')), 'b/x.marker missing (compound step 1)');
        assert.ok(existsSync(join(projectDir, 'packages', 'b', 'y.marker')), 'b/y.marker missing (compound step 2)');
        // pkg-a built after its dependency.
        assert.ok(existsSync(join(projectDir, 'packages', 'a', 'a.marker')), 'a/a.marker missing (dependent build)');
        assert.equal(readFileSync(join(projectDir, 'packages', 'a', 'a.marker'), 'utf-8').trim(), 'a');
    });
});
