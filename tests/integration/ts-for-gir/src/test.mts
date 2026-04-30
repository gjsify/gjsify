// Integration-test entry for @gjsify/integration-ts-for-gir.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// No `@gjsify/node-globals/register` import — bundle stays minimal.
// `gjsify build` defaults to `--globals auto`, scanning the bundled
// output and injecting only the granular /register subpaths actually
// referenced. The parser surface is pure ES + fast-xml-parser, so no
// global injection is expected.

import { run } from '@gjsify/unit';
import parserSuite from './parser.spec.js';
import libSuite from './lib.spec.js';
import generatorSuite from './generator.spec.js';
import cliSuite from './cli.spec.js';

run({
  parserSuite,
  libSuite,
  generatorSuite,
  cliSuite,
});
