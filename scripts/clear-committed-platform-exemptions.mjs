#!/usr/bin/env node
// Drop a `gjsify.platformsUncommitted` entry once its artifact IS committed.
//
// The entry means "declared and CI-built, but no artifact lives in this repo yet",
// and the conformance rule turns it into a FAILURE the moment `prebuilds/<target>/`
// appears, so a deferral cannot outlive its cause (docs/runtime-platform-axes.md).
//
// That makes it a trap for the job that RESOLVES the cause: `commit-prebuilds` pushes
// the artifacts to `main`, the next `audit-runtimes --check` fails on a
// now self-contradictory entry, and `main` stays red until a human sends a follow-up.
// The condition and its marker have to be cleared by the same act, or honest deferral
// buys its honesty with a red default branch every time a target lands.
//
// So this runs in `commit-prebuilds` right before staging. An entry whose artifact did
// NOT arrive — skipped package, leg that did not run — is untouched: it still
// describes reality.
//
// Usage: node scripts/clear-committed-platform-exemptions.mjs [--dry-run] [--root <dir>]
//   STDOUT is the machine-readable half: one repo-relative path per file WRITTEN, so
//   the caller stages exactly those and nothing else (a `git add
//   packages/*/*/package.json` in a job that pushes to `main` would sweep in whatever
//   else was dirty). Commentary goes to stderr. Exits 0 with empty stdout when there
//   is nothing to clear.
//
// IT WRITES MORE THAN THE MANIFEST because `gjsify.platformsUncommitted` is an input
// to TWO generated files: the manifest block and a "No artifact in this tarball yet"
// paragraph that `generate-platform-packages.mjs` emits while `planned.state ===
// 'uncommitted'`. `auditPlatformPackages` byte-compares both, so clearing only the
// manifest leaves a README the generator no longer agrees with — which kept
// `commit-prebuilds` red from 2026-08-01 with every build leg green and no prebuild
// landing on `main` for 41 hours.
//
// IT STILL WRITES THE MANIFEST ITSELF rather than asking the generator, because the
// generator's `write()` is parent-scoped — it re-emits every target of a touched
// parent, and `expectedFiles` derives `gjsify.glibcRequires` by MEASURING the binary
// on disk. Calling it here would let a job pushing under `[skip ci]` silently raise a
// floor that the `prebuild-libc` gate compares against two steps later, verbatim the
// failure that gate exists to catch and which has fired for real (#927). So the
// surgical delete stays and the generator is an ORACLE: its manifest must equal ours
// or this script refuses. A floor is a promise to consumers; a human declares it.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    expectedFiles,
    firstDifference,
    generatorContext,
    planPlatformPackages,
} from './generate-platform-packages.mjs';
import { posixRelative } from '../packages/infra/manifest-conformance/lib/index.mjs';

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
 * @returns `{ cleared, paths }` — the `<pkg> <target>` pairs for the log, and
 *   the repo-relative paths of every file written, which the caller must stage.
 */
export function clearSatisfiedExemptions(root, { dryRun: dry = false } = {}) {
    const cleared = [];
    const paths = [];
    /** Built lazily and at most once — it walks every package. */
    let plan = null;
    for (const manifest of packageManifests(root)) {
        const raw = readFileSync(manifest, 'utf8');
        const data = JSON.parse(raw);
        const gjsify = data.gjsify;
        const exemptions = gjsify?.platformsUncommitted;
        if (!exemptions || Object.keys(exemptions).length === 0) continue;

        // A package declaring an exemption without a `gjsify.prebuilds` directory is a
        // manifest bug the conformance rule owns.
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
        const surgical = `${JSON.stringify(data, null, 4)}\n`;

        // Matched by NAME: `platformPackageName()` is the one truth for the
        // parent→child mapping, and a path comparison would break the first time a
        // root sits behind a symlink (macOS `/var` vs `/private/var`).
        plan ??= planPlatformPackages(generatorContext(root));
        let parent = null;
        let planned = null;
        for (const candidate of plan.parents) {
            const hit = candidate.targets.find((t) => t.name === data.name);
            if (hit) {
                parent = candidate;
                planned = hit;
                break;
            }
        }

        const written = [manifest];
        if (planned) {
            // `why` goes with the exemption; `state` flips `uncommitted` → `plan`,
            // which is exactly what the generator keys the README block on.
            const want = expectedFiles(parent, { ...planned, state: 'plan', why: undefined });

            // A disagreement here is MEASURED from the artifact that just landed
            // (`libc` / `gjsify.glibcRequires`) — numbers a delete cannot invent and
            // this job must not declare.
            if (want['package.json'] !== surgical) {
                throw new Error(
                    `clear-committed-platform-exemptions: refusing to write ${data.name}.\n` +
                        `The generator's manifest differs from clearing the exemption, which means it would\n` +
                        `also change a MEASURED declaration (libc / gjsify.glibcRequires). A floor is a\n` +
                        `promise to consumers — declare it in a reviewed commit, not from a [skip ci] job.\n` +
                        firstDifference(surgical, want['package.json']),
                );
            }

            // Derived rather than hard-coded, so a third generated file added to
            // `expectedFiles` later is covered for free.
            for (const [name, contents] of Object.entries(want)) {
                if (name === 'package.json') continue;
                const target = join(dirname(manifest), name);
                if (existsSync(target) && readFileSync(target, 'utf8') === contents) continue;
                if (!dry) writeFileSync(target, contents);
                written.push(target);
            }
        }

        // The `!dry` guard is load-bearing: the e2e suite calls this on the REAL
        // monorepo root with `dryRun: true`, so unguarded re-emission would rewrite
        // live package READMEs on every test run.
        if (!dry) writeFileSync(manifest, surgical);
        for (const path of written) paths.push(posixRelative(root, path));
    }
    return { cleared, paths };
}

// Only act when executed directly — the e2e suite imports the function.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const { cleared, paths } = clearSatisfiedExemptions(ROOT, { dryRun });
    for (const entry of cleared) {
        console.error(`[platform-exemptions] cleared ${entry} — its prebuild directory is now committed`);
    }
    for (const path of paths) console.log(path);
}
