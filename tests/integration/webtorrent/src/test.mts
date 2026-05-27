// Integration-test entry for @gjsify/integration-webtorrent.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// webtorrent's fs-chunk-store and bittorrent-protocol expect Node-style
// Buffer/process/URL globals + timers with GLib.Source GC.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import selectionsSuite from './selections.spec.js';
import rarityMapSuite from './rarity-map.spec.js';
import clientDestroySuite from './client-destroy.spec.js';
import bitfieldSuite from './bitfield.spec.js';
import fileBufferSuite from './file-buffer.spec.js';
import iteratorSuite from './iterator.spec.js';
import clientAddSuite from './client-add.spec.js';
import wireTransferSuite from './wire-transfer.spec.js';

run({
    selectionsSuite,
    rarityMapSuite,
    clientDestroySuite,
    bitfieldSuite,
    fileBufferSuite,
    iteratorSuite,
    clientAddSuite,
    wireTransferSuite,
});
