// Runtime detection for GJS and Node.js — original implementation
// Works on both platforms without any @gjsify/* dependencies.
// On GJS: relies on process.versions.gjs being set by @gjsify/process (via @gjsify/node-globals).
// On Node.js: uses native process.versions.node.

/**
 * `true` when running on GJS (GNOME JavaScript).
 */
export const isGJS: boolean = typeof process !== 'undefined' && typeof process.versions?.gjs === 'string';

/**
 * `true` when running on Node.js.
 */
export const isNode: boolean = typeof process !== 'undefined' && typeof process.versions?.node === 'string';

/**
 * Human-readable runtime name: `'GJS'`, `'Node.js'`, or `'Unknown'`.
 */
export const runtimeName: string = isGJS ? 'GJS' : isNode ? 'Node.js' : 'Unknown';

/**
 * Runtime version string, e.g. `'1.86.0'` (GJS) or `'24.1.0'` (Node.js).
 * `undefined` if the runtime cannot be detected.
 */
export const runtimeVersion: string | undefined = isGJS
  ? process.versions.gjs
  : isNode
    ? process.versions.node
    : undefined;
