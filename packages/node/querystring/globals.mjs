/**
 * Re-exports native `node:querystring` for use in Node.js builds.
 *
 * On Node, `node:querystring` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/querystring` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/querystring`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:querystring';
export { default } from 'node:querystring';
