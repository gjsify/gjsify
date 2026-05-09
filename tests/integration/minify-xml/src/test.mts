// Integration-test entry for @gjsify/integration-minify-xml.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that minify-xml — the XML minifier consumed by
// @gjsify/vite-plugin-blueprint to compress generated XML output —
// runs end-to-end on GJS. Pillars exercised: pure-JS string
// manipulation + heavy lookbehind/lookahead RegExp surface (the entire
// minifier is ≈10 RegExp transforms over the input string).

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import basicSuite from './basic.spec.js';
import optionsSuite from './options.spec.js';
import edgeCasesSuite from './edge-cases.spec.js';

run({
  basicSuite,
  optionsSuite,
  edgeCasesSuite,
});
