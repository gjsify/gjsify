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
// `test:e2e` is no longer a hand-maintained list — `scripts/e2e-suites.mjs`'s
// `listE2eSuites()` DISCOVERS it from `tests/e2e/*/`, so a suite can no longer go
// unaccounted for by being left off a script edit: every on-disk suite lands in the
// parallel batch by default. What discovery cannot infer is WHY a suite should be kept
// out of that default — two ledgers say so, each machine-checked here:
// `scripts/e2e-unlisted-suites.mjs` (excluded from `test:e2e` entirely) and
// `scripts/e2e-serial-suites.mjs` (included, but run alone, never concurrently).
//
// THE SAME INCIDENT ONE LEVEL DOWN
//
// The directions below took the SUITE as the unit: a directory with a `run.mjs`. Measured
// 2026-09-19, that let the same gap reopen inside a directory this file called covered.
// `tests/e2e/cli-only/` is listed, and `check-deps.mjs` and `showcase.mjs` sit beside its
// `run.mjs`, define tests with `node:test`, are named by no script and imported by no suite.
// Both ran nowhere and had for as long as they existed — `check-deps.mjs` is the only thing
// asserting what `gjsify system-check` prints, cited as the guard in ADR 0012 and (before it
// was noticed) in ADR 0063. A unit that is a directory cannot see a file. `listE2eSuites()`
// now closes this structurally: a sibling `*.mjs` file importing `node:test` is discovered
// as its own entry unless `run.mjs` itself imports it — see that module's header.
//
// WHAT IT CHECKS, four directions
//
//   1. a ledger entry (either ledger) whose directory no longer exists  → FAIL (stale deferral)
//   2. a ledger entry with no usable reason                             → FAIL (the ledger's point)
//   3. a suite name in BOTH ledgers                                     → FAIL (contradiction —
//      "excluded entirely" and "included, run alone" cannot both be true)
//   4. a test FILE in a suite dir that nothing discovers                → FAIL (the gap, one level
//      down — kept as a direct check because it is what caught the incident above, even though
//      `listE2eSuites()`'s own convention now makes the gap it guards structurally rare)
//
// (1) and (2) keep the ledgers from becoming where omissions go to die — an entry cannot
// outlive its cause, as with the retired `PREBUILD_GIR_GAPS` and `unchecked-fields.mjs` — and
// every entry is PRINTED on every run, so deferrals stay visible rather than merely recorded.
//
// Usage: node scripts/check-e2e-suite-coverage.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_SERIAL_SUITES } from './e2e-serial-suites.mjs';
import { E2E_UNLISTED_SUITES } from './e2e-unlisted-suites.mjs';
import { listE2eSuites } from './e2e-suites.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

function fail(lines) {
    console.error(`check-e2e-suite-coverage: ${lines.join('\n  ')}`);
    process.exit(1);
}

const e2eDir = join(ROOT, 'tests', 'e2e');
const { onDisk, parallel, serial } = listE2eSuites({ root: ROOT });

const problems = [];

function checkLedger(name, ledger, otherLedgerName, otherLedger) {
    for (const [suite, reason] of Object.entries(ledger)) {
        if (!existsSync(join(e2eDir, suite, 'run.mjs'))) {
            problems.push(`${name} names "${suite}", which has no tests/e2e/${suite}/run.mjs. Delete the entry.`);
        }
        if (typeof reason !== 'string' || reason.trim().length < 40) {
            problems.push(
                `${name} entry "${suite}" has no usable reason. It must say what the suite NEEDS ` +
                    'that test:e2e does not provide — not that it is slow, and not that it fails.',
            );
        }
        if (suite in otherLedger) {
            problems.push(
                `"${suite}" is in BOTH ${name} and ${otherLedgerName} — it cannot be excluded from ` +
                    'test:e2e entirely and also included-but-serial. Pick one.',
            );
        }
    }
}

checkLedger('scripts/e2e-unlisted-suites.mjs', E2E_UNLISTED_SUITES, 'scripts/e2e-serial-suites.mjs', E2E_SERIAL_SUITES);
checkLedger('scripts/e2e-serial-suites.mjs', E2E_SERIAL_SUITES, 'scripts/e2e-unlisted-suites.mjs', E2E_UNLISTED_SUITES);

// 4. A test FILE beside a suite's `run.mjs` that no discovered entry and no suite import
// reaches — the same reachability test `listE2eSuites()` itself uses, run independently
// here so a bug in that module's convention still gets caught rather than laundered
// through the thing it is supposed to check.
const importsOf = (src) => {
    const specs = new Set();
    for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    return specs;
};

const discoveredEntries = new Set([...parallel, ...serial]);
let suiteFiles = 0;
for (const name of onDisk) {
    if (name in E2E_UNLISTED_SUITES) continue;
    const dir = join(e2eDir, name);
    const pulled = importsOf(readFileSync(join(dir, 'run.mjs'), 'utf8'));
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.mjs') || file === 'run.mjs') continue;
        const source = readFileSync(join(dir, file), 'utf8');
        if (!/\bfrom\s*['"]node:test['"]/.test(source)) continue;
        suiteFiles++;
        const rel = `tests/e2e/${name}/${file}`;
        if (discoveredEntries.has(rel) || pulled.has(`./${file}`)) continue;
        problems.push(
            `${rel} defines tests with \`node:test\` and runs NOWHERE — listE2eSuites() did not ` +
                `discover it and tests/e2e/${name}/run.mjs does not import it. This should not be ` +
                'reachable given the discovery convention in scripts/e2e-suites.mjs; if it is, that ' +
                'module has a bug.',
        );
    }
}

if (problems.length > 0) {
    fail([`${problems.length} problem(s):`, ...problems]);
}

// `parallel.length + serial.length` is deliberately not the headline alone: it also
// counts sibling entries beside a suite's run.mjs (cli-only's check-deps.mjs/showcase.mjs),
// so quoting it beside `onDisk.length` invites reading two different units as one.
console.log(
    `check-e2e-suite-coverage: ${onDisk.length} suite director${onDisk.length === 1 ? 'y' : 'ies'} on disk, ` +
        `${parallel.length} parallel + ${serial.length} serial entr${parallel.length + serial.length === 1 ? 'y' : 'ies'} discovered, ` +
        `${suiteFiles} extra test file(s) beside a run.mjs all reachable, ` +
        `${Object.keys(E2E_UNLISTED_SUITES).length} deliberately unlisted, 0 unaccounted for.`,
);
for (const [name, reason] of Object.entries(E2E_UNLISTED_SUITES)) {
    console.log(`  unlisted  ${name}: ${reason}`);
}
for (const [name, reason] of Object.entries(E2E_SERIAL_SUITES)) {
    console.log(`  serial    ${name}: ${reason}`);
}
