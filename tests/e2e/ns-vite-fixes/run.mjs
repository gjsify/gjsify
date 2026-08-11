// E2E test for `@gjsify/nativescript-vite`'s `applyVite8Fixes(config)` composer, which
// makes a `@nativescript/vite` config build under Vite 8 / Rolldown by dropping three
// constructs (the same three its own source header lists):
//   1. `resolve.alias` array entries whose `replacement` is a FUNCTION — Rolldown's native
//      `ViteAlias` cannot convert one into a Rust `String`. Safe to drop: the upstream
//      `nativescript-package-resolver` resolveId plugin + the `~/` / `@` string aliases
//      already cover the same resolution. String/record aliases are kept.
//   2. The explicit `@rollup/plugin-commonjs` (`{ name: 'commonjs' }`), including from
//      nested plugin arrays — it crashes Rolldown with `Cannot read properties of undefined
//      (reading 'currentLoadingModule')`, and Rolldown handles CommonJS natively.
//   3. The vite-side `ns-typescript-check` plugin, on EITHER version line — a bundler is
//      not a type-checker, and `gjsify tsc` is the gate.
//
// CI-safe by construction: no `@nativescript/vite`, no `nativescript` CLI, none of the NS
// toolchain. A SYNTHETIC config reproduces every rejected shape, so the composer's contract
// is proven in isolation from a full `ns prepare` build.
//
// Imported from the package's BUILT lib by relative path because the package is not
// symlinked into the workspace-root `node_modules`, so a bare `@gjsify/nativescript-vite`
// specifier would not resolve. The relative path still resolves the module's own `vite` +
// `@gjsify/vite-plugin-gjsify` imports from the package's `node_modules`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Relative to this file, not CWD, so the suite works whatever directory `node --test` runs in.
const LIB_URL = new URL('../../../packages/infra/nativescript-vite/lib/index.js', import.meta.url);

describe('@gjsify/nativescript-vite applyVite8Fixes E2E', () => {
    let applyVite8Fixes;

    before(async () => {
        ({ applyVite8Fixes } = await import(LIB_URL));
        assert.equal(
            typeof applyVite8Fixes,
            'function',
            `applyVite8Fixes is not exported from the built lib at ${fileURLToPath(LIB_URL)} — rebuild @gjsify/nativescript-vite`,
        );
    });

    /**
     * A synthetic `@nativescript/vite`-shaped config: an alias ARRAY mixing the
     * function-`replacement` canonicalizers upstream emits with the `~/` / `@` string
     * entries, and a `plugins` array whose `commonjs` plugin appears BOTH top-level and
     * inside a nested array — the nesting is what proves the strip recurses.
     */
    function makeSyntheticConfig() {
        return {
            resolve: {
                alias: [
                    // KEEP
                    { find: '~', replacement: '/abs/app/src' },
                    { find: '@', replacement: '/abs/app/src' },
                    // DROP
                    { find: /^.*$/, replacement: () => '/resolved/platform/main' },
                    { find: 'tsconfig-wildcard', replacement: (id) => id.replace('*', 'x') },
                    // KEEP — after the functions, so filtering must preserve survivor order.
                    { find: 'fonts', replacement: '/abs/app/fonts' },
                ],
            },
            plugins: [
                { name: 'nativescript-package-resolver' }, // KEEP — the resolveId hook
                { name: 'commonjs' }, // DROP — @rollup/plugin-commonjs
                { name: 'vite:esbuild' }, // KEEP
                [
                    { name: 'commonjs' }, // DROP
                    { name: 'nested-keeper' }, // KEEP
                ],
                { name: 'vite:define' }, // KEEP
            ],
            // Must be passed through untouched.
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
        // The legacy <= 2 line is pinned explicitly because the function-alias drop belongs
        // to the FULL patch set and `@nativescript/vite@8.x` may be installed here, where
        // auto-detect would skip it. The override makes the assertion disk-independent.
        const fixed = applyVite8Fixes(makeSyntheticConfig(), 2);

        assert.ok(Array.isArray(fixed.resolve.alias), 'resolve.alias should remain an array');

        const hasFunctionAlias = fixed.resolve.alias.some((a) => typeof a.replacement === 'function');
        assert.equal(
            hasFunctionAlias,
            false,
            'a function-replacement alias survived the fix — Rolldown will reject it',
        );

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
        // Legacy line pinned for the same reason as the function-alias test above.
        const fixed = applyVite8Fixes(makeSyntheticConfig(), 2);

        assert.ok(Array.isArray(fixed.plugins), 'plugins should remain an array');

        const names = pluginNames(fixed.plugins);
        assert.equal(
            names.includes('commonjs'),
            false,
            "a 'commonjs' plugin survived the fix — Rolldown will crash on currentLoadingModule",
        );

        assert.deepEqual(
            names,
            ['nativescript-package-resolver', 'vite:esbuild', 'nested-keeper', 'vite:define'],
            'non-commonjs plugins were not preserved (top-level order + nested survivor)',
        );

        // Nesting must survive the strip, not be flattened away.
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
        const fixed = applyVite8Fixes({ build: { target: 'esnext' } });
        assert.deepEqual(fixed, { build: { target: 'esnext' } }, 'minimal config should be returned unchanged');
    });

    it('leaves a record-form (object) resolve.alias untouched', () => {
        // The record form only ever carries string values, so it needs no filtering and is
        // never coerced to an array.
        const recordAlias = { '~': '/abs/app/src', '@': '/abs/app/src' };
        const fixed = applyVite8Fixes({ resolve: { alias: recordAlias } });
        assert.deepEqual(
            fixed.resolve.alias,
            recordAlias,
            'record-form resolve.alias must be passed through unchanged',
        );
    });

    // The 2nd `nsViteMajor` argument bypasses auto-detection — which here returns
    // `undefined` (@nativescript/vite is not installed in CI) and fail-safes to the full
    // <= 2 patch set — so both branches are exercised without two installs.

    it('on @nativescript/vite >= 8: skips fixes 1 & 2, still strips ns-typescript-check', () => {
        // 8.x ships native Vite-8/Rolldown support (string-only aliases, no
        // @rollup/plugin-commonjs), so fixes 1 and 2 must be SKIPPED while fix 3 stays.
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
        const hasFunctionAlias = fixed.resolve.alias.some((a) => typeof a.replacement === 'function');
        assert.equal(
            hasFunctionAlias,
            true,
            'on 8.x the function-replacement alias must be left in place (fix skipped)',
        );
        const names = pluginNames(fixed.plugins);
        assert.ok(names.includes('commonjs'), 'on 8.x the commonjs plugin must be left in place (fix skipped)');
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
        // An explicit 2 must reproduce the auto-detect-unknown default.
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

describe('@gjsify/nativescript-vite nativescriptSbgBundleSyncFix', () => {
    let nativescriptSbgBundleSyncFix;

    before(async () => {
        ({ nativescriptSbgBundleSyncFix } = await import(LIB_URL));
        assert.equal(
            typeof nativescriptSbgBundleSyncFix,
            'function',
            `nativescriptSbgBundleSyncFix is not exported from the built lib at ${fileURLToPath(LIB_URL)} — rebuild @gjsify/nativescript-vite`,
        );
    });

    it('empties the staging dir each build', () => {
        const cfg = nativescriptSbgBundleSyncFix();
        assert.equal(
            cfg.build.emptyOutDir,
            true,
            'build.emptyOutDir must be forced true so stale chunks do not linger',
        );
    });

    it('names every chunk stably (no content hash) so the SBG never sees a duplicate extend', () => {
        const fn = nativescriptSbgBundleSyncFix().build.rolldownOptions.output.chunkFileNames;
        assert.equal(typeof fn, 'function', 'chunkFileNames must be a function');

        // The regression: a hashed `activity.android-<hash>.mjs` accumulates in
        // assets/app across builds → the SBG sees NativeScriptActivity extended twice.
        assert.equal(
            fn({ name: 'activity.android' }),
            '[name].mjs',
            'the platform Activity chunk uses the stable [name].mjs',
        );
        assert.equal(fn({ name: 'vendor' }), 'vendor.mjs', 'the vendor chunk stays vendor.mjs');
        assert.equal(fn({ name: 'app.worker' }), '[name].js', 'worker chunks stay .js, still hash-free');
        assert.equal(fn({ name: 'whatever' }), '[name].mjs', 'a normal chunk uses the stable [name].mjs');

        // No branch may reintroduce a content hash.
        for (const name of ['activity.android', 'vendor', 'app.worker', 'index', undefined]) {
            assert.equal(
                fn({ name }).includes('[hash]'),
                false,
                `chunkFileNames("${name}") must not contain [hash] — hashed names accumulate and break the SBG`,
            );
        }
    });
});

// Isolated-fixture helpers for the two suites below, both of which must run the BUILT lib
// against a FIXTURE `@nativescript/vite` rather than the workspace's real one. The workspace
// symlinks `node_modules/@gjsify/nativescript-vite` → the package source, so a bare import
// from any CWD inside the repo resolves the workspace copy. Hence: fixture in the OS tmp dir
// OUTSIDE the repo, its parent `node_modules` symlinked to the workspace's (for the lib's
// deep deps — `vite`, `@gjsify/vite-plugin-gjsify`, …), and an `app/` child whose own
// `node_modules` shadows with a COPY of the built lib plus the fixture
// `@nativescript/vite`. Running from `app/` then hits the fixture while deep deps fall
// through to the workspace.
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
        symlinkSync(WORKSPACE_NODE_MODULES, join(root, 'node_modules'), 'dir');
    } else {
        // GENUINELY-ABSENT case: link ONLY the lib's deep deps, not the workspace's
        // `@nativescript/vite`, so detection sees no peer at all. A symlinked package
        // resolves its own transitive deps from its real location, so two links suffice.
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
    const libDir = join(appNm, '@gjsify', 'nativescript-vite');
    mkdirSync(libDir, { recursive: true });
    copyFileSync(fileURLToPath(LIB_URL), join(libDir, 'index.js'));
    writeFileSync(
        join(libDir, 'package.json'),
        JSON.stringify({
            name: '@gjsify/nativescript-vite',
            version: '0.0.0',
            type: 'module',
            exports: { '.': './index.js' },
        }),
    );

    if (nsVite) {
        const pkg = join(appNm, '@nativescript', 'vite');
        mkdirSync(pkg, { recursive: true });
        const pkgJson = {
            name: '@nativescript/vite',
            version: nsVite.version,
            type: 'module',
            // The 8.x shape: root entry only, NO ./package.json subpath.
            exports: { '.': { import: './index.js', default: './index.js' } },
        };
        if (nsVite.peerName) {
            pkgJson.peerDependencies = { [nsVite.peerName]: '*' };
            pkgJson.peerDependenciesMeta = { [nsVite.peerName]: { optional: true } };
        }
        writeFileSync(join(pkg, 'package.json'), JSON.stringify(pkgJson));
        const body = nsVite.eagerImport
            ? // The `@vue/compiler-sfc` failure shape: an eager NAMED import of an absent
              // peer at module-eval, which breaks the ESM link.
              `import { compileScript, parse } from '${nsVite.peerName}';\n` +
              `export const typescriptConfig = () => ({ plugins: [], _peerSeen: typeof compileScript + ',' + typeof parse });\n`
            : `export const typescriptConfig = () => ({ plugins: [] });\n`;
        writeFileSync(join(pkg, 'index.js'), body);
    }
    return { app };
}

/**
 * Run `expr` (an async expression over the default-imported lib `mod`) from `app/`. The lib
 * writes informational notices to stdout/stderr, so the result is bracketed in a unique
 * marker and extracted, keeping the assertions immune to that noise.
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

// `@nativescript/vite@8.x`'s `package.json#exports` does NOT expose the `./package.json`
// subpath, so resolving that path directly throws `ERR_PACKAGE_PATH_NOT_EXPORTED` and a
// detector that catches it answers `undefined` — the major-8 gate never fires and the full
// legacy patch set runs. Detection therefore resolves the MAIN entry (always exported) and
// walks up to the package root.
describe('@gjsify/nativescript-vite detectNativescriptViteMajor (Bug 1: exports-gated package)', () => {
    function detect(nsVite) {
        const { app } = makeIsolatedFixture(nsVite);
        return runInFixture(app, 'detectNativescriptViteMajor()');
    }

    it('detects the major of an exports-gated @nativescript/vite (no ./package.json subpath)', () => {
        assert.equal(
            detect({ version: '8.0.0-alpha.57' }),
            '8',
            'major of an 8.x exports-gated package must be detected',
        );
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

// `@nativescript/vite@8.x`'s config chain STATICALLY imports the framework compilers
// (`@vue/compiler-sfc`, …) at module-eval, and they are `peerDependencies` — so a
// framework-LESS NativeScript-Core app cannot even `import('@nativescript/vite')`:
// `ERR_MODULE_NOT_FOUND`. `defineNativescriptConfig()` stubs the missing peers with no-op
// modules so the config loads.
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
        const out = compose({ version: '8.0.0-alpha.57', peerName: '@gjsify/fake-vue-compiler', eagerImport: true });
        assert.ok(
            out.startsWith('OK:'),
            `a framework-less Core app must compose without throwing — got "${out}" (the missing peer should be stubbed)`,
        );
        assert.ok(out.includes('config'), `the composed result must be a real Vite config object — got "${out}"`);
    });
});

// `gjsifyNativescript()` aliases the bare `css-tree` specifier to css-tree's self-contained
// `dist/csstree.esm.js`: @nativescript/core's CSS parser pulls css-tree, whose data modules
// load JSON via `createRequire(...)` at module-eval — dynamic requires Rolldown cannot
// resolve, which then throw on the NS V8 runtime. The dist bundle has that data inlined.
// Resolved from the Vite config's `root` (css-tree is a transitive dep of the consuming
// project), skipped when css-tree is absent.
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
        // The rest of the preset must still be wired.
        assert.ok('path' in alias || 'node:path' in alias, 'node-builtin aliases must still be wired');
    });
});

// `@nativescript/vite`'s ns-bundler-context registers XML files + their paired code-behind,
// but NOT a standalone barrel referenced only via `xmlns="~/MOD"` (an `index.ts` with no
// `.xml` sibling). The xmlns-barrels plugin augments the generated
// `virtual:ns-bundler-context` to `import * as` + `registerModule` those barrels,
// reproducing @nativescript/webpack's xml-namespace-loader so `<w:SourceView>` resolves.
describe('gjsifyNativescript xmlns barrels E2E', () => {
    let gjsifyNativescript;
    const tmp = [];
    const BUNDLER_CONTEXT_ID = '\0virtual:ns-bundler-context';
    const UPSTREAM_CODE = '// generated bundler context\n(function () {})();';

    before(async () => {
        const url = new URL('../../../packages/infra/vite-plugin-gjsify/lib/index.js', import.meta.url);
        ({ gjsifyNativescript } = await import(url));
        assert.equal(
            typeof gjsifyNativescript,
            'function',
            'gjsifyNativescript must be exported — rebuild the package',
        );
    });

    after(() => {
        for (const d of tmp) rmSync(d, { recursive: true, force: true });
    });

    /** The plugin with `configResolved(root)` already run. */
    function pluginForRoot(root) {
        const plugin = gjsifyNativescript().find((p) => p && p.name === 'gjsify-nativescript-xmlns-barrels');
        assert.ok(plugin, 'gjsify-nativescript-xmlns-barrels plugin missing from gjsifyNativescript()');
        plugin.configResolved({ root });
        return plugin;
    }

    /**
     * A throwaway NS app whose editor.xml references both cases: `~/widgets/index` (a
     * barrel, no .xml sibling → must be registered) and `~/widgets/source-view` (has an
     * .xml sibling → ns-bundler-context owns it, so the plugin must SKIP it).
     */
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
        writeFileSync(join(app, 'widgets', 'source-view.xml'), '<GridLayout />\n');
        writeFileSync(join(app, 'widgets', 'source-view.ts'), 'export class SourceView {}\n');
        return root;
    }

    it('registers xmlns barrels with no .xml sibling, skipping those that have one', () => {
        const plugin = pluginForRoot(fixtureApp());
        const out = plugin.transform(UPSTREAM_CODE, BUNDLER_CONTEXT_ID).code;
        assert.ok(out.includes(UPSTREAM_CODE), 'upstream ns-bundler-context code must be preserved');
        assert.ok(out.includes('"/app/widgets/index.ts"'), 'widgets/index barrel must be imported root-relative');
        assert.ok(out.includes('"/app/mdx/index.ts"'), 'mdx/index barrel must be imported root-relative');
        assert.ok(out.includes('global.registerModule("widgets/index"'), 'widgets/index must be registerModule-d');
        assert.ok(out.includes('global.registerModule("mdx/index"'), 'mdx/index must be registerModule-d');
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
// `<project>/../../packages/core` whenever that path exists, WITHOUT verifying the
// directory's package name — so in a monorepo whose own `packages/core` is a different
// package (e.g. @learn6502/core), @nativescript/core is aliased to the wrong one and its
// subpaths fail to resolve. `repointCoreAliasEntries` is the pure core of the composer's
// `repointMistargetedCoreAlias` fix.
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

    /** The three core alias entries @nativescript/vite emits, plus `~`/`@` bystanders. */
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
        // `/$1` must survive the repoint.
        assert.equal(aliases[1].replacement, `${REAL}/$1`);
        assert.equal(aliases[2].replacement, REAL);
        assert.equal(aliases[3].replacement, `${REAL}/$1`);
        assert.equal(aliases[0].replacement, '/abs/app/src');
        assert.equal(aliases[4].replacement, '/abs/app/src');
    });

    it('leaves a correctly-targeted @nativescript/core alias untouched (real core elsewhere)', () => {
        // NS's OWN monorepo, where `packages/core` really is @nativescript/core: the name
        // verifies, so the alias is kept even though `realRoot` differs.
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
