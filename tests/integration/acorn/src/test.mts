// Integration-test entry for @gjsify/integration-acorn.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that acorn (ECMAScript parser) + acorn-walk (AST visitor) — both
// pure JS — run end-to-end on GJS. Acts as a Phase D-1 canary for the core
// SpiderMonkey 140 + @gjsify/* JS path: no GNOME deps, no streams, no fs.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import parseBasicSuite from './parse-basic.spec.js';
import parseStrictSuite from './parse-strict.spec.js';
import walkBasicSuite from './walk-basic.spec.js';
import walkRecursiveSuite from './walk-recursive.spec.js';
import errorPositionsSuite from './error-positions.spec.js';

run({
  parseBasicSuite,
  parseStrictSuite,
  walkBasicSuite,
  walkRecursiveSuite,
  errorPositionsSuite,
});
