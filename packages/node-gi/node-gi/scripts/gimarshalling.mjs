// SPDX-License-Identifier: MIT
// Launcher for the tier-B conformance oracle (the GJS installed-tests port
// under gimarshalling/). Builds the pinned GI test typelibs if missing, then
// runs `node --test` over the port files with the env dlopen needs:
//
//   GI_TYPELIB_PATH   — so GIRepository finds GIMarshallingTests-1.0.typelib
//   LD_LIBRARY_PATH   — so libgimarshallingtests.so dlopens; MUST be set before
//                       the child process starts (a late in-process env change
//                       is invisible to the dynamic loader)
//   NODE_GI_NATIVE    — defaults to `build` to pin the just-built addon
//
//   npm run test:gimarshalling
//
// The port files are named *.port.mjs ON PURPOSE: the name matches none of
// node's default test globs, so a plain `npm test` (`node --test` in the
// package root) never picks them up — they only run through this launcher,
// which passes the files explicitly. This launcher itself is not *.test.mjs
// for the same reason.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTypelibs, libDir } from './build-gi-test-typelibs.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const portDir = join(pkgRoot, 'gimarshalling');

try {
  ensureTypelibs();
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const portFiles = readdirSync(portDir)
  .filter((f) => f.endsWith('.port.mjs'))
  .sort()
  .map((f) => join(portDir, f));
if (portFiles.length === 0) {
  console.error(`gimarshalling: no *.port.mjs files under ${portDir}`);
  process.exit(1);
}

const prependPath = (existing) => (existing ? `${libDir}${delimiter}${existing}` : libDir);

const res = spawnSync(process.execPath, ['--test', ...portFiles], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    GI_TYPELIB_PATH: prependPath(process.env.GI_TYPELIB_PATH),
    LD_LIBRARY_PATH: prependPath(process.env.LD_LIBRARY_PATH),
    NODE_GI_NATIVE: process.env.NODE_GI_NATIVE ?? 'build',
  },
});
process.exit(res.status ?? 1);
