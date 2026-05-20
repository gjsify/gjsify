// Integration-test entry for @gjsify/integration-minify-xml.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that minify-xml — the XML minifier consumed by
// @gjsify/vite-plugin-blueprint to compress generated XML output —
// runs end-to-end on GJS. Pillars exercised: pure-JS string
// manipulation + heavy lookbehind/lookahead RegExp surface (the entire
// minifier is ≈10 RegExp transforms over the input string).
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import basicSuite from './basic.spec.js';
import optionsSuite from './options.spec.js';
import edgeCasesSuite from './edge-cases.spec.js';

run({
  basicSuite,
  optionsSuite,
  edgeCasesSuite,
});
