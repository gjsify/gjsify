// Integration-test entry for @gjsify/integration-loro-crdt.
//
// Loro ships as a Rust → WASM module via wasm-bindgen under three npm entry shapes, and this
// suite deliberately tests the **base64** one — the .wasm embedded as a base64 string and
// inflated at module-init via `globalThis.atob` + `WebAssembly.compile`. It is the only entry
// that loads without runtime fs (`nodejs/index.js`) or bundler WASM-import support
// (`bundler/index.js`), so it is the canonical WASM-on-GJS consumer pattern.
//
// The build runs `--globals auto,crypto`. The explicit `crypto` is load-bearing: the
// wasm-bindgen glue reaches `globalThis.crypto.getRandomValues` through a generated `__wbg_*`
// callback registered via the imports object, never as a direct `crypto.<method>` member
// expression, so the static scan cannot follow it. Everything else the wasm-bindgen glue and
// Loro's tree-shaken helpers need — `performance`, `URL`, `Blob`, the Streams surface,
// `WebAssembly` — `auto` finds unaided.

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
