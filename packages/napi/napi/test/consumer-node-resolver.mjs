// SPDX-License-Identifier: MIT
// @gjsify/napi — minimal `.node`-addon resolver for `gjsify build --app gjs`
// (plan §4 L1 integration, gate-scoped version).
//
// better-sqlite3's `lib/index.js` does `require('./binding').getBinding`, and
// `lib/binding.js` acquires the compiled addon with a DYNAMIC `require(<path>)`
// (a computed prebuild/build path) — there is no literal `*.node` specifier in
// the module graph a bundler could rewrite. So instead of rewriting a `.node`
// import, this plugin rewrites the ADDON-ACQUISITION MODULE: it replaces
// `better-sqlite3/lib/binding.js` with a virtual module whose `getBinding`
// returns the addon loaded through `@gjsify/napi`'s `loadAddon(<abs .node>)`.
// `require('better-sqlite3')` stays completely intact — only where the addon
// comes from changes.
//
// This is deliberately a small STANDALONE plugin for the consumer gate; proper
// integration into `@gjsify/rolldown-plugin-gjsify` (a general `*.node` →
// loadAddon resolver keyed off the addon-loading conventions) is tracked as a
// follow-up.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The built @gjsify/napi L1 (src/ts/index.ts -> lib/esm/index.js). Absolute so
// the virtual module resolves it regardless of where the bundler anchors.
const NAPI_LIB = resolve(HERE, '..', 'lib', 'esm', 'index.js');

const VIRTUAL_ID = '\0gjsify-napi:better-sqlite3-binding';

/** Locate the compiled addon for a resolved better-sqlite3 root. */
function resolveAddonPath(bsqRoot, override) {
    if (override) return override;
    const built = join(bsqRoot, 'build', 'Release', 'better_sqlite3.node');
    if (existsSync(built)) return built;
    // Fall back to a shipped prebuild for the host (prebuildify layout).
    const target = `${process.platform}-${process.arch}`;
    const pre = join(bsqRoot, 'prebuilds', `${target}.node`);
    if (existsSync(pre)) return pre;
    throw new Error(
        `gjsify-napi resolver: no better_sqlite3 addon found under ${bsqRoot} ` +
            `(looked for build/Release + prebuilds/${target}.node)`,
    );
}

/**
 * A Rolldown/Vite plugin that routes better-sqlite3's native addon through the
 * @gjsify/napi shim. `options.addonPath` pins an explicit `.node`; otherwise it
 * is derived from the resolved better-sqlite3 location.
 */
export function nodeAddonResolver(options = {}) {
    let addonPath = options.addonPath ?? null;

    return {
        name: 'gjsify-napi-node-addon-resolver',

        resolveId(source, importer) {
            // better-sqlite3/lib/index.js -> require('./binding')
            if (!importer) return null;
            const isBindingReq =
                (source === './binding' || source === './binding.js') &&
                /better-sqlite3[/\\]lib[/\\]index\.(c?js|mjs)$/.test(importer);
            if (!isBindingReq) return null;
            const bsqRoot = resolve(dirname(importer), '..');
            addonPath = resolveAddonPath(bsqRoot, options.addonPath);
            return VIRTUAL_ID;
        },

        load(id) {
            if (id !== VIRTUAL_ID) return null;
            if (!addonPath) throw new Error('gjsify-napi resolver: addon path not resolved');
            // ESM virtual module. `require('./binding')` from the CJS index.js
            // sees these named exports through the bundler's CJS<->ESM interop;
            // `.getBinding` is the function better-sqlite3 calls.
            return [
                `import { loadAddon } from ${JSON.stringify(NAPI_LIB)};`,
                `let __addon;`,
                `function __acquire(){ return (__addon ??= loadAddon(${JSON.stringify(addonPath)})); }`,
                `export function getBinding(nativeBinding){`,
                `  if (nativeBinding && typeof nativeBinding === 'object') return nativeBinding;`,
                `  if (typeof nativeBinding === 'string') return loadAddon(nativeBinding);`,
                `  return __acquire();`,
                `}`,
                `export function getPrebuildPath(){ return null; }`,
                `export default { getBinding, getPrebuildPath };`,
            ].join('\n');
        },
    };
}

export default nodeAddonResolver;
