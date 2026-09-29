#!/usr/bin/env node
// Discovers the e2e suite set from `tests/e2e/*/` instead of the hand-maintained
// `package.json#scripts.test:e2e` line it used to be. Measured 2026-09-27: 21 of the 36
// `package.json` commits since 2026-09-01 touched nothing but that one line, each adding
// or removing a suite path — and every one of them collided with every other PR that
// also touched it, because npm scripts are one string with no per-entry seam for git to
// merge. A suite directory (`tests/e2e/<name>/run.mjs`) already IS that seam.
//
// A discovered suite is one of three things, and every suite on disk is exactly one:
//
//   - PARALLEL (the default): runs inside `test:e2e`'s shared
//     `node --test --test-concurrency=4` batch.
//   - SERIAL (`scripts/e2e-serial-suites.mjs`): runs inside `test:e2e`, but ALONE, after
//     the parallel batch — the suite mutates global machine state a concurrent run would
//     corrupt.
//   - UNLISTED (`scripts/e2e-unlisted-suites.mjs`): excluded from `test:e2e` entirely —
//     needs an environment (a display, a session bus, a staged prebuild) the shared batch
//     does not provide.
//
// A suite directory can also hold more than one entry point: `tests/e2e/cli-only/`
// carries `check-deps.mjs` and `showcase.mjs` beside `run.mjs`, each defining its own
// `node:test` cases (ADR 0063). The convention is the same one
// `check-e2e-suite-coverage.mjs` already held every directory to before this module
// existed: every sibling `*.mjs` file that imports from `node:test` is its own entry,
// UNLESS `run.mjs` imports it itself (then it is reached through `run.mjs` and listing it
// again would run it twice).
//
// Because every on-disk suite lands in exactly one bucket, a suite can no longer go
// silently unaccounted for the way 12 of 112 once did (ADR 0063) — omission now REQUIRES
// a reasoned ledger entry rather than a forgotten script edit.
//
// `scripts/check-e2e-suite-coverage.mjs` holds the two ledgers to account for every
// suite; `scripts/e2e-run.mjs` (the `test:e2e` script) and `scripts/e2e-shard.mjs`
// (CI sharding) both consume `listE2eSuites()` rather than re-discovering suites.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_SERIAL_SUITES } from './e2e-serial-suites.mjs';
import { E2E_UNLISTED_SUITES } from './e2e-unlisted-suites.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A root-relative path outside `tests/e2e/` that the parallel batch also runs. */
export const LINT_ENGINES_SUITE = 'tests/lint-engines.mjs';

/** Scan run.mjs's DIRECT imports only (not transitive or sibling entries). */
function relativeImportsOf(src) {
    const specs = new Set();
    for (const m of src.matchAll(/\bfrom\s*['"](\.\/[^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/\bimport\s*['"](\.\/[^'"]+)['"]/g)) specs.add(m[1]);
    return specs;
}

/** Sibling `*.mjs` files (not `run.mjs`) that define `node:test` cases of their own. */
function siblingEntriesOf(dir, imports) {
    return readdirSync(dir)
        .filter((file) => file.endsWith('.mjs') && file !== 'run.mjs')
        .filter((file) => /\bfrom\s*['"]node:test['"]/.test(readFileSync(join(dir, file), 'utf8')))
        .filter((file) => !imports.has(`./${file}`))
        .sort();
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ onDisk: string[], parallel: string[], serial: string[] }}
 *   `onDisk` is every suite DIRECTORY name under `tests/e2e/` carrying a `run.mjs`.
 *   `parallel`/`serial` are root-relative entry paths (`tests/e2e/<name>/run.mjs`, plus
 *   any sibling entry — see the module header), sorted, covering every on-disk suite
 *   that is not in `E2E_UNLISTED_SUITES`.
 */
export function listE2eSuites({ root = ROOT } = {}) {
    const e2eDir = join(root, 'tests', 'e2e');
    const onDisk = readdirSync(e2eDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(e2eDir, entry.name, 'run.mjs')))
        .map((entry) => entry.name)
        .sort();

    const parallel = [];
    const serial = [];
    for (const name of onDisk) {
        if (name in E2E_UNLISTED_SUITES) continue;
        const dir = join(e2eDir, name);
        const imports = relativeImportsOf(readFileSync(join(dir, 'run.mjs'), 'utf8'));
        const entries = [
            `tests/e2e/${name}/run.mjs`,
            ...siblingEntriesOf(dir, imports).map((f) => `tests/e2e/${name}/${f}`),
        ];
        (name in E2E_SERIAL_SUITES ? serial : parallel).push(...entries);
    }
    return { onDisk, parallel: parallel.sort(), serial: serial.sort() };
}

// `node scripts/e2e-suites.mjs` prints the discovered set — used to diff against the
// list a hand-maintained script would have held, and as a quick local sanity check.
if (import.meta.url === `file://${process.argv[1]}`) {
    const { onDisk, parallel, serial } = listE2eSuites();
    console.log(
        `e2e-suites: ${onDisk.length} suite director${onDisk.length === 1 ? 'y' : 'ies'} on disk, ` +
            `${parallel.length} parallel entr${parallel.length === 1 ? 'y' : 'ies'}, ${serial.length} serial.`,
    );
    for (const p of parallel) console.log(`  parallel  ${p}`);
    for (const p of serial) console.log(`  serial    ${p}`);
}
