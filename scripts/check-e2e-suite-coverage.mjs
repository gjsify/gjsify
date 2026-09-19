#!/usr/bin/env node
// Every e2e suite on disk either RUNS or says why not.
//
// THE INCIDENT
//
// `package.json#scripts.test:e2e` listed 100 suite paths while 112 existed on disk, so 12
// ran nowhere — no shard, no workflow, no local `run test:e2e`. Eleven were oversights and
// all eleven pass unchanged. Two show the cost: `gjs-less-host` covers the Node-free host
// path, exactly where a released `gjsify lint` regression had just been found, and
// `release-bundle-gate` was written to cover the release gate that let v0.28.0 publish
// `cli`/`node-gi`/`napi` while its three GTK bundles stayed a version behind — its PR body
// claimed the suite WAS the pre-release coverage, and it was in no script.
//
// `e2e-shard.mjs` parses the script instead of globbing, deliberately and correctly — a
// suite CAN need setup the shared batch does not do. The missing half was a record of
// which omissions were meant, which `e2e-unlisted-suites.mjs` now carries.
//
// THE SAME INCIDENT ONE LEVEL DOWN
//
// The directions below took the SUITE as the unit: a directory with a `run.mjs`. Measured
// 2026-09-19, that let the same gap reopen inside a directory this file called covered.
// `tests/e2e/cli-only/` is listed, and `check-deps.mjs` and `showcase.mjs` sit beside its
// `run.mjs`, define tests with `node:test`, are named by no script and imported by no suite.
// Both ran nowhere and had for as long as they existed — `check-deps.mjs` is the only thing
// asserting what `gjsify system-check` prints, cited as the guard in ADR 0012 and (before it
// was noticed) in ADR 0063. A unit that is a directory cannot see a file.
//
// WHAT IT CHECKS, four directions
//
//   1. a suite on disk that is neither listed nor ledgered      → FAIL (the silent gap)
//   2. a ledger entry that IS listed                            → FAIL (self-retiring)
//   3. a ledger entry whose directory no longer exists          → FAIL (stale deferral)
//   4. a test FILE in a suite dir that nothing runs             → FAIL (the gap, one level down)
//
// (2) and (3) keep the ledger from becoming where omissions go to die — an entry cannot
// outlive its cause, as with the retired `PREBUILD_GIR_GAPS` and `unchecked-fields.mjs` — and every
// entry is PRINTED on every run, so deferrals stay visible rather than merely recorded.
//
// Usage: node scripts/check-e2e-suite-coverage.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_UNLISTED_SUITES } from './e2e-unlisted-suites.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

function fail(lines) {
    console.error(`check-e2e-suite-coverage: ${lines.join('\n  ')}`);
    process.exit(1);
}

const manifestPath = join(ROOT, 'package.json');
let script;
try {
    script = JSON.parse(readFileSync(manifestPath, 'utf8')).scripts?.['test:e2e'];
} catch (error) {
    fail([`cannot read ${manifestPath}: ${error.message}`]);
}
if (typeof script !== 'string' || script.length === 0) {
    fail([`no "test:e2e" script in ${manifestPath} — nothing to compare suites against.`]);
}

/** Suite entry-point paths named by the script, in the same shape e2e-shard.mjs parses. */
const listed = new Set(script.match(/tests\/\S+?\.mjs/g) ?? []);

/** Suite directories under tests/e2e/ that carry a run.mjs — the runnable set. */
const e2eDir = join(ROOT, 'tests', 'e2e');
let onDisk;
try {
    onDisk = readdirSync(e2eDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(e2eDir, entry.name, 'run.mjs')))
        .map((entry) => entry.name)
        .sort();
} catch (error) {
    fail([`cannot read ${e2eDir}: ${error.message}`]);
}

const problems = [];

// 1. On disk, not listed, not ledgered.
const unaccounted = onDisk.filter((name) => !listed.has(`tests/e2e/${name}/run.mjs`) && !(name in E2E_UNLISTED_SUITES));
for (const name of unaccounted) {
    problems.push(
        `tests/e2e/${name}/ runs NOWHERE — it is not in package.json#scripts.test:e2e and not in ` +
            'scripts/e2e-unlisted-suites.mjs. Add it to the script, or add an entry saying what it ' +
            'needs that the shared batch does not provide.',
    );
}

for (const [name, reason] of Object.entries(E2E_UNLISTED_SUITES)) {
    // 2. Ledgered AND listed — the deferral outlived its cause.
    if (listed.has(`tests/e2e/${name}/run.mjs`)) {
        problems.push(
            `tests/e2e/${name}/ is in scripts/e2e-unlisted-suites.mjs AND in test:e2e. It runs, so ` +
                'delete the entry — a ledger that keeps satisfied entries stops meaning anything.',
        );
    }
    // 3. Ledgered but gone.
    if (!existsSync(join(e2eDir, name, 'run.mjs'))) {
        problems.push(
            `scripts/e2e-unlisted-suites.mjs names "${name}", which has no tests/e2e/${name}/run.mjs. ` +
                'Delete the entry.',
        );
    }
    // The reason is the entire point of the entry, so an empty one is a failure too.
    if (typeof reason !== 'string' || reason.trim().length < 40) {
        problems.push(
            `scripts/e2e-unlisted-suites.mjs entry "${name}" has no usable reason. It must say what the ` +
                'suite NEEDS that test:e2e does not provide — not that it is slow, and not that it fails.',
        );
    }
}

// 4. A test FILE beside a suite's `run.mjs` that no script names and no suite imports.
//
// `node:test` is what makes a file a test rather than a fixture or a helper: a helper does not
// import it, and a test file cannot avoid it. The reachability test is the suite's own static
// imports, because that is the only way a sibling gets run without being named by a script.
const importsOf = (src) => {
    const specs = new Set();
    for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    return specs;
};

let suiteFiles = 0;
for (const name of onDisk) {
    const dir = join(e2eDir, name);
    const pulled = importsOf(readFileSync(join(dir, 'run.mjs'), 'utf8'));
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.mjs') || file === 'run.mjs') continue;
        const source = readFileSync(join(dir, file), 'utf8');
        if (!/\bfrom\s*['"]node:test['"]/.test(source)) continue;
        suiteFiles++;
        const rel = `tests/e2e/${name}/${file}`;
        if (listed.has(rel) || pulled.has(`./${file}`)) continue;
        problems.push(
            `${rel} defines tests with \`node:test\` and runs NOWHERE — package.json#scripts.test:e2e ` +
                `does not name it and tests/e2e/${name}/run.mjs does not import it. Add it to the ` +
                'script beside its suite, or import it from that run.mjs. The ledger is for ' +
                'DIRECTORIES and does not cover a file.',
        );
    }
}

if (problems.length > 0) {
    fail([`${problems.length} problem(s):`, ...problems]);
}

// `listed.size` is deliberately not the headline: the script also names paths outside
// tests/e2e/ (`tests/lint-engines.mjs`), so quoting it beside the directory count invites
// reading two different sets as one.
const deferred = Object.entries(E2E_UNLISTED_SUITES);
const running = onDisk.filter((name) => listed.has(`tests/e2e/${name}/run.mjs`)).length;
console.log(
    `check-e2e-suite-coverage: ${running}/${onDisk.length} e2e suite(s) run, ` +
        `${suiteFiles} extra test file(s) beside a run.mjs all reachable, ` +
        `${deferred.length} deliberately unlisted, 0 unaccounted for.`,
);
for (const [name, reason] of deferred) {
    console.log(`  ${name}: ${reason}`);
}
