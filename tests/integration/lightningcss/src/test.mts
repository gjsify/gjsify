// Integration-test entry for @gjsify/integration-lightningcss.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Locks in the byte-equality property the Phase D-2 lightningcss
// decision matrix (`docs/poc/lightningcss-decision.md`) rests on.
// Each runtime compares the two backends accessible to it and
// asserts identical output across a fixture corpus that exercises
// distinct lowering / minification paths.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import byteEqualitySuite from './byte-equality.spec.js';

run({
    byteEqualitySuite,
});
