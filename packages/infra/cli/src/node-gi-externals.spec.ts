// Regression coverage for the `--app node` node-gi bare-built-in externals.
//
// Invariant: every target of `ALIASES_GJS_FOR_NODE` (`@gjsify/node-gi/system`,
// `@gjsify/node-gi/gettext`, `@gjsify/node-gi/cairo`) MUST appear in the node
// factory's `options.external` STRING ARRAY — not merely be returned with the
// resolveId `{ external: true }` flag by `gjsBuiltinModulesNodePlugin`.
//
// Why the array, not the resolveId flag (see AGENTS.md §Axis 5 active track):
//   - `@gjsify/rolldown-native` (the GJS bundler engine) JSON-serializes its
//     options to the Rust core and SILENTLY DROPS the resolveId `external`
//     flag — only the plain `external` string array survives.
//   - So a rewritten `@gjsify/node-gi/<mod>` target stays external under the GJS
//     bundler ONLY if it is listed in the array. A target missing from it (as
//     `@gjsify/node-gi/cairo` once was — only `system`/`gettext` were listed)
//     leaves the bare specifier (`cairo`) unresolved, breaking every
//     Cairo/PangoCairo consumer (`@gjsify/canvas2d-core`) built via the reverse
//     bridge. Under npm `rolldown` the resolveId flag IS honoured, so the gap
//     was invisible until a Cairo consumer was built on the GJS bundler.
//
// The node factory derives the set from `ALIASES_GJS_FOR_NODE`'s values, so a
// new bare built-in added to that map is externalised automatically. This test
// pins that: it walks the ACTUAL map and asserts each value is externalised.
//
// Tested from @gjsify/cli's `test:node` harness (like `auto-globals.spec.ts`)
// because `@gjsify/rolldown-plugin-gjsify` has no test runner of its own; the
// CLI already declares the plugin as a dependency and re-exports `setupForNode`
// + `ALIASES_GJS_FOR_NODE` from the plugin's public API.

import { describe, expect, it } from '@gjsify/unit';
import { setupForNode, ALIASES_GJS_FOR_NODE } from '@gjsify/rolldown-plugin-gjsify';

async function nodeExternals(userExternal?: string[]): Promise<string[]> {
    // `setupForNode` needs no real entry file to compute `options.external` —
    // with no `input` the entry-point glob is a no-op and the external set is
    // built independently of it.
    const { options } = await setupForNode({
        output: { file: 'dist/out.mjs' },
        userExternal,
        pluginOptions: {},
    });
    const external = options.external;
    // The node factory always passes the EXACT-MATCH set as a string array (never
    // a predicate function) precisely so `@gjsify/rolldown-native` honours it.
    if (!Array.isArray(external)) {
        throw new Error(
            `--app node options.external must be a string array (@gjsify/rolldown-native drops function/flag forms), got ${typeof external}`,
        );
    }
    return external as string[];
}

export default async () => {
    await describe('--app node: node-gi bare-built-in externals', async () => {
        await it('externalises every ALIASES_GJS_FOR_NODE target in the string array', async () => {
            const external = await nodeExternals();
            for (const target of Object.values(ALIASES_GJS_FOR_NODE)) {
                expect(external).toContain(target);
            }
        });

        await it('externalises @gjsify/node-gi/cairo (the regression)', async () => {
            // cairo was the target missing from the array — this is the exact
            // case that broke @gjsify/canvas2d-core on the GJS bundler.
            const external = await nodeExternals();
            expect(external).toContain('@gjsify/node-gi/cairo');
            expect(external).toContain('@gjsify/node-gi/system');
            expect(external).toContain('@gjsify/node-gi/gettext');
        });

        await it('keeps the node-gi GI runtime + globals shim external too', async () => {
            const external = await nodeExternals();
            expect(external).toContain('@gjsify/node-gi/gi');
            expect(external).toContain('@gjsify/node-gi/globals');
        });

        await it('does NOT leave the bare GJS built-in names in the external array', async () => {
            // The bare `cairo`/`system`/`gettext` must be REWRITTEN to the
            // `@gjsify/node-gi/<mod>` shims, never externalised as-is (that would
            // let an npm package literally named `cairo` shadow the GI binding).
            const external = await nodeExternals();
            for (const bare of Object.keys(ALIASES_GJS_FOR_NODE)) {
                expect(external).not.toContain(bare);
            }
        });

        await it('appends user externals without dropping the node-gi targets', async () => {
            const external = await nodeExternals(['some-native-addon']);
            expect(external).toContain('some-native-addon');
            expect(external).toContain('@gjsify/node-gi/cairo');
        });
    });
};
