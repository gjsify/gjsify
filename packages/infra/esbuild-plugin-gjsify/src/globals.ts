// Public subpath export for the `--globals` CLI support.
//
// Consumed by `@gjsify/cli` to resolve the user's explicit `--globals` list
// (or auto-detect via two-pass build) and write the inject stub that the
// plugin picks up via its `autoGlobalsInject` option. See the
// "Tree-shakeable Globals" section in AGENTS.md for the architecture.

export { resolveGlobalsList, writeRegisterInjectFile } from './utils/scan-globals.js';
export { detectFreeGlobals } from './utils/detect-free-globals.js';
export { detectAutoGlobals } from './utils/auto-globals.js';
export type { AutoGlobalsResult } from './utils/auto-globals.js';
