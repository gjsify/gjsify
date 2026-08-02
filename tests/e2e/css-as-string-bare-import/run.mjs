// E2E: bare-`@import` CSS resolution under the GJS-bundled CLI.
//
// The `gjsify-css-as-string` plugin resolves `@import` chains with two
// backends: npm `lightningcss` `bundleAsync` (Node) and the native
// `@gjsify/lightningcss-native` bridge (GJS). The npm path passes a JS
// `resolver` so bare node_modules specifiers (`@import "@scope/pkg/x.css"` —
// the shared-CSS-package pattern every consumer monorepo uses) resolve; the
// native `bundle()` had NO resolver (a JS callback can't cross the GI/Rust
// boundary), so under the GJS CLI a bare `@import` threw `plugin
// gjsify-css-as-string threw an error` and produced NO bundle — silently
// leaving a stale one on rebuild. The fix resolves + inlines `@import`s in JS
// first (same resolver as the npm path), then runs the flattened CSS through
// the native `transform()` for GTK4 lowering.
//
// This test boots the committed `dist/cli.gjs.mjs` under `gjs` (the native
// backend — the ONLY place the bug reproduces; the Node-path `css-bundling`
// e2e already covers bare imports via npm lightningcss) and asserts:
//   1. a bare `@import` (via package.json `exports`) + a relative `@import` are
//      both inlined, and CSS nesting is flattened to GTK4-flat selectors;
//   2. an UNRESOLVABLE `@import` fails the build LOUDLY (non-zero exit, no
//      output) with an actionable `[gjsify-css-as-string]` diagnostic naming
//      the specifier — never a silent success + stale bundle.
//
// SKIP conditions (no false failures off a capable host): non-Linux, no `gjs`
// on PATH, no committed CLI bundle, or a missing prebuild typelib for either
// native engine the GJS CSS build needs (rolldown + lightningcss).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuildDir } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

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
const ROLLDOWN_PREBUILD = arch ? prebuildDir('infra', 'rolldown-native', arch) : null;
const LIGHTNINGCSS_PREBUILD = arch ? prebuildDir('infra', 'lightningcss-native', arch) : null;

const SKIP =
    process.platform !== 'linux' ||
    !arch ||
    !hasGjs() ||
    !existsSync(CLI_BUNDLE) ||
    !ROLLDOWN_PREBUILD ||
    !existsSync(join(ROLLDOWN_PREBUILD, 'GjsifyRolldown-1.0.typelib')) ||
    !LIGHTNINGCSS_PREBUILD ||
    !existsSync(join(LIGHTNINGCSS_PREBUILD, 'GjsifyLightningcss-1.0.typelib'));

// The GJS CLI needs BOTH native engines on the GI search path: rolldown-native
// (the bundler) and lightningcss-native (the CSS backend). In an isolated tmp
// project neither is in node_modules, so the runtime `detectNativePackages`
// walk can't find them — point GI_TYPELIB_PATH/LD_LIBRARY_PATH at the repo's
// prebuilds explicitly.
const GI_PATH = SKIP ? '' : `${ROLLDOWN_PREBUILD}:${LIGHTNINGCSS_PREBUILD}`;

describe('css-as-string bare @import under the GJS CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-css-bare-'));
        projectDir = join(tmpDir, 'project');

        // Bare package exposing a CSS file via its package.json `exports` — the
        // resolver must honor the exports map, not probe a file path directly.
        const pkgDir = join(projectDir, 'node_modules', '@css-bare', 'shared');
        mkdirSync(join(pkgDir, 'lib'), { recursive: true });
        writeFileSync(
            join(pkgDir, 'package.json'),
            JSON.stringify(
                { name: '@css-bare/shared', version: '0.0.1', exports: { './index.css': './lib/index.css' } },
                null,
                2,
            ) + '\n',
        );
        // `#abcdef` round-trips verbatim (no lightningcss named-color rewrite).
        writeFileSync(join(pkgDir, 'lib', 'index.css'), '.shared-banner { background: #abcdef; padding: 8px; }\n');

        // Relative import target with CSS nesting (must flatten for GTK4).
        mkdirSync(join(projectDir, 'src', 'widgets'), { recursive: true });
        writeFileSync(
            join(projectDir, 'src', 'widgets', 'button.css'),
            '.btn {\n  color: red;\n  &:hover { color: blue; }\n}\n',
        );

        // Entry mixes a BARE @import, a RELATIVE @import, and its own nesting.
        writeFileSync(
            join(projectDir, 'src', 'app.css'),
            '@import "@css-bare/shared/index.css";\n@import "./widgets/button.css";\n.local { &:hover { color: green; } }\n',
        );
        writeFileSync(join(projectDir, 'src', 'app.ts'), "import css from './app.css';\nconsole.log(css.length);\n");

        // Negative fixture: a genuinely unresolvable bare @import.
        writeFileSync(
            join(projectDir, 'src', 'bad.css'),
            '@import "@does-not-exist/missing.css";\n.x { color: red; }\n',
        );
        writeFileSync(join(projectDir, 'src', 'bad.ts'), "import css from './bad.css';\nconsole.log(css.length);\n");

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'css-as-string-bare-import',
                    version: '0.0.0',
                    type: 'module',
                    private: true,
                    gjsify: { bundler: { output: { file: 'dist/app.js', minify: false } } },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    function runBuild(entry, outfile) {
        return execFileSync('gjs', ['-m', CLI_BUNDLE, 'build', '--app', 'gjs', entry, '--outfile', outfile], {
            cwd: projectDir,
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 4 * 60 * 1000,
            env: {
                ...process.env,
                HOME: tmpDir,
                XDG_CACHE_HOME: join(tmpDir, '.cache'),
                GI_TYPELIB_PATH: GI_PATH,
                LD_LIBRARY_PATH: GI_PATH,
            },
        });
    }

    it('inlines a bare-package @import (via exports) + a relative @import and flattens nesting', () => {
        runBuild('src/app.ts', 'dist/app.js');

        const outPath = join(projectDir, 'dist', 'app.js');
        assert.ok(existsSync(outPath), 'dist/app.js missing — the CSS build failed');
        const out = readFileSync(outPath, 'utf-8');

        assert.doesNotMatch(out, /@import/, 'no @import may survive — all must be resolved + inlined');
        assert.match(out, /\.shared-banner/, 'bare @import "@css-bare/shared/index.css" must be inlined');
        assert.match(out, /#abcdef|#ABCDEF/, 'a concrete property from the bare-package CSS must survive');
        assert.match(out, /\.btn:hover/, 'relative @import must be inlined AND its nesting flattened for GTK4');
        assert.match(out, /\.local:hover/, "the entry file's own nesting must flatten to `.local:hover`");
    });

    it('fails the build LOUDLY on an unresolvable @import (no silent stale bundle)', () => {
        let threw = false;
        let stderr = '';
        try {
            runBuild('src/bad.ts', 'dist/bad.js');
        } catch (err) {
            threw = true;
            stderr = `${err.stderr ?? ''}${err.stdout ?? ''}`;
        }
        assert.ok(threw, 'build must exit non-zero on an unresolvable @import');
        assert.ok(!existsSync(join(projectDir, 'dist', 'bad.js')), 'no bundle may be produced when the @import fails');
        assert.match(
            stderr,
            /\[gjsify-css-as-string\]/,
            'the failure must carry an actionable css-as-string diagnostic (not an opaque "plugin threw an error")',
        );
        assert.match(stderr, /@does-not-exist\/missing\.css/, 'the diagnostic must name the unresolvable specifier');
    });
});
