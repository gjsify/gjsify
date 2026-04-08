// Node.js globals for GJS — original implementation using GLib
//
// This module is a pure re-export surface. It has no side effects:
// importing `@gjsify/node-globals` does NOT register any globals on
// `globalThis`. Use `@gjsify/node-globals/register` (or add the relevant
// identifiers to the `--globals` CLI flag) to actually set process,
// Buffer, setImmediate/clearImmediate, btoa/atob, structuredClone,
// queueMicrotask, global, URL, URLSearchParams as globals.
//
// Web APIs like fetch, AbortController, Headers, Request, Response are
// provided by `@gjsify/web-globals` — not this package.

export { ensureMainLoop } from '@gjsify/utils';
