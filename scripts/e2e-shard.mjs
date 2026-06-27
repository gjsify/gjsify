#!/usr/bin/env node
// E2E shard runner — splits the EXACT suite set of the `test:e2e` npm script
// across N parallel CI jobs.
//
//   node scripts/e2e-shard.mjs <index> <total>     # run shard <index> of <total> (1-based)
//   E2E_SHARD_LIST=1 node scripts/e2e-shard.mjs <index> <total>   # print the selection, run nothing
//
// The suite set is parsed from `package.json#scripts.test:e2e` — NOT globbed
// from tests/e2e/* — so it stays exactly in lockstep with the curated list.
// (Some suite dirs are intentionally NOT in test:e2e, e.g. terminal-native,
// which needs its own `gjsify run build` to produce a probe; a glob would wrongly
// run them.) The script shape is:
//   node --test --test-concurrency=4 <parallel .mjs...> && node --test <serial> && node --test <serial>
// The first `&&` segment is the parallel batch (incl. tests/lint-engines.mjs);
// each later segment is a serial suite that must run ALONE (global machine
// state: flatpak-sdk-extension drives flatpak-builder, self-host rebuilds the
// workspace). Parallel suites are round-robin sharded by sorted path; serial
// suites are pinned one-per-shard and run alone after that shard's batch.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const index = Number(process.argv[2]);
const total = Number(process.argv[3]);
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    console.error(`e2e-shard: invalid shard "${process.argv[2]}/${process.argv[3]}" — expected <index>/<total> (1-based, 1 <= index <= total).`);
    process.exit(1);
}

const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts?.['test:e2e'];
if (!script) {
    console.error('e2e-shard: no "test:e2e" script in package.json.');
    process.exit(1);
}

// `&&`-separated commands: segment 0 = the parallel batch, the rest = serial.
const segments = script.split('&&').map((s) => s.trim());
const extractPaths = (seg) => seg.match(/tests\/\S+?\.mjs/g) ?? [];
const allParallel = [...extractPaths(segments[0])].sort();
const serial = segments.slice(1).flatMap(extractPaths); // order preserved

// lint-engines asserts every example package has built dist → it needs the
// example-dist artifact, which ONLY shard 1 downloads. So pin it to shard 1
// instead of letting round-robin scatter it onto a shard without the artifact.
const PINNED_SHARD1 = ['tests/lint-engines.mjs'];
const parallel = allParallel.filter((p) => !PINNED_SHARD1.includes(p));

// Round-robin the parallel batch across shards by sorted position.
const myParallel = parallel.filter((_, i) => i % total === index - 1);
if (index === 1) myParallel.unshift(...allParallel.filter((p) => PINNED_SHARD1.includes(p)));
// Pin each serial suite to a shard (round-robin over the serial list).
const mySerial = serial.filter((_, i) => i % total === index - 1);

const abs = (p) => join(ROOT, p);

if (process.env.E2E_SHARD_LIST === '1') {
    console.log(`[e2e-shard] shard ${index}/${total} of ${parallel.length} parallel + ${serial.length} serial`);
    console.log(`  parallel (${myParallel.length}): ${myParallel.join(', ') || '(none)'}`);
    console.log(`  serial   (${mySerial.length}): ${mySerial.join(', ') || '(none)'}`);
    process.exit(0);
}

console.log(`[e2e-shard] shard ${index}/${total}: ${myParallel.length} parallel + ${mySerial.length} serial suite(s)`);

let failed = false;

// Parallel-safe batch (process-per-file pool; the 2-core runner's default
// concurrency is 1, so the explicit flag is what gives any speedup).
if (myParallel.length > 0) {
    const r = spawnSync('node', ['--test', '--test-concurrency=4', ...myParallel.map(abs)], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (r.status !== 0) failed = true;
}

// Serial suites — one at a time, never concurrent with anything.
for (const p of mySerial) {
    const r = spawnSync('node', ['--test', abs(p)], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
