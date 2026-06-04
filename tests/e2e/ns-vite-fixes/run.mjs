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

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

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
