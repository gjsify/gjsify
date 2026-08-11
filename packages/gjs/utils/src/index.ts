// `@gjsify/utils` — the FULL surface: the cross-runtime `./core` half plus the
// GJS-only modules that take a top-level `@girs/*` value import (or an unguarded
// `imports.*` read) and therefore only work under GJS.
//
// Importing this barrel is a declaration that the consumer reaches GLib/Gio.
// A package whose `gjsify.runtimes.browser` / `.nativescript` slot is
// `polyfill` or `partial` must import `@gjsify/utils/core` instead — see
// `./core.ts` and `docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md`.
// Enforced by `scripts/audit-runtimes.mjs`'s `gjs-only-reach` check.

// ── Cross-runtime half (pure + GJS-guarded) ─────────────────────────────────
export * from './core.js';

// ── GJS-only half (top-level `@girs/*` value import / bare `imports.*`) ─────
// `normalizeEncoding` / `base64Encode` and friends live in `@gjsify/buffer`: they
// describe the Buffer-encoding contract, not generic GJS utilities.
export * from './byte-array.js';
export * from './cli.js';
export * from './file.js';
export * from './fs.js';
export * from './gio.js';
export * from './path.js';
