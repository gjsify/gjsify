/**
 * Re-exports native `node:string_decoder` for use in Node.js builds.
 *
 * On Node, `node:string_decoder` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/string_decoder` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/string_decoder`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:string_decoder';
export { default } from 'node:string_decoder';
