#!/usr/bin/env node
// E2E shard runner — splits the EXACT suite set of the `test:e2e` npm script
// across N parallel CI jobs, balanced by measured duration.
//
//   node scripts/e2e-shard.mjs <index> <total>     # run shard <index> of <total> (1-based)
//   node scripts/e2e-shard.mjs --example-dist      # run the suites that need built example dist
//   E2E_SHARD_LIST=1 node scripts/e2e-shard.mjs …  # print the selection + estimated loads, run nothing
//   E2E_TIMINGS_OUT=<dir> node scripts/e2e-shard.mjs …   # also record per-suite durations into <dir>
//   node scripts/e2e-shard.mjs --refresh-timings <dir>…  # fold recorded durations into the timing file
//
// The suite set is parsed from `package.json#scripts.test:e2e`, NOT globbed from
// tests/e2e/*: some suite dirs are deliberately absent from it (the ledger is
// `scripts/e2e-unlisted-suites.mjs`) and a glob would run them anyway. Shape:
//   node --test --test-concurrency=4 <parallel .mjs...> && node --test <serial> && node --test <serial>
// Segment 0 is the parallel batch (incl. tests/lint-engines.mjs); each later
// segment is a serial suite that must run ALONE because it owns global machine
// state (flatpak-sdk-extension drives flatpak-builder, self-host rebuilds the
// workspace). Serial suites run one at a time after their shard's batch.
//
// BALANCED BY DURATION, not by list position. Round-robin over the sorted list
// measured shard 4 at 824 s against shard 3 at ~570 s (run 36433926348): the
// slowest shard is the E2E stage's wall time, so every second of imbalance is
// paid on the required gate's critical path. Each suite's weight comes from
// `scripts/e2e-shard-timings.json`; a suite missing from it (new, or renamed)
// weighs the MEDIAN of the known ones, so it is neither free nor a giant. The
// estimated wall time of a shard is
//   sum(parallel weights) / PARALLEL_CONCURRENCY + sum(serial weights)
// because the batch runs four files at a time and a serial suite runs alone.
// Suites are placed longest-first onto the currently lightest shard (ties: the
// lower shard index; equal weights: the path), which is deterministic for a
// given timing file and suite list. Every invocation recomputes the WHOLE
// assignment and checks it is a partition, so no suite can fall between shards.
//
// Refresh the timing file from a real run (the `e2e` job uploads one artifact
// per shard):
//   gh run download <run-id> --repo gjsify/gjsify -p 'e2e-timings-*' -D tmp/e2e-timings
//   E2E_TIMINGS_SOURCE='run <run-id>' node scripts/e2e-shard.mjs --refresh-timings tmp/e2e-timings
// A refresh replaces the measured suites, keeps the old figure for any suite that
// run did not measure, and drops suites no longer in `test:e2e`.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMINGS_FILE = join(ROOT, 'scripts', 'e2e-shard-timings.json');
const REPORTER = join(ROOT, 'scripts', 'e2e-timing-reporter.mjs');
// The 2-core runner's default concurrency is 1, so the explicit flag is what gives
// any speedup at all. The balancer's cost model reads the same constant.
const PARALLEL_CONCURRENCY = 4;

// lint-engines asserts every example package has built dist, so it needs the
// example-dist artifact. It runs in `main.yml`'s `examples-build` job, where that
// dist is produced, so no e2e shard has to wait for the examples build.
const EXAMPLE_DIST_SUITES = ['tests/lint-engines.mjs'];

function fatal(msg) {
    console.error(`e2e-shard: ${msg}`);
    process.exit(1);
}

function readSuites() {
    const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts?.['test:e2e'];
    if (!script) fatal('no "test:e2e" script in package.json.');
    // `&&`-separated commands: segment 0 = the parallel batch, the rest = serial.
    const segments = script.split('&&').map((s) => s.trim());
    const extractPaths = (seg) => seg.match(/tests\/\S+?\.mjs/g) ?? [];
    const allParallel = [...extractPaths(segments[0])].sort();
    const serial = segments.slice(1).flatMap(extractPaths); // order preserved
    const missing = EXAMPLE_DIST_SUITES.filter((p) => !allParallel.includes(p));
    if (missing.length) {
        fatal(`${missing.join(', ')} left the parallel batch of test:e2e — update EXAMPLE_DIST_SUITES.`);
    }
    return {
        parallel: allParallel.filter((p) => !EXAMPLE_DIST_SUITES.includes(p)),
        serial,
    };
}

function readTimings() {
    const data = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'));
    if (!data || typeof data.suites !== 'object') fatal(`${TIMINGS_FILE} has no "suites" object.`);
    return data;
}

function median(values) {
    if (values.length === 0) return 1;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Longest-first onto the lightest shard. Pure: same inputs, same assignment. */
function assignShards({ parallel, serial }, weights, total) {
    const fallback = median(Object.values(weights));
    const weightOf = (p) => weights[p] ?? fallback;
    const items = [
        ...parallel.map((p) => ({ path: p, serial: false, cost: weightOf(p) / PARALLEL_CONCURRENCY })),
        ...serial.map((p) => ({ path: p, serial: true, cost: weightOf(p) })),
    ].sort((a, b) => b.cost - a.cost || a.path.localeCompare(b.path));
    const shards = Array.from({ length: total }, () => ({ load: 0, parallel: [], serial: [] }));
    for (const item of items) {
        let best = 0;
        for (let i = 1; i < total; i++) if (shards[i].load < shards[best].load) best = i;
        shards[best].load += item.cost;
        shards[best][item.serial ? 'serial' : 'parallel'].push(item.path);
    }
    for (const s of shards) {
        s.parallel.sort();
        // Serial suites keep their `test:e2e` order within a shard.
        s.serial.sort((a, b) => serial.indexOf(a) - serial.indexOf(b));
    }
    const unknown = [...parallel, ...serial].filter((p) => !(p in weights));
    return { shards, unknown, fallback };
}

function assertPartition({ parallel, serial }, shards) {
    const seen = new Map();
    for (const s of shards) for (const p of [...s.parallel, ...s.serial]) seen.set(p, (seen.get(p) ?? 0) + 1);
    const bad = [...parallel, ...serial].filter((p) => seen.get(p) !== 1);
    if (bad.length || seen.size !== parallel.length + serial.length) {
        fatal(`shard assignment is not a partition of test:e2e (offending: ${bad.join(', ') || 'extra entries'}).`);
    }
}

function refreshTimings(dirs) {
    if (dirs.length === 0) fatal('--refresh-timings needs at least one directory of recorded timing files.');
    const measured = {};
    const walk = (p) => {
        if (statSync(p).isDirectory()) {
            for (const e of readdirSync(p)) walk(join(p, e));
            return;
        }
        if (!p.endsWith('.json')) return;
        for (const [file, ms] of Object.entries(JSON.parse(readFileSync(p, 'utf8')))) {
            measured[file] = Math.max(measured[file] ?? 0, ms);
        }
    };
    for (const d of dirs) walk(d);
    const { parallel, serial } = readSuites();
    const listed = [...parallel, ...serial];
    const old = readTimings();
    const suites = {};
    for (const p of [...listed].sort()) {
        const v = measured[p] ?? old.suites[p];
        if (v !== undefined) suites[p] = Math.round(v);
    }
    const hit = listed.filter((p) => p in measured).length;
    const out = {
        comment: old.comment,
        source: process.env.E2E_TIMINGS_SOURCE ?? old.source,
        suites,
    };
    writeFileSync(TIMINGS_FILE, `${JSON.stringify(out, null, 4)}\n`);
    console.log(`[e2e-shard] ${TIMINGS_FILE}: ${hit}/${listed.length} suite(s) measured, rest kept.`);
}

function nodeTest(paths, label, extraArgs = []) {
    const out = process.env.E2E_TIMINGS_OUT;
    const reporterArgs = [];
    if (out) {
        mkdirSync(out, { recursive: true });
        reporterArgs.push(
            '--test-reporter=spec',
            '--test-reporter-destination=stdout',
            `--test-reporter=${REPORTER}`,
            `--test-reporter-destination=${join(out, `${label}.json`)}`,
        );
    }
    const r = spawnSync('node', ['--test', ...extraArgs, ...reporterArgs, ...paths.map((p) => join(ROOT, p))], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    return r.status === 0;
}

const argv = process.argv.slice(2);
const listOnly = process.env.E2E_SHARD_LIST === '1';

if (argv[0] === '--refresh-timings') {
    refreshTimings(argv.slice(1));
    process.exit(0);
}

if (argv[0] === '--example-dist') {
    readSuites(); // asserts the suites are still listed in test:e2e
    console.log(`[e2e-shard] example-dist suites: ${EXAMPLE_DIST_SUITES.join(', ')}`);
    if (listOnly) process.exit(0);
    process.exit(nodeTest(EXAMPLE_DIST_SUITES, 'example-dist') ? 0 : 1);
}

const index = Number(argv[0]);
const total = Number(argv[1]);
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    fatal(`invalid shard "${argv[0]}/${argv[1]}" — expected <index>/<total> (1-based, 1 <= index <= total).`);
}

const suites = readSuites();
const { shards, unknown, fallback } = assignShards(suites, readTimings().suites, total);
assertPartition(suites, shards);
const mine = shards[index - 1];
const secs = (ms) => Math.round(ms / 1000);

if (unknown.length) {
    console.log(
        `[e2e-shard] ${unknown.length} suite(s) have no recorded duration and weigh the median ` +
            `(${Math.round(fallback)} ms): ${unknown.join(', ')}`,
    );
}

if (listOnly) {
    console.log(`[e2e-shard] ${suites.parallel.length} parallel + ${suites.serial.length} serial, ${total} shard(s)`);
    shards.forEach((s, i) => {
        console.log(`  shard ${i + 1}: ~${secs(s.load)} s estimated, ${s.parallel.length} + ${s.serial.length}`);
    });
    console.log(`  shard ${index} parallel (${mine.parallel.length}): ${mine.parallel.join(', ') || '(none)'}`);
    console.log(`  shard ${index} serial   (${mine.serial.length}): ${mine.serial.join(', ') || '(none)'}`);
    process.exit(0);
}

console.log(
    `[e2e-shard] shard ${index}/${total}: ${mine.parallel.length} parallel + ${mine.serial.length} serial ` +
        `suite(s), ~${secs(mine.load)} s estimated`,
);

let failed = false;
if (mine.parallel.length > 0) {
    if (!nodeTest(mine.parallel, `shard${index}-parallel`, [`--test-concurrency=${PARALLEL_CONCURRENCY}`])) {
        failed = true;
    }
}
// Serial suites — one at a time, never concurrent with anything.
for (const [i, p] of mine.serial.entries()) {
    if (!nodeTest([p], `shard${index}-serial${i + 1}`)) failed = true;
}

process.exit(failed ? 1 : 0);
