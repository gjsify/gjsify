// SPDX-License-Identifier: MIT
// `node test/gjs-gate.mjs <gate.js> [args…]` — run a gate under gjs against the
// in-tree `build/` (its typelib and its shared library).
//
// The scripts used to spell that as a `GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build
// gjs …` prefix, which cmd.exe has no form of. This package is not a workspace
// member and has no `gjsify` to call `gjsify env` through, so the same thing is
// done here with nothing but node.

import { spawnSync } from 'node:child_process';

const r = spawnSync('gjs', process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, GI_TYPELIB_PATH: 'build', LD_LIBRARY_PATH: 'build' },
});
if (r.error) throw r.error;
process.exit(r.status ?? 1);
