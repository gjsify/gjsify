// E2E guard: the CLI's OWN committed bundle must not route a dependency
// through `@gjsify/napi`.
//
// `napiNodeAddonPlugin` is always-on for `--app gjs`, and `gjsify build`'s own
// bundle is built with `--app gjs` too — so the toolchain is subject to its own
// addon interception. That is categorically wrong: `@gjsify/napi` is a runtime
// N-API host for USER code, while `dist/cli.gjs.mjs` is the thing that does the
// building.
//
// It is also what broke committed-bundle reproducibility. `css-as-string`
// acquires npm `lightningcss` (a napi-rs package) as its non-GJS backend. When
// that acquisition sat in the BUILD graph, the emitted bundle depended on
// whether `@gjsify/napi` happened to be resolvable at build time:
//
//   - resolvable    → the plugin rewrote the generated loader to a
//                     `loadAddon()` shim and INLINED it
//   - not resolvable→ the plugin declined and the import stayed external
//
// Two different module graphs, so the minifier assigned different variable
// names, so the artifact no longer reproduced from its own source —
// `verify-committed-bundles` red with `committed 6567694 B · rebuilt 6568309 B ·
// first difference at byte 275`, the difference being `r=` vs `a=` for
// `globalThis.imports.gi.GLib`. A toolchain artifact must not depend on which
// optional packages a contributor's tree happens to carry.
//
// The fix is at the acquisition (`loadNpmBundler` uses an indirect specifier, so
// it resolves at runtime and never enters the build graph — mirroring what
// `tryLoadNativeBundler` already did). This guard is what keeps it fixed: a
// CONTENT check on the committed bundles, so it is environment-independent and
// costs no build.
//
// Scope note: this asserts nothing about user projects. A user bundle SHOULD
// route its addons through `@gjsify/napi` — that is the feature. Only the
// toolchain's own artifacts are covered here.
//
// What this does NOT do: rebuild each bundle both with and without the package
// and compare bytes. That is the property itself, but it costs ~5 min per
// bundle, which does not belong in e2e. The content checks below stand in for
// it because they fail on the ONE mechanism by which the variance can arise (a
// napi shim entering the graph). The both-ways rebuild was run by hand when the
// fix landed — identical sha256 with and without `@gjsify/napi` present.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A BAKED addon path — the fingerprint of a real interception, and the only
 * form that distinguishes one from a false positive.
 *
 * A plain text scan for `loadAddon(` or `"@gjsify/napi"` does NOT work here,
 * and the reason is the same one `gjs-bundle-guard` documents: the CLI bundle
 * CONTAINS the plugin, so it necessarily contains the plugin's shim-generating
 * template literals (`loadAddon(${JSON.stringify(addonPath)})`) and its
 * `NAPI_BARE_SPECIFIER` constant. Both matched, both were noise — the first
 * version of this test failed on the already-fixed bundle.
 *
 * What a real interception emits instead is a CONCRETE, absolute path to a
 * compiled `.node`, baked in at build time (observed:
 * `loadAddon("/…/lightningcss.linux-x64-gnu.node")`). A template can never
 * produce that, because its path is an interpolation. So the presence of a
 * literal absolute `.node` path is exact — and it is independently worth
 * asserting: a portable artifact should never carry a build machine's paths.
 *
 * VERIFIED TO FAIL on the real defect, not just to pass on the fix: building a
 * one-line `import { transform } from 'lightningcss'` with `@gjsify/napi`
 * resolvable emits
 *   `…/node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node`
 * and this pattern matches it. A guard nobody has watched fail is not a guard.
 */
const ADDON_PATH_RE = /["'`](\/[^"'`\n]*\.node)["'`]/g;

/** The committed GJS artifacts the toolchain itself ships. */
const BUNDLES = [
    ['cli.gjs.mjs', '../../../packages/infra/cli/dist/cli.gjs.mjs'],
    ['affected.gjs.mjs', '../../../packages/infra/cli/dist/affected.gjs.mjs'],
];

describe('toolchain bundles are @gjsify/napi-free', () => {
    for (const [name, rel] of BUNDLES) {
        const bundlePath = fileURLToPath(new URL(rel, import.meta.url));

        it(`${name} is committed + non-empty`, () => {
            assert.ok(existsSync(bundlePath), `${rel} must be committed`);
            assert.ok(readFileSync(bundlePath, 'utf8').length > 1000);
        });

        it(`${name} bakes no compiled-addon path`, () => {
            const src = readFileSync(bundlePath, 'utf8');
            const baked = [...src.matchAll(ADDON_PATH_RE)].map((m) => m[1]);
            assert.deepEqual(
                baked,
                [],
                `${name} bakes an absolute path to a compiled .node addon: ${baked.join(', ')}. ` +
                    "The toolchain's own bundle must not route a dependency through the N-API " +
                    'host — it makes the artifact depend on whether @gjsify/napi was installed ' +
                    'when it was built, which breaks verify-committed-bundles. Acquire the native ' +
                    'dep at RUNTIME via an indirect specifier (see loadNpmBundler / ' +
                    'tryLoadNativeBundler in css-as-string.ts) so it never enters the build graph.',
            );
        });
    }
});
