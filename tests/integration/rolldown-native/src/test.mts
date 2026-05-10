// Integration entry for @gjsify/integration-rolldown-native.
// Build once via `gjsify build src/test.mts --app gjs`, then run via
// `gjsify run dist/test.gjs.mjs`.
//
// Locks in the Phase D-2.B contract end-to-end:
//   B.2 — all 12 hooks fire, idFilter regex short-circuits
//   B.3 — nested protocol (this.resolve / this.warn) round-trips
//   B.5a — bundleWithPlugins() Promise facade hides session wiring

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import bundleWithPluginsSuite from './bundle-with-plugins.spec.js';

run({
    bundleWithPluginsSuite,
});
