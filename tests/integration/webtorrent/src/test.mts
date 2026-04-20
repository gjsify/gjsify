// Integration-test entry for @gjsify/integration-webtorrent.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// `@gjsify/node-globals/register` pins timers with GLib.Source GC and
// registers the Node-style Buffer/process/URL globals that webtorrent's
// fs-chunk-store and bittorrent-protocol expect.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import selectionsSuite from './selections.spec.js';
import rarityMapSuite from './rarity-map.spec.js';
import clientDestroySuite from './client-destroy.spec.js';
import bitfieldSuite from './bitfield.spec.js';
import fileBufferSuite from './file-buffer.spec.js';
import iteratorSuite from './iterator.spec.js';
import clientAddSuite from './client-add.spec.js';

run({
  selectionsSuite,
  rarityMapSuite,
  clientDestroySuite,
  bitfieldSuite,
  fileBufferSuite,
  iteratorSuite,
  clientAddSuite,
});
