/**
 * Re-exports native `node:readline` for use in Node.js builds.
 *
 * On Node, `node:readline` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/readline` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/readline`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:readline';
export { default } from 'node:readline';
