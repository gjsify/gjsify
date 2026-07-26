// `@gjsify/utils/core` — the cross-runtime half of `@gjsify/utils`.
//
// ADR 0014. `@gjsify/utils` is a GJS-runtime package: six of its modules take a
// top-level `@girs/*` VALUE import (or a bare `imports.*` read) and therefore
// only work under GJS. The other ten are either pure TypeScript or probe for
// the GJS host at call time and fall back to a portable path. Consumers that
// only need the second group must be able to say so in the import specifier,
// so a `browser`/`nativescript`-slotted package's dependency edge is honest
// about whether it reaches GLib/Gio at all.
//
// This is the `/core` subpath shape sanctioned by AGENTS.md
// ("Pure-JS → native swap": *lift it into a `-core` (or `/core` subpath)
// package*) — deliberately a SUBPATH and not a new published package, because
// a new `@gjsify/*` name costs a manual npm first-publish + Trusted Publisher
// bootstrap before the next release train (the `@gjsify/tls-native` v0.4.20
// incident). See `docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md`.
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
// (`gjs-only-import` probe) enforces that split against the declared
// `gjsify.runtimeSubpaths` in this package's `package.json`.

// ── PURE ────────────────────────────────────────────────────────────────────
export * from './callable.js';
export * from './defer.js';
export * from './error.js';
export * from './gio-errors.js';
export * from './globals.js';
export * from './message.js';
export * from './microtask.js';
export * from './platform-names.js';
export * from './structured-clone.js';

// ── GJS-GUARDED (portable fallback off GJS) ─────────────────────────────────
export * from './main-loop.js';
export * from './next-tick.js';
