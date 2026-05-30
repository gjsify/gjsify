/**
 * Re-exports native `URL` and `URLSearchParams` globals for Node.js / browser builds.
 *
 * On Node, `URL` and `URLSearchParams` have been stable globals since v10.0 (2018).
 * On browsers they have been native for over a decade (WHATWG URL standard).
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/url` here when `package.json#gjsify.runtimes` declares the
 * non-GJS slot as `"native"`. On GJS, consumers fall through to the polyfill
 * at `lib/esm/index.js` (which wraps `GLib.Uri`).
 */

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export default { URL, URLSearchParams };
