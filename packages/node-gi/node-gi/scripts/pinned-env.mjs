// SPDX-License-Identifier: MIT
// `node scripts/pinned-env.mjs <node args…>` — run node with the environment this
// package's own test scripts pin: `LC_ALL=C`, and `NODE_GI_NATIVE=build` so local
// verification exercises the JUST-BUILT addon rather than a staged prebuild
// (see `nativeCandidates` in native-paths.js).
//
// The scripts used to spell that as a `LC_ALL=C NODE_GI_NATIVE=build node …`
// prefix, which cmd.exe has no form of: `npm test` on Windows died with
// "'LC_ALL' is not recognized" before running a test. This package is not a
// workspace member and has no `gjsify` to call `gjsify env` through, so the
// same thing is done here with nothing but node.

import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C', NODE_GI_NATIVE: 'build' },
});
if (r.error) throw r.error;
process.exit(r.status ?? 1);
