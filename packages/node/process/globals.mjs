/**
 * Re-exports the native `process` global for Node.js builds.
 *
 * On Node, `process` is a built-in global — there is no `node:process` value
 * worth importing from our polyfill. The cross-runtime resolver routes
 * `@gjsify/process` here on `--app node` so consumers get the runtime-native
 * value with no detour through the GJS-bound `lib/esm/index.js`.
 *
 * On GJS, this file is NOT consulted — `process` is wired by
 * `@gjsify/node-globals/register/process` at bundle entry time.
 *
 * IMPORTANT: must not reference `node:process` (or any other `node:`
 * specifier) — the audit-runtimes `--strict` probe rejects re-exports from
 * `node:*` for a slot that also serves browser builds.
 */
export default globalThis.process;
export const env = globalThis.process?.env;
export const argv = globalThis.process?.argv;
export const platform = globalThis.process?.platform;
export const nextTick = globalThis.process?.nextTick?.bind(globalThis.process);
