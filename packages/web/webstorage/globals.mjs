/**
 * Re-exports native Web Storage globals for use in browser builds.
 * On any modern browser, `Storage` / `localStorage` / `sessionStorage` are
 * native globals.
 *
 * Node has no Storage native (no `localStorage`) — `@gjsify/webstorage`'s
 * `runtimes.node` is "polyfill", so the bundler routes Node-target imports
 * to the package's own polyfill and never reaches this file.
 */
export const Storage = globalThis.Storage;
export const localStorage = globalThis.localStorage;
export const sessionStorage = globalThis.sessionStorage;
