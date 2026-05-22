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
// `gjsify build` runs with `--globals auto,TextEncoder,TextDecoder,
// performance,crypto,console,Date` so the wasm-bindgen glue's
// dependencies on those host APIs resolve to gjsify's polyfills.
// (auto picks up everything referenced in the bundle, but `performance`
// and `crypto` flow indirectly through the WASM-side callbacks so they
// don't show up in the static scan — hence the explicit hints.)

import { run } from '@gjsify/unit';
import loroTextSuite from './loro-text.spec.js';
import loroListSuite from './loro-list.spec.js';
import loroMapSuite from './loro-map.spec.js';
import loroTreeSuite from './loro-tree.spec.js';
import loroSnapshotSyncSuite from './loro-snapshot-sync.spec.js';

run({
    loroTextSuite,
    loroListSuite,
    loroMapSuite,
    loroTreeSuite,
    loroSnapshotSyncSuite,
});
