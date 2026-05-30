/**
 * Meta package — `@gjsify/browser-node-polyfills` umbrella aggregator for the
 * subset of `@gjsify/*` Node.js polyfills that ship a browser-runnable build.
 *
 * Browser-side side-effect entrypoint. Mirrors the `globals.mjs` contract
 * documented in AGENTS.md `## Tree-shakeable globals — /register subpath
 * convention`: every dependency below contributes a `/register` subpath that
 * installs the polyfill onto `globalThis` (Buffer, Blob, File, …). Importing
 * this module is equivalent to importing every contributing `/register`
 * side-effect at once — convenient for browser-build smoke tests and the
 * `tests/browser/` Playwright harness.
 *
 * Today only `@gjsify/buffer/register` is wired here. As the per-package
 * browser polyfill wave (PRs #392 – #396, plus follow-ups) lands additional
 * `/register` granular subpaths on `@gjsify/{process,timers,console,…}`,
 * append the corresponding side-effect imports below. Each entry MUST be
 * idempotent (`if (typeof globalThis.X === 'undefined')` guard inside the
 * register module) — this aggregator is safe to import twice.
 */

import '@gjsify/buffer/register';
