// E2E test for `@gjsify/nativescript-vite`'s `applyVite8Fixes(config)` composer.
//
// `@gjsify/nativescript-vite` makes a `@nativescript/vite` config build under
// Vite 8 / Rolldown by fixing exactly two constructs Rolldown rejects:
//   1. `resolve.alias` array entries whose `replacement` is a FUNCTION — Vite 8 /
//      Rolldown's native alias (`ViteAlias`) cannot convert a function replacement
//      into a Rust `String`, so they are DROPPED. String/record aliases are kept;
//      the upstream `nativescript-package-resolver` resolveId plugin + the `~/` /
//      `@` string aliases already cover the same resolution.
//   2. The explicit `@rollup/plugin-commonjs` plugin (`{ name: 'commonjs' }`) —
//      crashes Rolldown with `Cannot read properties of undefined (reading
//      'currentLoadingModule')`. It is DROPPED (including from nested plugin
//      arrays); Rolldown handles CommonJS natively.
//
// This suite is CI-safe: it does NOT require `@nativescript/vite`, the
// `nativescript` CLI, or any of the NS toolchain (CI has none of them). It feeds
// `applyVite8Fixes` a SYNTHETIC Vite config that reproduces both rejected shapes
// and asserts the function aliases + the `commonjs` plugin are removed while
// string aliases + every other plugin survive — proving the composer's contract
// in isolation from a full `ns prepare` build.
//
// `applyVite8Fixes` is imported from the package's BUILT lib via a relative path
// (`../../../packages/infra/nativescript-vite/lib/index.js`). The package isn't
// symlinked into the workspace-root `node_modules`, so a bare
// `@gjsify/nativescript-vite` specifier would not resolve; the relative path
// resolves the module's own top-level `vite` + `@gjsify/vite-plugin-gjsify`
// imports from the package's own `node_modules` (neither is the NS toolchain).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Resolve the built lib relative to this file (not CWD) so the suite works no
// matter which directory `node --test` is launched from.
const LIB_URL = new URL('../../../packages/infra/nativescript-vite/lib/index.js', import.meta.url);

describe('@gjsify/nativescript-vite applyVite8Fixes E2E', () => {
    let applyVite8Fixes;

    before(async () => {
        // `node:url` import is only used to produce a readable path in the
        // assertion message below; the dynamic import takes the URL directly.
        ({ applyVite8Fixes } = await import(LIB_URL));
        assert.equal(
            typeof applyVite8Fixes,
            'function',
            `applyVite8Fixes is not exported from the built lib at ${fileURLToPath(LIB_URL)} — rebuild @gjsify/nativescript-vite`,
        );
    });

    /**
     * A synthetic `@nativescript/vite`-shaped config exercising both fixes:
     *   - `resolve.alias` ARRAY mixing function-`replacement` entries (the
     *     platform-`main` + tsconfig-wildcard + `@nativescript/core/...index`
     *     canonicalizers upstream emits) with plain string-`replacement` entries
     *     (the `~/` / `@` source aliases).
     *   - a `plugins` array with a fake `{ name: 'commonjs' }` (the explicit
     *     `@rollup/plugin-commonjs`) alongside other plugins, plus a NESTED
     *     plugins array that ALSO contains a `commonjs` plugin — to prove the
     *     strip recurses.
     */
    function makeSyntheticConfig() {
        return {
            resolve: {
                alias: [
                    // KEEP — string replacements (Rolldown accepts these).
                    { find: '~', replacement: '/abs/app/src' },
                    { find: '@', replacement: '/abs/app/src' },
                    // DROP — function replacements (Rolldown rejects these).
                    { find: /^.*$/, replacement: () => '/resolved/platform/main' },
                    { find: 'tsconfig-wildcard', replacement: (id) => id.replace('*', 'x') },
                    // KEEP — another string replacement after the functions, to
                    // prove filtering preserves order/position of survivors.
                    { find: 'fonts', replacement: '/abs/app/fonts' },
                ],
            },
            plugins: [
                { name: 'nativescript-package-resolver' }, // KEEP — the resolveId hook
                { name: 'commonjs' }, // DROP — @rollup/plugin-commonjs
                { name: 'vite:esbuild' }, // KEEP
                [
                    // Nested plugin array (Vite flattens these). The strip must
                    // recurse: drop the nested commonjs, keep the nested sibling.
                    { name: 'commonjs' }, // DROP
                    { name: 'nested-keeper' }, // KEEP
                ],
                { name: 'vite:define' }, // KEEP
            ],
            // An unrelated field that must be passed through untouched.
            build: { target: 'esnext' },
        };
    }

    /** Flatten the (possibly nested) plugins array to a list of plugin names. */
    function pluginNames(plugins) {
        const names = [];
        for (const entry of plugins) {
            if (Array.isArray(entry)) names.push(...pluginNames(entry));
            else names.push(entry.name);
        }
        return names;
    }

    it('drops function-replacement aliases, keeps string-replacement aliases', () => {
        // Pin the legacy <= 2 line explicitly: the function-alias drop is part of
        // the FULL patch set, and `@nativescript/vite@8.x` may be installed in this
        // workspace (auto-detect would then skip fix 1). The override arg makes the
        // assertion deterministic regardless of what's on disk.
        const fixed = applyVite8Fixes(makeSyntheticConfig(), 2);

        assert.ok(Array.isArray(fixed.resolve.alias), 'resolve.alias should remain an array');

        // No alias entry may have a function replacement after the fix.
        const hasFunctionAlias = fixed.resolve.alias.some((a) => typeof a.replacement === 'function');
        assert.equal(
            hasFunctionAlias,
            false,
            'a function-replacement alias survived the fix — Rolldown will reject it',
        );

        // The three string aliases survive, in original order.
        const aliasFinds = fixed.resolve.alias.map((a) => a.find);
        assert.deepEqual(
            aliasFinds,
            ['~', '@', 'fonts'],
            'string-replacement aliases were not preserved (in order) after dropping the function ones',
        );
        for (const a of fixed.resolve.alias) {
            assert.equal(
                typeof a.replacement,
                'string',
                `surviving alias "${String(a.find)}" should have a string replacement`,
            );
        }
    });

    it("removes the 'ns-typescript-check' plugin (bundler != type-checker; gjsify tsc is the gate)", () => {
        const fixed = applyVite8Fixes({
            plugins: [
                { name: 'nativescript-package-resolver' }, // KEEP
                { name: 'ns-typescript-check' }, // DROP — fails the build on the standard NS createNativeView override under TS 6+
                { name: 'vite:esbuild' }, // KEEP
                [
                    { name: 'ns-typescript-check' }, // DROP (nested)
                    { name: 'nested-keeper' }, // KEEP
                ],
            ],
        });
        const names = pluginNames(fixed.plugins);
        assert.equal(
            names.includes('ns-typescript-check'),
            false,
            "an 'ns-typescript-check' plugin survived — it would fail every ns build on the standard NS createNativeView idiom",
        );
        assert.deepEqual(
            names,
            ['nativescript-package-resolver', 'vite:esbuild', 'nested-keeper'],
            'non-ts-check plugins (incl. the nested sibling) were not preserved after the strip',
        );
    });

    it("removes every 'commonjs' plugin (incl. nested), keeps all others", () => {
        // Pin the legacy <= 2 line explicitly (the commonjs strip is part of the
        // FULL patch set, skipped on 8.x which may be installed here) — see the
        // function-alias test above.
        const fixed = applyVite8Fixes(makeSyntheticConfig(), 2);

        assert.ok(Array.isArray(fixed.plugins), 'plugins should remain an array');

        const names = pluginNames(fixed.plugins);
        assert.equal(
            names.includes('commonjs'),
            false,
            "a 'commonjs' plugin survived the fix — Rolldown will crash on currentLoadingModule",
        );

        // Every non-commonjs plugin survives, including the nested keeper.
        assert.deepEqual(
            names,
            ['nativescript-package-resolver', 'vite:esbuild', 'nested-keeper', 'vite:define'],
            'non-commonjs plugins were not preserved (top-level order + nested survivor)',
        );

        // The nested array structure is preserved (not flattened away): the
        // 4th top-level entry stays an array, now holding only the keeper.
        const nested = fixed.plugins.find((p) => Array.isArray(p));
        assert.ok(Array.isArray(nested), 'nested plugins array was flattened away — nesting must be preserved');
        assert.deepEqual(
            nested.map((p) => p.name),
            ['nested-keeper'],
            'nested plugins array should contain only the non-commonjs survivor',
        );
    });

    it('passes unrelated config fields through untouched', () => {
        const fixed = applyVite8Fixes(makeSyntheticConfig());
        assert.deepEqual(fixed.build, { target: 'esnext' }, 'unrelated config fields must be preserved as-is');
    });

    it('is a no-op on a config with neither resolve.alias nor plugins', () => {
        // The composer must tolerate a minimal config (the fixes are guarded on
        // the presence of `resolve.alias` / an array `plugins`).
        const fixed = applyVite8Fixes({ build: { target: 'esnext' } });
        assert.deepEqual(fixed, { build: { target: 'esnext' } }, 'minimal config should be returned unchanged');
    });

    it('leaves a record-form (object) resolve.alias untouched', () => {
        // The object/record alias form only ever carries string values, so it is
        // passed through verbatim — never coerced to an array or filtered.
        const recordAlias = { '~': '/abs/app/src', '@': '/abs/app/src' };
        const fixed = applyVite8Fixes({ resolve: { alias: recordAlias } });
        assert.deepEqual(
            fixed.resolve.alias,
            recordAlias,
            'record-form resolve.alias must be passed through unchanged',
        );
    });

    // ─── Conditional on the @nativescript/vite major (override arg) ──────────
    //
    // The 2nd `nsViteMajor` argument bypasses the auto-detection (which would
    // return `undefined` here — @nativescript/vite isn't installed in CI — and
    // fail-safe to the full <= 2 patch set). It exercises both branches without
    // two installs.

    it('on @nativescript/vite >= 8: skips fixes 1 & 2, still strips ns-typescript-check', () => {
        // 8.x ships native Vite-8/Rolldown support (string-only aliases, no
        // @rollup/plugin-commonjs), so the function-alias drop + commonjs strip
        // must be SKIPPED — but the bundler-shouldn't-type-check strip stays.
        const fixed = applyVite8Fixes(
            {
                resolve: {
                    alias: [
                        { find: '~', replacement: '/abs/app/src' },
                        { find: /^.*$/, replacement: () => '/resolved/platform/main' }, // would be dropped on <=2
                    ],
                },
                plugins: [
                    { name: 'nativescript-package-resolver' }, // KEEP
                    { name: 'commonjs' }, // would be dropped on <=2 — KEPT on 8.x
                    { name: 'ns-typescript-check' }, // DROP on either line
                    { name: 'vite:esbuild' }, // KEEP
                ],
            },
            8,
        );
        // Fix (1) skipped — the function-replacement alias survives untouched.
        const hasFunctionAlias = fixed.resolve.alias.some((a) => typeof a.replacement === 'function');
        assert.equal(hasFunctionAlias, true, 'on 8.x the function-replacement alias must be left in place (fix skipped)');
        // Fix (2) skipped — the commonjs plugin survives.
        const names = pluginNames(fixed.plugins);
        assert.ok(names.includes('commonjs'), 'on 8.x the commonjs plugin must be left in place (fix skipped)');
        // Fix (3) still applied — ns-typescript-check is gone.
        assert.equal(
            names.includes('ns-typescript-check'),
            false,
            "ns-typescript-check must still be stripped on 8.x — a bundler doesn't type-check",
        );
        assert.deepEqual(
            names,
            ['nativescript-package-resolver', 'commonjs', 'vite:esbuild'],
            'on 8.x only ns-typescript-check is removed; commonjs + the rest survive',
        );
    });

    it('on @nativescript/vite <= 2 (explicit major): applies the full patch set', () => {
        // Passing 2 explicitly must reproduce the auto-detect-unknown default.
        const fixed = applyVite8Fixes(makeSyntheticConfig(), 2);
        const hasFunctionAlias = fixed.resolve.alias.some((a) => typeof a.replacement === 'function');
        assert.equal(hasFunctionAlias, false, 'on <=2 every function-replacement alias must be dropped');
        const names = pluginNames(fixed.plugins);
        assert.equal(names.includes('commonjs'), false, 'on <=2 every commonjs plugin must be dropped');
        assert.deepEqual(
            names,
            ['nativescript-package-resolver', 'vite:esbuild', 'nested-keeper', 'vite:define'],
            'on <=2 the full patch set runs (function aliases + commonjs removed, others kept)',
        );
    });
});

// ── Isolated-fixture helpers (Bug 1 + Bug 2) ─────────────────────────────────
//
// Both Bug 1 (exports-gated detection) and Bug 2 (missing-peer stubs) must run the
// BUILT lib against a FIXTURE `@nativescript/vite`, not the workspace's real one.
// Because the workspace symlinks `node_modules/@gjsify/nativescript-vite` → the
// package source, a bare import of the lib from a CWD inside the repo resolves the
// workspace copy (and the workspace `@nativescript/vite`). So the fixture lives in
// the OS tmp dir, OUTSIDE the repo, with a parent whose `node_modules` symlinks the
// workspace `node_modules` (for the lib's deep deps: `vite`, `@gjsify/vite-plugin-gjsify`,
// …) and an `app/` child whose own `node_modules` shadows with a COPY of the built
// lib + the fixture `@nativescript/vite`. Running the lib (bare import) from `app/`
// then resolves the fixture `@nativescript/vite` while deep deps fall through to the
// workspace.
const WORKSPACE_NODE_MODULES = fileURLToPath(new URL('../../../node_modules', import.meta.url));
const ALL_TMP = [];

/**
 * Build an isolated fixture app and return its `app/` dir (the CWD to run in) plus
 * the path to the lib copy. `nsVite` describes the fixture `@nativescript/vite`
 * (`{ version, peerName?, eagerImport? }`); pass `null` to install NO
 * `@nativescript/vite` at all (the genuinely-absent case).
 */
function makeIsolatedFixture(nsVite) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-nsvite-'));
    ALL_TMP.push(root);
    if (nsVite) {
        // Parent node_modules → the whole workspace (deep deps + a fall-through
        // workspace `@nativescript/vite`; the fixture below shadows it in `app/`).
        symlinkSync(WORKSPACE_NODE_MODULES, join(root, 'node_modules'), 'dir');
    } else {
        // GENUINELY-ABSENT case: symlink ONLY the lib's deep deps, NOT the
        // workspace's `@nativescript/vite` — so detection sees no peer at all.
        // A symlinked package resolves its own transitive deps from its real
        // (workspace) location, so these two links suffice to load the lib.
        const parentNm = join(root, 'node_modules');
        mkdirSync(join(parentNm, '@gjsify'), { recursive: true });
        symlinkSync(join(WORKSPACE_NODE_MODULES, 'vite'), join(parentNm, 'vite'), 'dir');
        symlinkSync(
            join(WORKSPACE_NODE_MODULES, '@gjsify', 'vite-plugin-gjsify'),
            join(parentNm, '@gjsify', 'vite-plugin-gjsify'),
            'dir',
        );
    }

    const app = join(root, 'app');
    const appNm = join(app, 'node_modules');
    // Shadowing lib copy.
    const libDir = join(appNm, '@gjsify', 'nativescript-vite');
    mkdirSync(libDir, { recursive: true });
    copyFileSync(fileURLToPath(LIB_URL), join(libDir, 'index.js'));
    writeFileSync(
        join(libDir, 'package.json'),
        JSON.stringify({ name: '@gjsify/nativescript-vite', version: '0.0.0', type: 'module', exports: { '.': './index.js' } }),
    );

    if (nsVite) {
        const pkg = join(appNm, '@nativescript', 'vite');
        mkdirSync(pkg, { recursive: true });
        const pkgJson = {
            name: '@nativescript/vite',
            version: nsVite.version,
            type: 'module',
            // exports-gated: root entry only, NO ./package.json subpath (the 8.x shape).
            exports: { '.': { import: './index.js', default: './index.js' } },
        };
        if (nsVite.peerName) {
            pkgJson.peerDependencies = { [nsVite.peerName]: '*' };
            pkgJson.peerDependenciesMeta = { [nsVite.peerName]: { optional: true } };
        }
        writeFileSync(join(pkg, 'package.json'), JSON.stringify(pkgJson));
        const body = nsVite.eagerImport
            ? // Eager NAMED import of the (absent) peer at module-eval — the
              // `@vue/compiler-sfc` failure shape that breaks ESM link.
              `import { compileScript, parse } from '${nsVite.peerName}';\n` +
                  `export const typescriptConfig = () => ({ plugins: [], _peerSeen: typeof compileScript + ',' + typeof parse });\n`
            : `export const typescriptConfig = () => ({ plugins: [] });\n`;
        writeFileSync(join(pkg, 'index.js'), body);
    }
    return { app };
}

/**
 * Run `expr` (an async expression over the default-imported lib `mod`) from `app/`
 * and return its result. The lib emits informational notices (e.g. the "8.x
 * detected" one) on stdout/stderr, so the result is bracketed in a unique marker
 * and extracted — keeping the assertion immune to that noise.
 */
function runInFixture(app, expr) {
    const M = '<<<NSVITE-RESULT>>>';
    const code =
        `import mod, { detectNativescriptViteMajor } from '@gjsify/nativescript-vite';` +
        `void detectNativescriptViteMajor;` +
        `let r;` +
        `try { r = String(await (${expr})); }` +
        `catch (e) { r = 'ERR:' + ((e && (e.cause?.code || e.code)) || String(e && e.message)); }` +
        `process.stdout.write('${M}' + r + '${M}');`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: app,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const start = out.indexOf(M);
    const end = out.indexOf(M, start + M.length);
    return start >= 0 && end > start ? out.slice(start + M.length, end) : out.trim();
}

after(() => {
    for (const d of ALL_TMP) rmSync(d, { recursive: true, force: true });
});

// ─── Bug 1: major detection works against an exports-gated package ────────────
//
// `@nativescript/vite@8.x`'s `package.json#exports` does NOT expose the
// `./package.json` subpath. The old detector resolved `@nativescript/vite/package.json`
// directly → Node threw `ERR_PACKAGE_PATH_NOT_EXPORTED` → caught → `undefined`, so
// the major-8 gate never fired and the full legacy patch set ran. The fix resolves
// the package's MAIN entry (always exported) and walks up to its `package.json`.
describe('@gjsify/nativescript-vite detectNativescriptViteMajor (Bug 1: exports-gated package)', () => {
    function detect(nsVite) {
        const { app } = makeIsolatedFixture(nsVite);
        return runInFixture(app, 'detectNativescriptViteMajor()');
    }

    it('detects the major of an exports-gated @nativescript/vite (no ./package.json subpath)', () => {
        // Under the OLD code this came back "undefined" (ERR_PACKAGE_PATH_NOT_EXPORTED);
        // the fix walks up from the main entry and reads the package root.
        assert.equal(detect({ version: '8.0.0-alpha.57' }), '8', 'major of an 8.x exports-gated package must be detected');
        assert.equal(detect({ version: '2.0.3' }), '2', 'major of a 2.x exports-gated package must be detected');
    });

    it('returns "undefined" when @nativescript/vite is genuinely not installed', () => {
        assert.equal(
            detect(null),
            'undefined',
            'an absent optional peer must keep the graceful undefined fallback (fail-safe to full patch set)',
        );
    });
});

// ─── Bug 2: a framework-less Core app loads the config (missing-peer stubs) ───
//
// `@nativescript/vite@8.x`'s config chain STATICALLY imports the framework
// compilers (`@vue/compiler-sfc`, etc.) at module-eval. They are `peerDependencies`,
// so a framework-LESS NativeScript-Core app can't even `import('@nativescript/vite')`
// — Node throws `ERR_MODULE_NOT_FOUND: Cannot find package '@vue/compiler-sfc'`.
// `defineNativescriptConfig()` stubs the missing peers (no-op modules) so the
// config loads. Verified against a fixture `@nativescript/vite` whose config eagerly
// NAMED-imports a framework peer that is NOT installed.
describe('@gjsify/nativescript-vite missing-framework-peer stubs (Bug 2: Core app)', () => {
    function compose(nsVite) {
        const { app } = makeIsolatedFixture(nsVite);
        return runInFixture(
            app,
            `(async () => { const cfg = await mod()({ command: 'build', mode: 'production' });` +
                ` return 'OK:' + (Array.isArray(cfg.plugins) ? 'config' : typeof cfg); })()`,
        );
    }

    it('composes a Core-app config without throwing when a framework peer is missing', () => {
        // Under the OLD code: `ERR_MODULE_NOT_FOUND` (Cannot find package
        // '@gjsify/fake-vue-compiler'). With the stub: the config composes.
        const out = compose({ version: '8.0.0-alpha.57', peerName: '@gjsify/fake-vue-compiler', eagerImport: true });
        assert.ok(
            out.startsWith('OK:'),
            `a framework-less Core app must compose without throwing — got "${out}" (the missing peer should be stubbed)`,
        );
        assert.ok(out.includes('config'), `the composed result must be a real Vite config object — got "${out}"`);
    });
});

// `gjsifyNativescript()` aliases the bare `css-tree` specifier to css-tree's
// self-contained `dist/csstree.esm.js`. @nativescript/core's CSS parser pulls
// css-tree, whose data modules load JSON via `createRequire(...)` at module-eval
// time — dynamic requires Rolldown can't resolve, which then throw on the NS V8
// runtime. The dist bundle has the data inlined (no createRequire), so the alias
// keeps the crash out. Resolved from the Vite config's `root` (css-tree is a
// transitive dep of the consuming project), skipped when css-tree is absent.
describe('gjsifyNativescript css-tree alias E2E', () => {
    let gjsifyNativescript;
    const tmp = [];

    before(async () => {
        const url = new URL('../../../packages/infra/vite-plugin-gjsify/lib/index.js', import.meta.url);
        ({ gjsifyNativescript } = await import(url));
        assert.equal(
            typeof gjsifyNativescript,
            'function',
            `gjsifyNativescript is not exported from ${fileURLToPath(url)} — rebuild @gjsify/vite-plugin-gjsify`,
        );
    });

    // Run the preset's config() hook the way Vite does and return its result.
    function runConfig(root) {
        const plugin = gjsifyNativescript().find((p) => p && p.name === 'gjsify-nativescript-config');
        assert.ok(plugin, 'gjsify-nativescript-config plugin missing from gjsifyNativescript()');
        return plugin.config({ root }, { mode: 'production' });
    }

    // A throwaway project root carrying a minimal `css-tree` whose `./dist/*`
    // export maps `css-tree/dist/csstree.esm` → `dist/csstree.esm.js`.
    function fixtureWithCssTree() {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-csstree-'));
        tmp.push(dir);
        const pkg = join(dir, 'node_modules', 'css-tree');
        mkdirSync(join(pkg, 'dist'), { recursive: true });
        writeFileSync(
            join(pkg, 'package.json'),
            JSON.stringify({ name: 'css-tree', version: '3.2.1', exports: { './dist/*': './dist/*.js' } }),
        );
        writeFileSync(join(pkg, 'dist', 'csstree.esm.js'), 'export const parse = () => {};\n');
        return dir;
    }

    after(() => {
        for (const d of tmp) rmSync(d, { recursive: true, force: true });
    });

    it('aliases css-tree to its bundled dist when css-tree is resolvable', () => {
        const root = fixtureWithCssTree();
        const alias = runConfig(root).resolve.alias;
        assert.equal(
            alias['css-tree'],
            join(root, 'node_modules', 'css-tree', 'dist', 'csstree.esm.js'),
            'css-tree should be aliased to its dist bundle resolved from the project root',
        );
    });

    it('adds no css-tree alias when css-tree is not installed', () => {
        const empty = mkdtempSync(join(tmpdir(), 'gjsify-nocsstree-'));
        tmp.push(empty);
        const alias = runConfig(empty).resolve.alias;
        assert.ok(!('css-tree' in alias), 'no css-tree alias should be added when css-tree is absent');
        // …but the node-builtin aliases are still present (the preset still works).
        assert.ok('path' in alias || 'node:path' in alias, 'node-builtin aliases must still be wired');
    });
});

// `@nativescript/vite`'s ns-bundler-context registers XML files + their paired
// code-behind, but NOT standalone barrels referenced only via `xmlns="~/MOD"`
// (a barrel `index.ts` with no `.xml` sibling). gjsifyNativescript()'s
// xmlns-barrels plugin augments the generated `virtual:ns-bundler-context`
// module to `import * as` + `registerModule` those barrels — reproducing
// @nativescript/webpack's xml-namespace-loader so `<w:SourceView>` resolves.
describe('gjsifyNativescript xmlns barrels E2E', () => {
    let gjsifyNativescript;
    const tmp = [];
    const BUNDLER_CONTEXT_ID = '\0virtual:ns-bundler-context';
    const UPSTREAM_CODE = '// generated bundler context\n(function () {})();';

    before(async () => {
        const url = new URL('../../../packages/infra/vite-plugin-gjsify/lib/index.js', import.meta.url);
        ({ gjsifyNativescript } = await import(url));
        assert.equal(typeof gjsifyNativescript, 'function', 'gjsifyNativescript must be exported — rebuild the package');
    });

    after(() => {
        for (const d of tmp) rmSync(d, { recursive: true, force: true });
    });

    // The xmlns-barrels plugin, with configResolved(root) already run.
    function pluginForRoot(root) {
        const plugin = gjsifyNativescript().find((p) => p && p.name === 'gjsify-nativescript-xmlns-barrels');
        assert.ok(plugin, 'gjsify-nativescript-xmlns-barrels plugin missing from gjsifyNativescript()');
        plugin.configResolved({ root });
        return plugin;
    }

    // A throwaway NS app whose editor.xml references `~/widgets/index` (a barrel,
    // no .xml sibling → must be registered) AND `~/widgets/source-view` (has an
    // .xml sibling → ns-bundler-context owns it, plugin must SKIP it).
    function fixtureApp() {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-xmlns-'));
        tmp.push(root);
        const app = join(root, 'app');
        mkdirSync(join(app, 'widgets'), { recursive: true });
        mkdirSync(join(app, 'mdx'), { recursive: true });
        writeFileSync(
            join(app, 'editor.xml'),
            '<Page xmlns="http://schemas.nativescript.org/tns.xsd" xmlns:w="~/widgets/index" ' +
                'xmlns:sv="~/widgets/source-view" xmlns:mdx="~/mdx/index">\n  <w:SourceView />\n</Page>\n',
        );
        writeFileSync(join(app, 'widgets', 'index.ts'), 'export class SourceView {}\n');
        writeFileSync(join(app, 'mdx', 'index.ts'), 'export class TutorialView {}\n');
        // Has an .xml sibling → registered by ns-bundler-context, not by us.
        writeFileSync(join(app, 'widgets', 'source-view.xml'), '<GridLayout />\n');
        writeFileSync(join(app, 'widgets', 'source-view.ts'), 'export class SourceView {}\n');
        return root;
    }

    it('registers xmlns barrels with no .xml sibling, skipping those that have one', () => {
        const plugin = pluginForRoot(fixtureApp());
        const out = plugin.transform(UPSTREAM_CODE, BUNDLER_CONTEXT_ID).code;
        // The upstream bundler-context code is preserved.
        assert.ok(out.includes(UPSTREAM_CODE), 'upstream ns-bundler-context code must be preserved');
        // Barrels without an .xml sibling are imported (root-relative) + registered.
        assert.ok(out.includes('"/app/widgets/index.ts"'), 'widgets/index barrel must be imported root-relative');
        assert.ok(out.includes('"/app/mdx/index.ts"'), 'mdx/index barrel must be imported root-relative');
        assert.ok(out.includes('global.registerModule("widgets/index"'), 'widgets/index must be registerModule-d');
        assert.ok(out.includes('global.registerModule("mdx/index"'), 'mdx/index must be registerModule-d');
        // A target WITH an .xml sibling is left to ns-bundler-context.
        assert.ok(
            !out.includes('registerModule("widgets/source-view"'),
            'widgets/source-view has an .xml sibling — must NOT be re-registered',
        );
    });

    it('only transforms the ns-bundler-context virtual module', () => {
        const plugin = pluginForRoot(fixtureApp());
        assert.equal(plugin.transform('whatever', '\0some-other-module'), null, 'non-bundler-context ids return null');
    });

    it('is a no-op when the app declares no xmlns barrels', () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-noxmlns-'));
        tmp.push(root);
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(join(root, 'app', 'main.xml'), '<Page><Label text="hi" /></Page>\n');
        const plugin = pluginForRoot(root);
        assert.equal(plugin.transform(UPSTREAM_CODE, BUNDLER_CONTEXT_ID), null, 'no barrels → transform returns null');
    });
});

// `@nativescript/vite`'s base config aliases @nativescript/core to
// `<project>/../../packages/core` whenever that path exists, WITHOUT verifying
// the directory's package name. In a monorepo whose own `packages/core` is a
// DIFFERENT package (e.g. @learn6502/core), @nativescript/core is aliased to the
// wrong package and its subpaths fail to resolve. `repointCoreAliasEntries` (the
// pure core of the composer's `repointMistargetedCoreAlias` fix) repoints those
// entries at the real installed @nativescript/core.
describe('@gjsify/nativescript-vite repointCoreAliasEntries (core-alias collision)', () => {
    let repointCoreAliasEntries;

    before(async () => {
        ({ repointCoreAliasEntries } = await import(LIB_URL));
        assert.equal(
            typeof repointCoreAliasEntries,
            'function',
            `repointCoreAliasEntries is not exported from the built lib at ${fileURLToPath(LIB_URL)} — rebuild @gjsify/nativescript-vite`,
        );
    });

    const WRONG = '/ws/packages/core'; // a sibling @learn6502/core (the collision)
    const REAL = '/ws/node_modules/@nativescript/core'; // the real installed core

    // The three @nativescript/core alias entries @nativescript/vite emits (with the
    // capture-group replacements), plus unrelated `~`/`@` source aliases that must
    // survive untouched.
    function makeAliases(root) {
        return [
            { find: '~', replacement: '/abs/app/src' },
            { find: /^@nativescript\/core\/(.+)\/index$/, replacement: `${root}/$1` },
            { find: /^@nativescript\/core$/, replacement: root },
            { find: /^@nativescript\/core\/(.*)$/, replacement: `${root}/$1` },
            { find: '@', replacement: '/abs/app/src' },
        ];
    }
    const nameOf = (dir) => (dir === REAL ? '@nativescript/core' : dir === WRONG ? '@learn6502/core' : undefined);

    it('repoints @nativescript/core aliases that target the wrong package', () => {
        const aliases = makeAliases(WRONG);
        repointCoreAliasEntries(aliases, REAL, nameOf);
        // The three core entries now resolve to the real core; `/$1` is preserved.
        assert.equal(aliases[1].replacement, `${REAL}/$1`);
        assert.equal(aliases[2].replacement, REAL);
        assert.equal(aliases[3].replacement, `${REAL}/$1`);
        // Unrelated source aliases are untouched.
        assert.equal(aliases[0].replacement, '/abs/app/src');
        assert.equal(aliases[4].replacement, '/abs/app/src');
    });

    it('leaves a correctly-targeted @nativescript/core alias untouched (real core elsewhere)', () => {
        // Already points at a real @nativescript/core source root (NS's OWN monorepo,
        // where `packages/core` really is @nativescript/core) — name verifies, so it
        // is kept even though `realRoot` differs.
        const aliases = makeAliases(REAL);
        const snapshot = aliases.map((a) => a.replacement);
        repointCoreAliasEntries(aliases, '/some/other/core', nameOf);
        assert.deepEqual(
            aliases.map((a) => a.replacement),
            snapshot,
        );
    });

    it('is a no-op when the alias already points at realRoot', () => {
        const aliases = makeAliases(REAL);
        const snapshot = aliases.map((a) => a.replacement);
        repointCoreAliasEntries(aliases, REAL, () => '@learn6502/core');
        assert.deepEqual(
            aliases.map((a) => a.replacement),
            snapshot,
        );
    });
});
