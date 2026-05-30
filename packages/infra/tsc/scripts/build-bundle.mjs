#!/usr/bin/env node
// Builds the `dist/tsc.gjs.mjs` bundle by running `gjsify build --app gjs`
// against upstream typescript's `_tsc.js` CLI entry (the real CLI; `tsc.js`
// is just a Node-only `enableCompileCache` shim that we skip).
//
// Why a Node script and not a plain script-string in package.json:
//
//   - We resolve `typescript/package.json` (not `lib/_tsc.js` directly) so
//     pnpm/yarn-PnP can find the hoisted copy from anywhere in the workspace.
//   - We log the version, byte size and time, mirroring the rest of the
//     gjsify build-scripts (cli/build:gjs-bundle, rolldown-plugin-gjsify
//     post-build) so CI logs stay consistent.
//   - The `gjsify` CLI runs through node_modules/.bin so it works whether
//     we're run from this package dir or via `gjsify workspace @gjsify/tsc
//     build` from the workspace root.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

// Resolve typescript from this package's dependency tree.
const tsPkgPath = require.resolve('typescript/package.json');
const tsRoot = dirname(tsPkgPath);
const tsVersion = JSON.parse(
    spawnSync('cat', [tsPkgPath], { encoding: 'utf-8' }).stdout,
).version;
const entry = join(tsRoot, 'lib', '_tsc.js');

const outfile = join(pkgRoot, 'dist', 'tsc.gjs.mjs');

console.log(`[@gjsify/tsc] bundling typescript@${tsVersion}`);
console.log(`             entry  : ${entry}`);
console.log(`             outfile: ${outfile}`);

// Prefer the workspace-local `gjsify` (Node entry, lib/index.js) over any
// globally installed one — the global is the GJS bundle, which today still
// requires `rolldown` to be reachable via its own resolution walker and
// may not find it when invoked from inside a sub-package. The workspace
// shim spawns Node + lib/index.js directly, which resolves rolldown from
// the local node_modules without surprises.
const env = {
    ...process.env,
    PATH: `${join(pkgRoot, '..', '..', '..', 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
};

const t0 = Date.now();
const r = spawnSync(
    'gjsify',
    ['build', entry, '--app', 'gjs', '--outfile', outfile, '--shebang'],
    { stdio: 'inherit', cwd: pkgRoot, env },
);
if (r.status !== 0) {
    console.error(`[@gjsify/tsc] build failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
}
const dt = ((Date.now() - t0) / 1000).toFixed(2);
const bytes = statSync(outfile).size;
const mib = (bytes / 1024 / 1024).toFixed(2);
console.log(`[@gjsify/tsc] done in ${dt}s — ${mib} MiB (${bytes} B)`);
