// Integration-test entry for @gjsify/integration-cosmiconfig.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// cosmiconfig uses fs/path heavily and goes through dynamic
// `import(file://…)` for .js/.mjs/.cjs config files (the GJS-sensitive
// path that mirrors @gjsify/cli/src/config.ts).
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (timers, queueMicrotask,
// process here).

import { run } from '@gjsify/unit';
import jsLoaderSuite from './js-loader.spec.js';
import jsonLoaderSuite from './json-loader.spec.js';
import moduleNameSuite from './module-name.spec.js';
import cacheAndClearSuite from './cache-and-clear.spec.js';
import transformSuite from './transform.spec.js';

run({
  jsonLoaderSuite,
  jsLoaderSuite,
  moduleNameSuite,
  cacheAndClearSuite,
  transformSuite,
});
