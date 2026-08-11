// E2E guard: the CLI's OWN committed bundle must not route a dependency through
// `@gjsify/napi`.
//
// `napiNodeAddonPlugin` is always-on for `--app gjs` and the CLI's own bundle is built with
// `--app gjs`, so the toolchain is subject to its own addon interception. That is
// categorically wrong — `@gjsify/napi` is a runtime N-API host for USER code — and it broke
// committed-bundle reproducibility: `css-as-string` acquires npm `lightningcss` (napi-rs) as
// its non-GJS backend, and with that acquisition in the BUILD graph the emitted bundle
// depended on whether `@gjsify/napi` happened to be resolvable (resolvable → the plugin
// inlined a `loadAddon()` shim; not resolvable → the import stayed external). Two module
// graphs, so the minifier assigned different variable names, so `verify-committed-bundles`
// went red. A toolchain artifact must not depend on which optional packages a contributor's
// tree carries.
//
// Fixed at the acquisition: `loadNpmBundler` uses an indirect specifier so it resolves at
// runtime and never enters the build graph, mirroring `tryLoadNativeBundler`. This guard is a
// CONTENT check on the committed bundles, so it is environment-independent and costs no
// build.
//
// SCOPE: nothing here is asserted about user projects — a user bundle SHOULD route its
// addons through `@gjsify/napi`, that is the feature.
//
// It deliberately does NOT rebuild each bundle with and without the package and compare
// bytes. That is the property itself, but at ~5 min per bundle it does not belong in e2e, and
// the content checks fail on the ONE mechanism by which the variance can arise. The both-ways
// rebuild was run by hand when the fix landed — identical sha256 either way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A BAKED addon path — the fingerprint of a real interception, and the only form that
 * distinguishes one from a false positive.
 *
 * A text scan for `loadAddon(` or `"@gjsify/napi"` does NOT work, for the reason
 * `gjs-bundle-guard` documents: the CLI bundle CONTAINS the plugin, so it necessarily
 * contains the plugin's shim-generating template literal and its `NAPI_BARE_SPECIFIER`
 * constant. Both matched, both were noise — the first version of this test failed on an
 * already-fixed bundle.
 *
 * A real interception emits a CONCRETE absolute path to a compiled `.node`, baked in at build
 * time, which a template can never produce because its path is an interpolation. Independently
 * worth asserting too: a portable artifact should never carry a build machine's paths.
 *
 * VERIFIED TO FAIL on the real defect, not merely to pass on the fix — building a one-line
 * `import { transform } from 'lightningcss'` with `@gjsify/napi` resolvable emits a path this
 * pattern matches. A guard nobody has watched fail is not a guard.
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
