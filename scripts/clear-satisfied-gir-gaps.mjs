#!/usr/bin/env node
// Drop a missing-`.gir` ledger entry once the `.gir` IS committed.
//
// The sibling of `clear-committed-platform-exemptions.mjs`, for the same reason
// and against the same trap. `scripts/manifest-conformance/prebuild-gir-gaps.mjs`
// records a committed prebuild directory that has no `.gir` yet, and
// `prebuild-artifacts` turns an entry into a FAILURE the moment the file appears
// — deliberately, so a deferral cannot outlive its cause.
//
// That is exactly what makes it a trap for the job that RESOLVES the cause.
// `commit-prebuilds` downloads the artifacts and pushes them to `main` under
// `[skip ci]`; the next `audit-runtimes --check` then fails on an entry that is
// now self-contradictory, and `main` stays red until a human notices. The
// condition and its marker have to be cleared by the same act. Not hypothetical
// for the other ledger: it is what kept `commit-prebuilds` red from 2026-08-01
// with every build leg green.
//
// It is also not hypothetical HERE, and that is why this script exists in the
// same change as the assertion: `prebuilds.yml`'s own `on: push: paths:` list
// covers `.github/prebuild-toolchain/**` and `scripts/manifest-conformance/**`,
// and a change to a shared input rebuilds EVERY package. So the merge that adds
// the ledger is itself a run that lands the ten `.gir` files it defers.
//
// Usage: node scripts/clear-satisfied-gir-gaps.mjs [--dry-run] [--root <dir>]
//   STDOUT is the machine-readable half: the repo-relative path of the ledger
//   when it was rewritten, so the caller stages exactly that. Commentary goes to
//   stderr. Exits 0 with empty stdout when there is nothing to clear.
//
// WHY LINE SURGERY AND NOT A REGENERATED FILE
//
// The ledger is mostly PROSE — the header carries the incident, the severity and
// the exit condition, which is the whole reason a ledger is acceptable at all. A
// generator would have to own that text, and text a generator owns is text nobody
// edits. So this deletes the one line an entry occupies and leaves everything
// else byte-identical. The shape it depends on is stated in the ledger's own
// header, and the edit is VERIFIED rather than assumed: the module is re-imported
// afterwards and its surviving key set must be exactly what was intended, so a
// shape this cannot edit fails loudly instead of silently clearing nothing.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag >= 0 ? resolve(argv[rootFlag + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LEDGER_REL = 'scripts/manifest-conformance/prebuild-gir-gaps.mjs';

/**
 * Does this package's committed prebuild directory hold a `.gir` now?
 *
 * Answered from the package's OWN declaration rather than from the ledger key's
 * spelling: a per-target package names one target in `gjsify.platforms` and its
 * directory in `gjsify.prebuilds`, and parsing `linux-x64` back out of
 * `@gjsify/webgl-linux-x64` would be a second naming rule to keep in step.
 *
 * @returns {boolean|null} `null` when no such package exists (the ledger names
 *   something this tree does not have — the rule reports that; not our business).
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
            // Every declared target of a per-target package (there is one) must
            // have its `.gir` before the entry may go: clearing on the first of
            // several would re-fail the rule on the rest.
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

    // Read the ledger through the module system, never by parsing it: the keys
    // are what the rule reads, so they are what has to be compared.
    const before = Object.keys((await import(`file://${ledgerPath}`)).PREBUILD_GIR_GAPS ?? {});
    const cleared = before.filter((name) => girIsCommitted(root, name) === true);
    if (cleared.length === 0) return { cleared: [], paths: [] };

    const original = readFileSync(ledgerPath, 'utf8');
    const lines = original.split('\n');
    const kept = [];
    const removedKeys = new Set();
    for (const line of lines) {
        // An entry line and nothing else: four spaces, the quoted key, a colon.
        const match = /^ {4}(['"])(@[^'"]+)\1\s*:/.exec(line);
        if (match && cleared.includes(match[2])) {
            removedKeys.add(match[2]);
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

    // An emptied ledger must still be formatted the way `oxfmt --check` wants
    // (main.yml gates on it, repo-wide) — `{\n}` is not. This is the one shape
    // change line surgery cannot express, so it is expressed here.
    let next = kept.join('\n');
    next = next.replace(/export const PREBUILD_GIR_GAPS = \{\n\};/, 'export const PREBUILD_GIR_GAPS = {};');

    if (!dry) {
        writeFileSync(ledgerPath, next);
        // VERIFY, do not assume. A cache-busting query keeps this from reading the
        // copy imported above.
        const after = Object.keys((await import(`file://${ledgerPath}?after=${Date.now()}`)).PREBUILD_GIR_GAPS ?? {});
        const want = before.filter((name) => !cleared.includes(name)).sort();
        if (after.slice().sort().join('\n') !== want.join('\n')) {
            writeFileSync(ledgerPath, original);
            throw new Error(
                `clear-satisfied-gir-gaps: the rewritten ${LEDGER_REL} exports [${after.join(', ')}] but should ` +
                    `export [${want.join(', ')}]. The file has been restored; nothing was cleared.`,
            );
        }
    }

    return { cleared, paths: [relative(root, ledgerPath).replaceAll('\\', '/')] };
}

// Only act when executed directly — the e2e suite imports the function.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const { cleared, paths } = await clearSatisfiedGirGaps(ROOT, { dryRun });
    for (const name of cleared) {
        console.error(`[gir-gaps] cleared ${name} — its committed prebuild directory now holds a .gir`);
    }
    for (const path of paths) console.log(path);
}
