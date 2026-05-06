// Public subpath export for the `--globals` CLI support.
//
// Consumed by `@gjsify/cli` to resolve the user's explicit `--globals` list
// (or auto-detect via the iterative multi-pass build) and write the inject
// stub that the plugin picks up via its `autoGlobalsInject` option. See the
// "Tree-shakeable Globals" section in AGENTS.md for the architecture.

export { resolveGlobalsList, writeRegisterInjectFile } from './utils/scan-globals.js';
export { detectFreeGlobals } from './utils/detect-free-globals.js';
// `detectAutoGlobals` lands in the auto-globals port commit — re-exported
// here to keep the public surface stable across the migration.
