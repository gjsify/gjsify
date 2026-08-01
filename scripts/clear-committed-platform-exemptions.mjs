#!/usr/bin/env node
// Drop a `gjsify.platformsUncommitted` entry once its artifact IS committed.
//
// The entry means "this target is declared and CI builds it, but no artifact
// lives in this repo yet", and the conformance rule turns it into a FAILURE the
// moment `prebuilds/<target>/` appears — deliberately, so a deferral cannot
// outlive its cause (AGENTS.md, OS-axis enforcement).
//
// That is exactly what makes it a trap for the job that RESOLVES the cause.
// `commit-prebuilds` downloads the artifacts and pushes them to `main`; the
// next `audit-runtimes --check` on `main` then fails on an entry that is now
// self-contradictory, and `main` stays red until a human notices and sends a
// follow-up PR. The condition and its marker have to be cleared by the same
// act, or the honest-deferral mechanism buys its honesty with a red default
// branch every time a new target lands.
//
// So this runs in `commit-prebuilds`, right before staging: for every package
// declaring exemptions, an entry whose directory is now present on disk is
// removed (and the object with it, when it empties). An entry whose artifact
// did NOT arrive — a skipped package, a leg that did not run — is untouched,
// which is the whole point: it still describes reality.
//
// Usage: node scripts/clear-committed-platform-exemptions.mjs [--dry-run] [--root <dir>]
//   STDOUT is the machine-readable half: one repo-relative manifest path per
//   changed file, so the caller stages exactly those and nothing else (a
//   `git add packages/*/*/package.json` in a job that pushes to `main` would
//   sweep in whatever else happened to be dirty). Commentary goes to stderr.
//   Exits 0 with empty stdout when there is nothing to clear — the common case.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag >= 0 ? resolve(argv[rootFlag + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `packages/<pillar>/<name>/package.json`, without globbing deps. */
function packageManifests(root) {
    const out = [];
    const packagesDir = join(root, 'packages');
    if (!existsSync(packagesDir)) return out;
    for (const pillar of readdirSync(packagesDir)) {
        const pillarDir = join(packagesDir, pillar);
        let names;
        try {
            names = readdirSync(pillarDir);
        } catch {
            continue; // a file, not a pillar directory
        }
        for (const name of names) {
            const manifest = join(pillarDir, name, 'package.json');
            if (existsSync(manifest)) out.push(manifest);
        }
    }
    return out;
}

/**
 * Clear satisfied exemptions.
 *
 * @returns `{ cleared, manifests }` — the `<pkg> <target>` pairs for the log,
 *   and the repo-relative manifest paths the caller must stage.
 */
export function clearSatisfiedExemptions(root, { dryRun: dry = false } = {}) {
    const cleared = [];
    const manifests = [];
    for (const manifest of packageManifests(root)) {
        const raw = readFileSync(manifest, 'utf8');
        const data = JSON.parse(raw);
        const gjsify = data.gjsify;
        const exemptions = gjsify?.platformsUncommitted;
        if (!exemptions || Object.keys(exemptions).length === 0) continue;

        // `gjsify.prebuilds` names the directory; a package declaring an
        // exemption without one is a manifest bug the conformance rule owns.
        const prebuildsDir = gjsify.prebuilds;
        if (!prebuildsDir) continue;

        let changed = false;
        for (const target of Object.keys(exemptions)) {
            if (!existsSync(join(dirname(manifest), prebuildsDir, target))) continue;
            delete exemptions[target];
            cleared.push(`${data.name} ${target}`);
            changed = true;
        }
        if (!changed) continue;
        if (Object.keys(exemptions).length === 0) delete gjsify.platformsUncommitted;
        // Match the tree's manifest style: 4-space indent, trailing newline.
        if (!dry) writeFileSync(manifest, `${JSON.stringify(data, null, 4)}\n`);
        manifests.push(manifest.slice(root.length + 1));
    }
    return { cleared, manifests };
}

// Only act when executed directly — the e2e suite imports the function.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const { cleared, manifests } = clearSatisfiedExemptions(ROOT, { dryRun });
    for (const entry of cleared) {
        console.error(`[platform-exemptions] cleared ${entry} — its prebuild directory is now committed`);
    }
    for (const path of manifests) console.log(path);
}
