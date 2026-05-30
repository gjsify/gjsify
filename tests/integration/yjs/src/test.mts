// Integration-test entry for @gjsify/integration-yjs.
//
// Yjs is the de-facto JavaScript CRDT — it backs TipTap, ProseMirror
// collab, BlockNote, Hocuspocus, and a long tail of collaborative
// editors. Unlike Loro (Rust → WASM, exercised by the sibling
// `tests/integration/loro-crdt/` suite), Yjs is pure JavaScript at
// its core, so it stresses a different cross-section of the GJS engine:
//
//   - **Heavy `Uint8Array` + `DataView` use** for the binary wire format
//     (`Y.encodeStateAsUpdate`, `Y.encodeStateVector`, deltas) — a real
//     workout for `@gjsify/buffer`'s `Buffer`/`Uint8Array` interop.
//   - **`Map` / `Set` / `WeakMap`** for the delete-set + transaction
//     bookkeeping — SpiderMonkey 140 native, no polyfill, but a useful
//     stability canary for the JS-level data structures.
//   - **`crypto.getRandomValues`** for clientID generation — `Y.Doc`
//     allocates a random 32-bit clientID via `crypto.getRandomValues`
//     on construction (browser path; on Node the upstream code uses
//     `crypto.randomBytes`). `--globals auto` picks this up via the
//     `Math.random` / `crypto` getRandomValues marker.
//   - **EventEmitter-shaped observers** (`ytype.observe(handler)`,
//     `ydoc.on('update', handler)`) — though Yjs ships its own
//     `lib0/observable` mini-EventEmitter, so this exercises the JS
//     class semantics rather than `@gjsify/events` directly.
//   - **`y-protocols/awareness`** — the standard Yjs sync companion.
//     Awareness messages are exchanged on the same wire as document
//     updates and are how every Yjs-backed editor knows who's online
//     and where their cursor is.
//
// What's intentionally NOT covered here:
//   - Multi-user TestConnector simulations from the upstream suite — they
//     depend on `lib0/prng` randomness + complex internal state and
//     mostly probe Yjs's own correctness, not the GJS substrate. We
//     reduce each multi-user scenario to a deterministic 2- or 3-doc
//     sync via `Y.applyUpdate(b, Y.encodeStateAsUpdate(a))` — the same
//     wire-shape every real Yjs deployment uses.
//
// Build: defaults — `--globals auto` picks up Uint8Array, DataView,
// performance, crypto.getRandomValues, etc. directly. No explicit
// extras needed: Yjs's encoder/decoder stays in pure-ES territory.

import { run } from '@gjsify/unit';
import yTextSuite from './y-text.spec.js';
import yArraySuite from './y-array.spec.js';
import yMapSuite from './y-map.spec.js';
import yXmlSuite from './y-xml.spec.js';
import docSuite from './doc.spec.js';
import updatesSyncSuite from './updates-sync.spec.js';
import undoManagerSuite from './undo-manager.spec.js';
import awarenessSuite from './awareness.spec.js';

run({
    yTextSuite,
    yArraySuite,
    yMapSuite,
    yXmlSuite,
    docSuite,
    updatesSyncSuite,
    undoManagerSuite,
    awarenessSuite,
});
