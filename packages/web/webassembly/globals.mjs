/**
 * Re-exports native WebAssembly Promise APIs for use in Node.js builds.
 * On Node.js these are native — gjsify's bundler aliases the bare
 * `webassembly` specifier (and `/register/*` subpaths) here so consumer
 * code calls native `WebAssembly.{compile,instantiate,...}` instead of
 * dragging the polyfill into the bundle.
 */
const wa = globalThis.WebAssembly;
export const compile = wa?.compile.bind(wa);
export const compileStreaming = wa?.compileStreaming?.bind(wa);
export const instantiate = wa?.instantiate.bind(wa);
export const instantiateStreaming = wa?.instantiateStreaming?.bind(wa);
export const validate = wa?.validate.bind(wa);
