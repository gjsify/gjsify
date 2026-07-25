// SPDX-License-Identifier: MIT
// @gjsify/napi — GENERIC `.node`-addon resolver for `gjsify build --app gjs`.
//
// Generalizes test/consumer-node-resolver.mjs (which was hard-wired to
// better-sqlite3's `./binding` module) to the addon-loading HELPERS real npm
// native addons use, so an arbitrary sync N-API addon can be routed through
// `@gjsify/napi`'s `loadAddon(<abs .node>)`. The problem is always the same:
// the compiled `.node` is acquired with a DYNAMIC `require(<computed path>)`
// that no bundler can rewrite. So we intercept the well-known helper module
// that computes+requires it and replace it with a virtual module that returns
// `loadAddon(pinnedAddonPath)`.
//
// Handled conventions (keyed by the helper import a bundler DOES see):
//   - `node-gyp-build`          — prebuildify layout (bufferutil, utf-8-validate,
//                                 blake3, …). Default export is a `load(dir)`
//                                 function returning the addon exports.
//   - `bindings`                — node-bindings layout. Default export is a
//                                 `bindings(opts)` function returning exports.
//   - a caller-named module id  — for addons whose entry does the dynamic
//                                 require itself (better-sqlite3 `./binding`,
//                                 node-sqlite3 `../lib/sqlite3` binding line).
//                                 Pass `bindingModules: [{ match, importerRe }]`.
//
// The virtual modules are authored as CJS (`module.exports = …`) so the
// consumer's `require('node-gyp-build')(dir)` / `require('bindings')(name)`
// call site keeps working through gjsify's cjs-compat interop — the helper's
// public value is a callable, not an ESM namespace.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// Built @gjsify/napi L1 (src/ts/index.ts -> lib/esm/index.js), absolute.
const NAPI_LIB = resolve(HERE, '..', 'lib', 'esm', 'index.js');

const V_NGB = '\0gjsify-napi:node-gyp-build';
const V_BINDINGS = '\0gjsify-napi:bindings';
const V_NAMED = (i) => `\0gjsify-napi:named-binding:${i}`;

/**
 * Route a real addon's compiled `.node` through the @gjsify/napi shim.
 *
 * @param {object}   options
 * @param {string}   options.addonPath      Absolute path to the `.node` to load.
 * @param {Array<{match:string|RegExp, importerRe?:RegExp}>} [options.bindingModules]
 *        Extra addon-entry modules that do their own dynamic addon require
 *        (e.g. `{ match: './binding' , importerRe: /better-sqlite3[/\\]lib[/\\]index/ }`).
 *        The whole module is replaced with one exposing `loadAddon(addonPath)`
 *        under BOTH a default (callable) and `getBinding`/named accessors.
 */
export function nodeAddonResolver(options = {}) {
    const addonPath = options.addonPath ?? null;
    const bindingModules = options.bindingModules ?? [];
    // Specifiers whose module is replaced WHOLESALE by the raw native exports
    // (`module.exports = loadAddon(addonPath)`). Used for napi-rs, whose
    // generated loader statically references a dozen uninstalled per-platform
    // packages a bundler can't resolve — we skip the loader and hand back the
    // native exports object directly (its named exports are the addon's API).
    const entryReplace = options.entryReplace ?? [];
    const V_ENTRY = '\0gjsify-napi:entry-replace';

    const namedFor = (source, importer) => {
        for (let i = 0; i < bindingModules.length; i++) {
            const { match, importerRe } = bindingModules[i];
            const hit = match instanceof RegExp ? match.test(source) : source === match;
            if (!hit) continue;
            if (importerRe && !(importer && importerRe.test(importer))) continue;
            return V_NAMED(i);
        }
        return null;
    };

    return {
        name: 'gjsify-napi-node-addon-resolver',

        resolveId(source, importer) {
            if (entryReplace.includes(source)) return V_ENTRY;
            if (source === 'node-gyp-build' || source === 'node-gyp-build/index.js') return V_NGB;
            if (source === 'bindings' || source === 'bindings/bindings.js') return V_BINDINGS;
            return namedFor(source, importer);
        },

        load(id) {
            if (id === V_ENTRY) {
                // Raw native exports as the module's exports. Re-export the
                // known named bindings too so `import { x } from '<pkg>'` works
                // through the bundler's static-named-export analysis.
                return [
                    `const { loadAddon } = require(${JSON.stringify(NAPI_LIB)});`,
                    `module.exports = loadAddon(${JSON.stringify(addonPath)});`,
                ].join('\n');
            }
            if (id === V_NGB) {
                // node-gyp-build's default export is `load(dir)` returning the
                // addon exports; it also carries `.path` / `.parseTuple` etc.
                // Consumers only call the function, so a callable is enough.
                return [
                    `const { loadAddon } = require(${JSON.stringify(NAPI_LIB)});`,
                    `function load(){ return loadAddon(${JSON.stringify(addonPath)}); }`,
                    `load.path = function(){ return ${JSON.stringify(addonPath)}; };`,
                    `module.exports = load;`,
                ].join('\n');
            }
            if (id === V_BINDINGS) {
                return [
                    `const { loadAddon } = require(${JSON.stringify(NAPI_LIB)});`,
                    `function bindings(){ return loadAddon(${JSON.stringify(addonPath)}); }`,
                    `module.exports = bindings;`,
                ].join('\n');
            }
            if (typeof id === 'string' && id.startsWith('\0gjsify-napi:named-binding:')) {
                // Replace an addon-entry "binding acquisition" module. Expose the
                // addon under every shape real entries reach for.
                return [
                    `const { loadAddon } = require(${JSON.stringify(NAPI_LIB)});`,
                    `let __a;`,
                    `function __acquire(){ return (__a ??= loadAddon(${JSON.stringify(addonPath)})); }`,
                    `function getBinding(nativeBinding){`,
                    `  if (nativeBinding && typeof nativeBinding === 'object') return nativeBinding;`,
                    `  if (typeof nativeBinding === 'string') return loadAddon(nativeBinding);`,
                    `  return __acquire();`,
                    `}`,
                    `const __exports = __acquire();`,
                    `__exports.getBinding = getBinding;`,
                    `__exports.getPrebuildPath = function(){ return null; };`,
                    `module.exports = __exports;`,
                ].join('\n');
            }
            return null;
        },
    };
}

export default nodeAddonResolver;
