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
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
        const fixed = applyVite8Fixes(makeSyntheticConfig());

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

    it("removes every 'commonjs' plugin (incl. nested), keeps all others", () => {
        const fixed = applyVite8Fixes(makeSyntheticConfig());

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
