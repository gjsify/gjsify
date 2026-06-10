// Integration entry for @gjsify/integration-oxfmt-native.
// Build once via `gjsify build src/test.mts --app gjs`, then run via
// `gjsify run dist/test.gjs.mjs` (which auto-sets GI_TYPELIB_PATH /
// LD_LIBRARY_PATH from the workspace's @gjsify/oxfmt-native prebuild).
//
// Locks in the Node-free `gjsify format` contract end-to-end:
//   - hasNativeOxfmt() loads the GjsifyOxfmt typelib
//   - format() single-shot in-memory formatting
//   - runOxfmt() full in-process CLI: --write / --check /
//     --list-different exit codes + on-disk effects + `.oxfmtrc.json`
//     honoring via --config (the npm-launcher parity surface)
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import nativeOxfmtSuite from './native-oxfmt.spec.js';

run({
    nativeOxfmtSuite,
});
