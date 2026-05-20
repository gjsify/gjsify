// Integration-test entry for @gjsify/integration-deepkit-type-compiler.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that @deepkit/type-compiler — the TypeScript transformer
// consumed by @gjsify/rolldown-plugin-deepkit — runs end-to-end on GJS.
// Pillars exercised: the TypeScript Compiler API surface that
// @marcj/ts-clone-node + Deepkit's reflection emitter walk
// (Program, SourceFile, Printer, custom transformers).
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import loaderSuite from './loader.spec.js';
import transformSuite from './transform.spec.js';

run({
  loaderSuite,
  transformSuite,
});
