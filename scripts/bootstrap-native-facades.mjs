#!/usr/bin/env node
// Bootstraps the JS facades of the GI-bridge bundler engines on a
// truly-zero-cache workspace (fresh clone + install, CI after cache
// eviction, or after `gjsify run clear`):
//
//   - @gjsify/rolldown-native    (packages/infra/rolldown-native/lib/)
//   - @gjsify/lightningcss-native (packages/infra/lightningcss-native/lib/)
//
// Why this script exists (and why it runs under NODE):
//
//   Under GJS, `gjsify build --library` needs the native bundler engine —
//   whose JS facade (`lib/esm/`) is itself a build artifact. Building the
//   facade needs a bundler → circular under GJS. The Node CLI
//   (`packages/infra/cli/lib/index.js`) uses npm `rolldown` instead, so it
//   can build the facades without the facades existing. Spawning
//   `node <cli>/lib/index.js` directly (NOT `gjsify workspace … build`)
//   matters: the inner script chain would resolve `gjsify` from PATH = the
//   GJS-first bin shim, recreating the circularity. Same pattern + rationale
//   as `packages/infra/tsc/scripts/build-bundle.mjs` (commit 857e34742).
//
//   This makes `node` a documented requirement of root `build:infra` — the
//   accepted, established exception (same as @gjsify/tsc's bundle build and
//   @gjsify/cli's build:gjs-bundle, both of which already spawn node).
//
// Wired into root package.json `build:infra` right after
// `gjsify workspace @gjsify/cli build` (which produces the Node CLI entry
// via plain tsc) and before the first `gjsify build --library` consumer
// (`@gjsify/utils`).
//
// Skips a facade when its lib/ output already exists AND is newer than
// everything under its src/ts/ — a full rebuild is only ~10-20 s, but
// skipping keeps warm-cache `build:infra` runs fast.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cliEntry = join(root, 'packages', 'infra', 'cli', 'lib', 'index.js');

const FACADES = ['rolldown-native', 'lightningcss-native'];

if (!existsSync(cliEntry)) {
    console.error(
        `[bootstrap-native-facades] Node CLI entry not found: ${cliEntry}\n` +
            'Run `gjsify workspace @gjsify/cli build` first (build:infra does this).',
    );
    process.exit(1);
}

/** Newest mtime (ms) of any file under dir, recursively. 0 when dir is missing/empty. */
function newestMtime(dir) {
    if (!existsSync(dir)) return 0;
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        const t = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
        if (t > newest) newest = t;
    }
    return newest;
}

function run(args, cwd) {
    const r = spawnSync(process.execPath, [cliEntry, ...args], { stdio: 'inherit', cwd });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] \`node cli ${args.join(' ')}\` failed in ${cwd} ` +
                `(exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`,
        );
        process.exit(r.status ?? 1);
    }
}

for (const name of FACADES) {
    const pkgDir = join(root, 'packages', 'infra', name);
    const srcDir = join(pkgDir, 'src', 'ts');
    const libEntry = join(pkgDir, 'lib', 'esm', 'index.js');
    const typesEntry = join(pkgDir, 'lib', 'types', 'index.d.ts');

    const fresh =
        existsSync(libEntry) &&
        existsSync(typesEntry) &&
        Math.min(statSync(libEntry).mtimeMs, statSync(typesEntry).mtimeMs) >= newestMtime(srcDir);
    if (fresh) {
        console.log(`[bootstrap-native-facades] @gjsify/${name}: lib/ up to date — skipping`);
        continue;
    }

    const t0 = Date.now();
    console.log(`[bootstrap-native-facades] building @gjsify/${name} facade via node CLI…`);
    run(['build', '--library', 'src/ts/**/*.{ts,js}'], pkgDir);
    run(['tsc'], pkgDir);
    console.log(`[bootstrap-native-facades] @gjsify/${name} done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}
