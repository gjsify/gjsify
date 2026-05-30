// Integration-test entry for @gjsify/integration-loro-crdt.
//
// Loro is a CRDT framework that ships as a Rust → WASM module via
// wasm-bindgen, distributed on npm under three entry shapes:
//   - `nodejs/index.js` — Node-specific, uses require('fs') to read
//      the .wasm file off disk;
//   - `bundler/index.js` — for bundlers with native WASM-import support;
//   - `base64/index.js` — pure-JS entry where the .wasm is embedded
//      as a base64 string and inflated at module-init time via
//      `globalThis.atob` + `WebAssembly.compile`.
//
// We test the **base64 entry** specifically because it's the only
// entry that loads without runtime fs / fetch / bundler magic — it's
// the canonical real-world consumer pattern for WASM-on-GJS, and the
// one a published npm package targeting both browser and GJS will
// realistically ship.
//
// `gjsify build` runs with `--globals auto,crypto`. The auto detector
// finds 38 globals directly (Blob, performance, URL, fetch, the full
// stream-API surface, …) but misses `crypto` because the wasm-bindgen
// glue accesses `globalThis.crypto.getRandomValues` through a
// generated `__wbg_*` callback wrapper that registers crypto via the
// imports object — it doesn't surface as a direct `crypto.<method>`
// member expression the static scan can follow. The explicit `crypto`
// hint adds @gjsify/webcrypto's `getRandomValues` to the bundle.
//
// What the auto detector DOES catch unaided:
//   - `performance` — wasm-bindgen calls `performance.now()` directly
//   - `URL`, `URLSearchParams` — Loro's networking helpers (unused by
//      the base64 entry but pulled in by tree-shaking)
//   - `Blob`, `File`, `Headers`, `Request`, `Response` — Web API surface
//   - `ReadableStream`/`WritableStream` + helpers — Streams API
//   - `WebAssembly` — the wasm-bindgen `compile`/`instantiate` calls
//
// What's native in GJS and needs no polyfill:
//   - `TextEncoder` / `TextDecoder` — SpiderMonkey 140 ships them
//   - `Date`, `console` — ECMAScript / GJS built-ins
//
// Tracked follow-up in @gjsify/rolldown-plugin-gjsify's auto-globals
// detector: add a `__wbg_crypto_*` marker so the wasm-bindgen
// crypto-import pattern surfaces in `auto` without the explicit hint.

import { run } from '@gjsify/unit';
import loroTextSuite from './loro-text.spec.js';
import loroListSuite from './loro-list.spec.js';
import loroMapSuite from './loro-map.spec.js';
import loroTreeSuite from './loro-tree.spec.js';
import loroSnapshotSyncSuite from './loro-snapshot-sync.spec.js';
import loroCounterSuite from './loro-counter.spec.js';
import loroMovableListSuite from './loro-movable-list.spec.js';
import loroVersionSuite from './loro-version.spec.js';
import loroAwarenessSuite from './loro-awareness.spec.js';

run({
    loroTextSuite,
    loroListSuite,
    loroMapSuite,
    loroTreeSuite,
    loroSnapshotSyncSuite,
    loroCounterSuite,
    loroMovableListSuite,
    loroVersionSuite,
    loroAwarenessSuite,
});
