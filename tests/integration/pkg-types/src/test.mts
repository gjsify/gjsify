// Integration-test entry for @gjsify/integration-pkg-types.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// pkg-types and get-tsconfig both rely on fs/path heavily and read
// process.cwd() through internal helpers.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import pkgTypesReadSuite from './pkg-types-read.spec.js';
import pkgTypesWriteSuite from './pkg-types-write.spec.js';
import getTsconfigBasicSuite from './get-tsconfig-basic.spec.js';
import getTsconfigExtendsSuite from './get-tsconfig-extends.spec.js';
import getTsconfigPathsSuite from './get-tsconfig-paths.spec.js';

run({
  pkgTypesReadSuite,
  pkgTypesWriteSuite,
  getTsconfigBasicSuite,
  getTsconfigExtendsSuite,
  getTsconfigPathsSuite,
});
