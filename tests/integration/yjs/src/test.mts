// Integration-test entry for @gjsify/integration-yjs.
//
// Unlike Loro (Rust → WASM, in the sibling `tests/integration/loro-crdt/` suite), Yjs is pure
// JavaScript, so it stresses a different cross-section of the GJS engine: heavy
// `Uint8Array`/`DataView` traffic for the binary wire format (a real workout for
// `@gjsify/buffer`'s interop), and `crypto.getRandomValues` for the 32-bit clientID `Y.Doc`
// allocates on construction, which `--globals auto` picks up from that marker.
//
// NOT covered: the upstream multi-user TestConnector simulations. They depend on `lib0/prng`
// randomness plus complex internal state and mostly probe Yjs's own correctness, not the GJS
// substrate, so each is reduced to a deterministic 2- or 3-doc
// `Y.applyUpdate(b, Y.encodeStateAsUpdate(a))` — the wire shape every real deployment uses.
//
// Build: defaults. Yjs's encoder/decoder stays in pure-ES territory, so `--globals auto`
// needs no explicit extras.

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
