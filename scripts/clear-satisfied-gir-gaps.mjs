#!/usr/bin/env node
// Drop a missing-`.gir` ledger entry once the `.gir` IS committed.
//
// A NO-OP IN THIS TREE TODAY, and kept anyway — read this before deleting it as dead.
// The ledger it edits drained to zero (every one of the ten `.gir` files arrived through
// `commit-prebuilds`, which is what it existed to force) and the empty module was then
// deleted by hand, so `clearSatisfiedGirGaps` takes its "no ledger" early return on every
// run. What survives is the MECHANISM: this script, its fixture-only tests, and the
// `prebuildGirGaps` option the rule still accepts are together what a future deferral
// would be recorded and auto-retired through. Deleting it would mean the next gap gets a
// ledger with no auto-exit, which is the exact failure below.
//
// The sibling of `clear-committed-platform-exemptions.mjs`, against the same trap. A
// ledger module at `LEDGER_REL` records a committed prebuild
// directory with no `.gir` yet, and `prebuild-artifacts` turns an entry into a
// FAILURE the moment the file appears, so a deferral cannot outlive its cause. That
// makes it a trap for the job that RESOLVES the cause: `commit-prebuilds` pushes the
// artifacts to `main` under `[skip ci]`, so the next `audit-runtimes --check` fails on
// a now self-contradictory entry and `main` stays red until a human notices — which
// is what kept `commit-prebuilds` red from 2026-08-01 with every build leg green. The
// condition and its marker have to be cleared by the same act.
//
// Usage: node scripts/clear-satisfied-gir-gaps.mjs [--dry-run] [--root <dir>]
//   STDOUT is the machine-readable half: the repo-relative path of the ledger when it
//   was rewritten, so the caller stages exactly that. Commentary goes to stderr.
//   Exits 0 with empty stdout when there is nothing to clear.
//
// LINE SURGERY, not a regenerated file: the ledger is mostly PROSE carrying the
// incident, the severity and the exit condition, and text a generator owns is text
// nobody edits. So one line per entry is deleted and everything else stays
// byte-identical. The edit is VERIFIED rather than assumed — the module is
// re-imported and its surviving key set must be exactly what was intended, so a shape
// this cannot edit fails loudly instead of silently clearing nothing.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posixRelative } from '../packages/infra/manifest-conformance/lib/index.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag >= 0 ? resolve(argv[rootFlag + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LEDGER_REL = 'scripts/manifest-conformance/prebuild-gir-gaps.mjs';

/**
 * The key on a ledger ENTRY LINE, or `null` if this line is not one: four spaces, a
 * quoted `@`-scoped package name, a colon.
 *
 * EXPORTED because it is the coupling between this script and the ledger — the e2e
 * suite asserts the REAL ledger conforms to it, and it must ask about the same
 * grammar the surgery below uses, not a paraphrase.
 *
 * @param {string} line
 */
export function entryKeyOnLine(line) {
    const match = /^ {4}(['"])(@[^'"]+)\1\s*:/.exec(line);
    return match ? match[2] : null;
}

/**
 * Import the ledger's CURRENT contents, never a cached copy.
 *
 * Calling this twice in one process — the shape `sync-and-stage.sh` promises, since
 * its push step retries — made the second call read the first call's module from
 * cache, re-derive the entry it had already deleted, and throw "could not find a
 * one-line entry", blaming the ledger for a stale view of it. In `commit-prebuilds`
 * that is exit 1 with no push and every downloaded binary discarded.
 *
 * A monotonic counter and not `Date.now()`: two calls in the same millisecond would
 * produce the same specifier and hit the cache again.
 */
let importSeq = 0;
async function readLedger(ledgerPath) {
    const mod = await import(`file://${ledgerPath}?read=${++importSeq}`);
    return Object.keys(mod.PREBUILD_GIR_GAPS ?? {});
}

/**
 * Does this package's committed prebuild directory hold a `.gir` now?
 *
 * Answered from the package's OWN declaration rather than the ledger key's spelling:
 * parsing `linux-x64` back out of `@gjsify/webgl-linux-x64` would be a second naming
 * rule to keep in step with `gjsify.platforms`/`gjsify.prebuilds`.
 *
 * @returns {boolean|null} `null` when no such package exists — the ledger names
 *   something this tree does not have, which the rule itself reports.
 */
function girIsCommitted(root, name) {
    const packagesDir = join(root, 'packages');
    if (!existsSync(packagesDir)) return null;
    for (const pillar of readdirSync(packagesDir)) {
        let names;
        try {
            names = readdirSync(join(packagesDir, pillar));
        } catch {
            continue; // a file, not a pillar directory
        }
        for (const dir of names) {
            const manifestPath = join(packagesDir, pillar, dir, 'package.json');
            if (!existsSync(manifestPath)) continue;
            let data;
            try {
                data = JSON.parse(readFileSync(manifestPath, 'utf8'));
            } catch {
                continue;
            }
            if (data.name !== name) continue;
            const prebuilds = data.gjsify?.prebuilds;
            const targets = data.gjsify?.platforms;
            if (typeof prebuilds !== 'string' || !Array.isArray(targets)) return null;
            // EVERY declared target must have its `.gir` before the entry may go;
            // clearing on the first of several would re-fail the rule on the rest.
            return targets.every((target) => {
                const dirPath = join(packagesDir, pillar, dir, prebuilds, target);
                if (!existsSync(dirPath)) return false;
                return readdirSync(dirPath).some((f) => f.endsWith('.gir'));
            });
        }
    }
    return null;
}

/**
 * Clear satisfied `.gir` deferrals.
 *
 * @returns {Promise<{cleared: string[], paths: string[]}>} the package names
 *   cleared, and the repo-relative paths written (which the caller must stage).
 */
export async function clearSatisfiedGirGaps(root, { dryRun: dry = false } = {}) {
    const ledgerPath = join(root, LEDGER_REL);
    if (!existsSync(ledgerPath)) return { cleared: [], paths: [] };

    // Through the module system, never by parsing: the keys are what the rule reads,
    // so they are what has to be compared.
    const before = await readLedger(ledgerPath);
    const cleared = before.filter((name) => girIsCommitted(root, name) === true);
    if (cleared.length === 0) return { cleared: [], paths: [] };

    const original = readFileSync(ledgerPath, 'utf8');
    const lines = original.split('\n');
    const kept = [];
    const removedKeys = new Set();
    for (const line of lines) {
        const key = entryKeyOnLine(line);
        if (key !== null && cleared.includes(key)) {
            removedKeys.add(key);
            continue;
        }
        kept.push(line);
    }
    const missed = cleared.filter((name) => !removedKeys.has(name));
    if (missed.length > 0) {
        throw new Error(
            `clear-satisfied-gir-gaps: could not find a one-line entry for ${missed.join(', ')} in ${LEDGER_REL}.\n` +
                'That file states the shape this script edits (one entry per line). Restore it, or teach this\n' +
                'script the new shape — leaving the entry in place would fail `prebuild-artifacts` on a commit\n' +
                'pushed under [skip ci], where nothing runs to say so.',
        );
    }

    // An emptied ledger must still satisfy `oxfmt --check`, which main.yml gates on
    // repo-wide, and `{\n}` does not. The one shape change line surgery cannot express.
    let next = kept.join('\n');
    next = next.replace(/export const PREBUILD_GIR_GAPS = \{\n\};/, 'export const PREBUILD_GIR_GAPS = {};');

    if (!dry) {
        writeFileSync(ledgerPath, next);
        // Through the same cache-bypassing read as above, so one place knows how to
        // look at this file freshly.
        const after = await readLedger(ledgerPath);
        const want = before.filter((name) => !cleared.includes(name)).sort();
        if (after.slice().sort().join('\n') !== want.join('\n')) {
            writeFileSync(ledgerPath, original);
            throw new Error(
                `clear-satisfied-gir-gaps: the rewritten ${LEDGER_REL} exports [${after.join(', ')}] but should ` +
                    `export [${want.join(', ')}]. The file has been restored; nothing was cleared.`,
            );
        }
    }

    return { cleared, paths: [posixRelative(root, ledgerPath)] };
}

// Only act when executed directly — the e2e suite imports the function.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const { cleared, paths } = await clearSatisfiedGirGaps(ROOT, { dryRun });
    for (const name of cleared) {
        console.error(`[gir-gaps] cleared ${name} — its committed prebuild directory now holds a .gir`);
    }
    for (const path of paths) console.log(path);
}
