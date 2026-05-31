// E2E test for @gjsify/cli build under Yarn PnP — the external-consumer
// scenario. Mirrors `cli-only/` (npm + node-modules linker) but installs the
// CLI via Yarn 4 with `nodeLinker: pnp`. The CLI must resolve transitive
// @gjsify/* polyfills (fs, path, child_process, ...) through its own
// dependency graph (@gjsify/node-polyfills + @gjsify/web-polyfills) without
// each one being a direct devDep of the consumer.
//
// This is the regression test for the silent-relay bug fixed in v0.3.6:
// `await import("pnpapi")` returns the ESM module namespace, so
// `pnpApi.resolveRequest` was undefined and every relay attempt threw a
// TypeError that the surrounding `catch {}` swallowed. The fix unwraps
// `.default` before use; this test would have caught the regression.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProjectYarnPnp, hasCommand } from '../helpers.mjs';

/** Returns true when `gjs` is installed AND can run a one-liner. */
function gjsRunnable() {
    if (!hasCommand('gjs')) return false;
    try {
        execFileSync('gjs', ['-c', '"ok"'], { stdio: 'pipe', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

describe('CLI-only E2E under Yarn PnP (external-consumer scenario)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;
    // Yarn-PnP IS a stated gjsify support target — silent-skipping the PnP suite
    // when yarn is missing was hiding real coverage gaps for PnP consumers (e.g.
    // ts-for-gir, easy6502 hit PnP-specific bugs the silent-skip never caught).
    // Hard-require yarn (>= 4 via corepack `packageManager: 'yarn@4.x.y'`).
    before(() => {
        assert.ok(
            hasCommand('yarn'),
            '`yarn` is required for the PnP e2e suite (gjsify supports Yarn-PnP as a first-class consumer scenario per the PnP-aware createRequire in @gjsify/module + the cli-only-pnp / pnp-zip-static-reads e2e suites). Install via the system package manager or `corepack enable` (Node 24 ships corepack which auto-fetches yarn@4 from the `packageManager` field).',
        );

        const env = createTestEnvironment('gjsify-e2e-cli-only-pnp-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        // Minimal external consumer: ONLY @gjsify/cli + @gjsify/empty as devDeps.
        // No granular @gjsify/fs / @gjsify/path / @gjsify/node-globals etc. —
        // the relay must reach those through @gjsify/cli's own deps.
        projectDir = join(tmpDir, 'pnp-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProjectYarnPnp(
            projectDir,
            {
                name: 'test-cli-only-pnp',
                version: '0.1.0',
                type: 'module',
                private: true,
                devDependencies: {
                    '@gjsify/cli': '^0.3.0',
                    '@gjsify/empty': '^0.3.0',
                },
            },
            tarballsDir,
            tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('builds a script importing node:fs (relay → @gjsify/fs)', () => {
        writeFileSync(
            join(projectDir, 'src', 'with-fs.ts'),
            "import { existsSync } from 'node:fs';\nconsole.log(existsSync('/tmp'));\n",
        );
        execFileSync('yarn', ['gjsify', 'build', 'src/with-fs.ts', '--app', 'gjs', '--outfile', 'dist/with-fs.js'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 2 * 60 * 1000,
        });
        assert.ok(
            existsSync(join(projectDir, 'dist', 'with-fs.js')),
            'dist/with-fs.js missing — relay failed to resolve @gjsify/fs',
        );
    });

    it('builds a script importing node:path (relay → @gjsify/path)', () => {
        writeFileSync(
            join(projectDir, 'src', 'with-path.ts'),
            "import { join } from 'node:path';\nconsole.log(join('a', 'b'));\n",
        );
        execFileSync(
            'yarn',
            ['gjsify', 'build', 'src/with-path.ts', '--app', 'gjs', '--outfile', 'dist/with-path.js'],
            {
                cwd: projectDir,
                stdio: 'pipe',
                timeout: 2 * 60 * 1000,
            },
        );
        assert.ok(
            existsSync(join(projectDir, 'dist', 'with-path.js')),
            'dist/with-path.js missing — relay failed to resolve @gjsify/path',
        );
    });

    it(
        'builds a script importing node:child_process (relay → @gjsify/child_process)',
        () => {
            writeFileSync(
                join(projectDir, 'src', 'with-cp.ts'),
                "import { spawn } from 'node:child_process';\nconsole.log(typeof spawn);\n",
            );
            execFileSync(
                'yarn',
                ['gjsify', 'build', 'src/with-cp.ts', '--app', 'gjs', '--outfile', 'dist/with-cp.js'],
                {
                    cwd: projectDir,
                    stdio: 'pipe',
                    timeout: 2 * 60 * 1000,
                },
            );
            assert.ok(
                existsSync(join(projectDir, 'dist', 'with-cp.js')),
                'dist/with-cp.js missing — relay failed to resolve @gjsify/child_process',
            );
        },
    );

    it(
        'rewriter injects __filename for CJS code in node_modules under PnP namespace',
        () => {
            assert.ok(
                gjsRunnable(),
                'gjs is required + must run a one-liner (`gjs -c \'"ok"\'`) — see the before() yarn check for context on why the PnP suite hard-requires the GNOME toolchain.',
            );
            // Regression: F5 — esbuild stops at the first matching `onLoad`, so the
            // gjsify rewriter must run from INSIDE @yarnpkg/esbuild-plugin-pnp's onLoad
            // (composed via @gjsify/resolve-npm/pnp-relay), not as a separate
            // registration. Without that composition, CJS modules in node_modules
            // (e.g. typescript.js — `swapCase(__filename)`) crash at module-load
            // with `ReferenceError: __filename is not defined` when GJS executes the
            // bundle.
            //
            // We don't bundle real typescript here (heavy + brittle to npm versions);
            // a minimal CJS module that uses `__filename` reproduces the issue.
            mkdirSync(join(projectDir, 'fixtures'), { recursive: true });

            // CJS module under a `node_modules`-named directory so the rewriter's
            // `args.path.includes('node_modules')` guard fires. Plain CommonJS, no
            // ESM markers — the rewriter must inject `var __filename = "..."`
            // before this code can even parse-and-run.
            const fakeNm = join(projectDir, 'fixtures', 'node_modules', 'fake-cjs');
            mkdirSync(fakeNm, { recursive: true });
            writeFileSync(
                join(fakeNm, 'package.json'),
                JSON.stringify({ name: 'fake-cjs', version: '0.0.0', main: 'index.cjs' }) + '\n',
            );
            writeFileSync(join(fakeNm, 'index.cjs'), 'module.exports = { fname: __filename, dname: __dirname };\n');

            writeFileSync(
                join(projectDir, 'src', 'with-filename.ts'),
                [
                    '// @ts-expect-error — fake-cjs has no types',
                    "import fake from '../fixtures/node_modules/fake-cjs/index.cjs';",
                    "if (typeof fake.fname !== 'string') throw new Error('expected fname to be a string');",
                    "console.log('ok:' + fake.fname.endsWith('index.cjs'));",
                    '',
                ].join('\n'),
            );

            execFileSync(
                'yarn',
                ['gjsify', 'build', 'src/with-filename.ts', '--app', 'gjs', '--outfile', 'dist/with-filename.js'],
                { cwd: projectDir, stdio: 'pipe', timeout: 2 * 60 * 1000 },
            );

            const out = execFileSync('gjs', ['-m', join(projectDir, 'dist', 'with-filename.js')], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 30 * 1000,
            });
            assert.match(out, /ok:true/, `expected "ok:true" from bundle, got: ${out}`);
        },
    );

    it(
        'builds a script combining fs + path + events (relay handles multiple polyfills in one bundle)',
        () => {
            // Single bundle exercising several polyfills at once — verifies the relay
            // is reused across calls (one onResolve hook lifetime per build invocation).
            writeFileSync(
                join(projectDir, 'src', 'multi.ts'),
                [
                    "import { existsSync } from 'node:fs';",
                    "import { join } from 'node:path';",
                    "import { EventEmitter } from 'node:events';",
                    'const ee = new EventEmitter();',
                    "ee.emit('x', existsSync(join('/tmp', 'foo')));",
                    '',
                ].join('\n'),
            );
            execFileSync('yarn', ['gjsify', 'build', 'src/multi.ts', '--app', 'gjs', '--outfile', 'dist/multi.js'], {
                cwd: projectDir,
                stdio: 'pipe',
                timeout: 2 * 60 * 1000,
            });
            assert.ok(existsSync(join(projectDir, 'dist', 'multi.js')), 'dist/multi.js missing');
        },
    );
});
