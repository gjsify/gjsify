// E2E: `bundler.plugins` (by-name) under the GJS-bundled CLI.
//
// GJS's native ESM loader does NOT follow `package.json#exports` subpath maps
// for bare specifiers, so a plugin whose source imports an internal subpath
// (the shape `@mdx-js/rollup` → `@mdx-js/mdx/internal-…` has) throws
// `Module not found` when imported directly under GJS. The CLI works around
// this by bundling the plugin to a single self-contained ESM first (Rolldown
// resolves the exports map at bundle time) and importing THAT.
//
// This test runs the committed `dist/cli.gjs.mjs` under `gjs` against a project
// whose plugin imports an exports-subpath fixture, and asserts the build
// succeeds + the plugin's transform ran. It is the GJS-side counterpart to the
// Node-path `plugins-by-name` e2e.
//
// SKIP conditions (no false failures off a capable host): non-Linux, no `gjs`
// on PATH, no committed CLI bundle, or no `@gjsify/rolldown-native` prebuild
// for the running arch (the bundler engine the GJS CLI needs).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
    // A working `gjs --version` always exits 0; anything else (ENOENT, signal,
    // nonzero) means "no usable gjs".
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const arch = archDir();
const PREBUILD = arch
    ? join(REPO_ROOT, 'packages', 'infra', 'rolldown-native', 'prebuilds', arch)
    : null;

const SKIP =
    process.platform !== 'linux' ||
    !arch ||
    !hasGjs() ||
    !existsSync(CLI_BUNDLE) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib'));

describe('plugins-by-name under the GJS CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-plugins-gjs-'));
        projectDir = join(tmpDir, 'project');

        // Fixture sub-package with an exports-map subpath — the case GJS's
        // native loader can't resolve via a bare specifier.
        const subDir = join(projectDir, 'node_modules', '@fixture', 'sub');
        mkdirSync(subDir, { recursive: true });
        writeFileSync(
            join(subDir, 'package.json'),
            JSON.stringify(
                { name: '@fixture/sub', version: '1.0.0', type: 'module', exports: { './deep': './deep.js' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(subDir, 'deep.js'), "export const MARKER = 'marker-from-exports-subpath';\n");

        // Plugin imports the BARE exports-subpath specifier. Direct GJS import
        // of this plugin would throw `Module not found: @fixture/sub/deep`.
        writeFileSync(
            join(projectDir, 'plugin.mjs'),
            [
                "import { MARKER } from '@fixture/sub/deep';",
                'export default function fixturePlugin() {',
                '  return {',
                "    name: 'fixture-exports-subpath',",
                '    transform: {',
                '      filter: { id: /\\.[mc]?[tj]sx?$/ },',
                '      handler(code) {',
                "        if (!code.includes('__INJECTED__')) return null;",
                '        return { code: code.replace(/__INJECTED__/g, JSON.stringify(MARKER)), map: null };',
                '      },',
                '    },',
                '  };',
                '}',
                '',
            ].join('\n'),
        );

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'plugins-by-name-gjs',
                    version: '0.0.0',
                    type: 'module',
                    private: true,
                    gjsify: {
                        bundler: {
                            output: { file: 'dist/app.js', minify: false },
                            plugins: [{ name: './plugin.mjs' }],
                        },
                    },
                },
                null,
                2,
            ) + '\n',
        );

        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(join(projectDir, 'src', 'app.ts'), 'console.log(__INJECTED__);\n');
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('bundles an exports-subpath plugin and runs its transform under GJS', () => {
        execFileSync('gjs', ['-m', CLI_BUNDLE, 'build', 'src/app.ts'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 4 * 60 * 1000,
            // Isolate HOME/XDG_CACHE_HOME into the per-test tmp dir so the run
            // is parallel-safe even if a future build path writes to a global
            // cache (today the plugin cache + register-inject are cwd-anchored).
            env: {
                ...process.env,
                HOME: tmpDir,
                XDG_CACHE_HOME: join(tmpDir, '.cache'),
                GI_TYPELIB_PATH: PREBUILD,
                LD_LIBRARY_PATH: PREBUILD,
            },
        });

        const outPath = join(projectDir, 'dist', 'app.js');
        assert.ok(existsSync(outPath), 'dist/app.js missing');
        const out = readFileSync(outPath, 'utf-8');
        assert.match(
            out,
            /"marker-from-exports-subpath"/,
            'plugin transform did not run — the exports-subpath plugin failed to load under GJS',
        );

        // The plugin was bundled to a cached self-contained ESM, not imported
        // directly.
        const cacheDir = join(projectDir, 'node_modules', '.cache', 'gjsify', 'plugins');
        assert.ok(existsSync(cacheDir), 'plugin GJS-bundle cache dir missing');
        const cached = readdirSync(cacheDir).filter((f) => f.endsWith('.mjs'));
        assert.ok(cached.length >= 1, 'no cached plugin bundle written');
    });
});
