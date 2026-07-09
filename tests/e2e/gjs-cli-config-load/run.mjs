// E2E: loading a `gjsify.config.js` under the GJS-bundled CLI (`cli.gjs.mjs`).
//
// Regression guard for the `a.shift is not a function` crash. cosmiconfig's
// default `.js`/`.mjs` loader does `await import(href)` then, on failure, falls
// back to a synchronous CJS `require` — whose bundled require-shim crashes under
// GJS with an opaque `a.shift is not a function`. The real cause: a config that
// imports `node:` builtins (e.g. `node:fs` to read package.json) can't be
// imported by GJS's ESM loader (`Unsupported URI scheme for importing: node`),
// so the import throws and the broken sync fallback is taken. The Node CLI never
// hits this — its `import()` resolves `node:` natively.
//
// The fix (packages/infra/cli/src/config.ts) installs a GJS-only cosmiconfig
// loader that keeps the ESM-import path but replaces the crashing require
// fallback with an actionable error. This test exercises the COMMITTED
// `dist/cli.gjs.mjs` under `gjs` and asserts:
//   1. a `node:`-importing config → clear error, NO `a.shift`.
//   2. a plain-value config → still builds (no regression).
//
// The bug was invisible because nothing exercised a `gjsify.config.js` through
// the GJS bundle — every config e2e ran via the Node CLI (`npx gjsify`).
//
// SKIP conditions (no false failures off a capable host): non-Linux, no `gjs`
// on PATH, no committed CLI bundle, or no `@gjsify/rolldown-native` prebuild for
// the running arch (the bundler engine the plain-config build needs).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

function archDir() {
    if (process.arch === 'x64') return 'linux-x86_64';
    if (process.arch === 'arm64') return 'linux-aarch64';
    return null;
}

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const arch = archDir();
const PREBUILD = arch ? join(REPO_ROOT, 'packages', 'infra', 'rolldown-native', 'prebuilds', arch) : null;

const SKIP =
    process.platform !== 'linux' ||
    !arch ||
    !hasGjs() ||
    !existsSync(CLI_BUNDLE) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib'));

describe('gjsify.config.js under the GJS CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    /** Scaffold a project with a given config file body; returns its dir. */
    function makeProject(name, configBody) {
        const dir = join(tmpDir, name);
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '0.0.0', type: 'module', private: true }, null, 2) + '\n',
        );
        writeFileSync(join(dir, 'src', 'index.ts'), "export const x = 1;\nconsole.log(x);\n");
        writeFileSync(join(dir, 'gjsify.config.js'), configBody);
        return dir;
    }

    const gjsEnv = () => ({
        ...process.env,
        HOME: tmpDir,
        XDG_CACHE_HOME: join(tmpDir, '.cache'),
        GI_TYPELIB_PATH: PREBUILD,
        LD_LIBRARY_PATH: PREBUILD,
    });

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gjs-config-'));
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('a node:-importing config fails with an actionable error, NOT `a.shift`', () => {
        // Mirrors the real-world config (reads package.json version via node:fs).
        const dir = makeProject(
            'node-config',
            [
                "import { readFileSync } from 'node:fs'",
                "import { dirname, resolve } from 'node:path'",
                "import { fileURLToPath } from 'node:url'",
                'const __dirname = dirname(fileURLToPath(import.meta.url))',
                "const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))",
                'export default {',
                "  bundler: { transform: { define: { 'process.env.V': JSON.stringify(pkg.version) } } },",
                '}',
                '',
            ].join('\n'),
        );

        const r = spawnSync('gjs', ['-m', CLI_BUNDLE, 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs'], {
            cwd: dir,
            encoding: 'utf-8',
            timeout: 4 * 60 * 1000,
            env: gjsEnv(),
        });

        const stderr = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.notEqual(r.status, 0, 'a node:-importing config must not build under the GJS CLI');
        assert.doesNotMatch(stderr, /a\.shift is not a function/, 'the opaque a.shift crash must be gone');
        assert.match(stderr, /cannot load config file/, 'the actionable config-load error must be shown');
        assert.match(stderr, /npx gjsify|under Node/, 'the error must point at the Node CLI workaround');
    });

    it('a plain-value config still builds under the GJS CLI', () => {
        const dir = makeProject(
            'plain-config',
            "export default { bundler: { transform: { define: { FOO: JSON.stringify('bar') } } } }\n",
        );

        execFileSync('gjs', ['-m', CLI_BUNDLE, 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs'], {
            cwd: dir,
            stdio: 'pipe',
            timeout: 4 * 60 * 1000,
            env: gjsEnv(),
        });

        assert.ok(existsSync(join(dir, 'out.gjs.mjs')), 'plain-config build produced no output');
    });
});
