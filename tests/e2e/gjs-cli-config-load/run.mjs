// E2E: loading a `gjsify.config.js` under the GJS-bundled CLI (`cli.gjs.mjs`).
//
// The GJS-bundled CLI must work Node-free — including loading a config that
// imports `node:` builtins (the common `readFileSync(resolve(dirname(
// fileURLToPath(import.meta.url)), 'package.json'))` pattern for a version). It
// used to crash with an opaque `a.shift is not a function`: cosmiconfig's
// `import()` failed on GJS (`Unsupported URI scheme for importing: node`) and
// fell back to a sync CJS require whose bundle shim crashed.
//
// The fix (packages/infra/cli/src/config.ts + actions/build.ts): a GJS-only
// cosmiconfig loader that, when the raw `import()` fails on module resolution,
// BUNDLES the config for GJS (`--app gjs`: `node:`→`@gjsify`, `gi://` external,
// `import.meta.url` rebound to the real config path) and imports THAT — so the
// config truly LOADS and runs, not just fails cleanly.
//
// This test exercises the COMMITTED `dist/cli.gjs.mjs` under `gjs` (and the Node
// CLI) and asserts the config's `define` — whose value the config reads from
// `package.json` via `node:fs` — actually lands in the build output, i.e. the
// config truly loaded. It was the coverage gap: every prior config e2e ran via
// the Node CLI, so nothing exercised a config through the GJS bundle.
//
// SKIP (no false failures off a capable host): non-Linux, no `gjs`, no committed
// CLI bundle / Node CLI lib, no `@gjsify/rolldown-native` prebuild for the arch,
// or the workspace `node_modules` (with `@gjsify`/`rolldown`) isn't installed —
// the config-bundle resolves `node:`→`@gjsify` and the Node build needs
// `rolldown`, both symlinked in from the workspace.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const NODE_CLI = join(REPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const WS_MODULES = join(REPO_ROOT, 'node_modules');

// Symlinked into each fixture so the config's `node:`→`@gjsify` bundle resolves
// (`gi://` is externalized; `@girs` linked for safety) and the Node engine
// (`rolldown`) is present — no full install needed.
const LINK_PKGS = ['@gjsify', '@girs', 'rolldown', '@rolldown'];

function archDir() {
    if (process.arch === 'x64') return 'linux-x64';
    if (process.arch === 'arm64') return 'linux-arm64';
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
    !existsSync(NODE_CLI) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib')) ||
    !existsSync(join(WS_MODULES, '@gjsify')) ||
    !existsSync(join(WS_MODULES, 'rolldown'));

// A config that reads its own `package.json` version via `node:fs` +
// `import.meta.url` and `define`s it — the exact pattern that crashed the GJS CLI.
const NODE_CONFIG = [
    "import { readFileSync } from 'node:fs'",
    "import { fileURLToPath } from 'node:url'",
    "import { dirname, resolve } from 'node:path'",
    'const d = dirname(fileURLToPath(import.meta.url))',
    "const pkg = JSON.parse(readFileSync(resolve(d, 'package.json'), 'utf-8'))",
    "export default { bundler: { transform: { define: { 'process.env.V': JSON.stringify(pkg.version) } } } }",
    '',
].join('\n');

// A plain-value config (no `node:`/npm imports) — imports fine under GJS, no bundling.
const PLAIN_CONFIG =
    "export default { bundler: { transform: { define: { 'process.env.V': JSON.stringify('plain-value-marker') } } } }\n";

describe('gjsify.config.js under the GJS CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    function makeProject(name, version, configBody) {
        const dir = join(tmpDir, name);
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'node_modules'), { recursive: true });
        for (const p of LINK_PKGS) {
            const src = join(WS_MODULES, p);
            if (existsSync(src)) symlinkSync(src, join(dir, 'node_modules', p), 'dir');
        }
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version, type: 'module', private: true }, null, 2) + '\n',
        );
        // References the config-provided define so its value lands in the output.
        writeFileSync(join(dir, 'src', 'index.ts'), 'console.log(process.env.V);\n');
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
    const nodeEnv = () => ({ ...process.env, HOME: tmpDir, XDG_CACHE_HOME: join(tmpDir, '.cache') });

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gjs-config-'));
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('LOADS a node:-importing config under the committed GJS bundle (not just no-crash)', () => {
        const dir = makeProject('gjs-node-config', '9.9.9-gjs-loaded', NODE_CONFIG);
        const r = spawnSync(
            'gjs',
            ['-m', CLI_BUNDLE, 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs', '--no-minify'],
            { cwd: dir, encoding: 'utf-8', timeout: 4 * 60 * 1000, env: gjsEnv() },
        );
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.doesNotMatch(log, /a\.shift is not a function/, 'the opaque a.shift crash must be gone');
        assert.equal(r.status, 0, `the node:-importing config must build under the GJS bundle. Output:\n${log}`);
        // The version was read from package.json via node:fs + import.meta.url
        // INSIDE the config; its presence in the output proves the config truly
        // loaded + ran (not silently ignored / defaulted).
        const out = readFileSync(join(dir, 'out.gjs.mjs'), 'utf-8');
        assert.match(out, /9\.9\.9-gjs-loaded/, 'the config define (read via node:fs) must land in the GJS-bundle output');
    });

    it('the same node:-importing config also loads on the Node CLI', () => {
        const dir = makeProject('node-node-config', '9.9.9-node-loaded', NODE_CONFIG);
        execFileSync(
            'node',
            [NODE_CLI, 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs', '--no-minify'],
            { cwd: dir, stdio: 'pipe', timeout: 4 * 60 * 1000, env: nodeEnv() },
        );
        const out = readFileSync(join(dir, 'out.gjs.mjs'), 'utf-8');
        assert.match(out, /9\.9\.9-node-loaded/, 'the config define must land in the output on the Node CLI too');
    });

    it('a plain-value config still builds under the GJS bundle (no bundling needed)', () => {
        const dir = makeProject('gjs-plain-config', '0.0.0', PLAIN_CONFIG);
        execFileSync(
            'gjs',
            ['-m', CLI_BUNDLE, 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'out.gjs.mjs', '--no-minify'],
            { cwd: dir, stdio: 'pipe', timeout: 4 * 60 * 1000, env: gjsEnv() },
        );
        const out = readFileSync(join(dir, 'out.gjs.mjs'), 'utf-8');
        assert.match(out, /plain-value-marker/, 'the plain-config define must land in the GJS-bundle output');
    });
});
