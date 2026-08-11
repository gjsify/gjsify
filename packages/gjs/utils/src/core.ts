// `@gjsify/utils/core` — the cross-runtime half of `@gjsify/utils`, so that a
// `browser`/`nativescript`-slotted consumer's dependency edge is honest about
// whether it reaches GLib/Gio at all.
//
// A SUBPATH and not a new published package on purpose: a new `@gjsify/*` name
// costs a manual npm first-publish + Trusted Publisher bootstrap before the next
// release train (the `@gjsify/tls-native` v0.4.20 incident). See
// `docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md`.
//
// Membership rule — a module belongs here iff calling ANY of its exports on a
// runtime without GLib/Gio is well-defined:
//
//   PURE          no platform dependency whatsoever.
//   GJS-GUARDED   reads the GJS host through a guarded probe
//                 (`globalThis.imports?.gi`) and has a non-GJS fallback, so it
//                 degrades to a documented no-op/portable path off GJS.
//
// Anything with a top-level `@girs/*` value import or an unguarded `imports.*`
// read stays in `../index.js` only. `scripts/audit-runtimes.mjs`
// (`gjs-only-reach` check) enforces that split against the declared
// `gjsify.runtimeSubpaths` in this package's `package.json`.

// ── PURE ────────────────────────────────────────────────────────────────────
export * from './callable.js';
export * from './defer.js';
export * from './error.js';
export * from './gio-errors.js';
export * from './globals.js';
export * from './host-os.js';
export * from './message.js';
export * from './microtask.js';
export * from './platform-names.js';
export * from './structured-clone.js';

// ── GJS-GUARDED (portable fallback off GJS) ─────────────────────────────────
export * from './host-process.js';
export * from './main-loop.js';
export * from './next-tick.js';
