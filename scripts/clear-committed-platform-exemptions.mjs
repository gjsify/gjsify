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
//   STDOUT is the machine-readable half: one repo-relative path per file
//   WRITTEN — the manifest whose exemption was cleared, plus every other
//   generated file re-derived from that change — so the caller stages exactly
//   those and nothing else (a `git add packages/*/*/package.json` in a job that
//   pushes to `main` would sweep in whatever else happened to be dirty).
//   Commentary goes to stderr. Exits 0 with empty stdout when there is nothing
//   to clear — the common case.
//
// WHY THIS WRITES MORE THAN THE MANIFEST
//
// `gjsify.platformsUncommitted` is an input to TWO generated files of a platform
// package, not one: the manifest block itself, and a nine-line "No artifact in
// this tarball yet" paragraph in the generated `README.md` that
// `generate-platform-packages.mjs` emits only while `planned.state ===
// 'uncommitted'`. `auditPlatformPackages` byte-compares BOTH. So deleting the
// exemption and writing only the manifest leaves a README the generator no
// longer agrees with, and the gate two steps later in `commit-prebuilds` fails
// with `README.md is not what the generator emits now` — once per cleared
// package. That is what kept `commit-prebuilds` red from 2026-08-01 onward, with
// every build leg green and no prebuild landing on `main` for 41 hours.
//
// WHY IT STILL WRITES THE MANIFEST ITSELF RATHER THAN ASKING THE GENERATOR
//
// The generator's `write()` is parent-scoped: it re-emits every target of a
// touched parent, and `expectedFiles` derives `gjsify.glibcRequires` by MEASURING
// the binary on disk. The eight parents this script clears own 36 sibling `plan`
// children, 26 of them carrying a measured glibc floor. Calling `write()` here
// would let a job that pushes under `[skip ci]` silently raise a floor that the
// `prebuild-libc` gate compares against two steps later — verbatim the failure
// that gate exists to catch, and which has already fired for real (#927). So the
// surgical delete stays, and the generator is used as an ORACLE: its manifest
// must equal ours, or this script refuses. A floor is a promise to consumers; a
// human declares it.

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
        const surgical = `${JSON.stringify(data, null, 4)}\n`;

        // Which OTHER generated files does this package have, and what should
        // they look like now that the exemption is gone? Matched by NAME:
        // `platformPackageName()` is the one truth for the parent→child mapping,
        // and a path comparison would break the first time a root sits behind a
        // symlink (macOS `/var` vs `/private/var`).
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

            // The generator is an ORACLE here, never the writer. If its manifest
            // disagrees with the surgical delete, the difference is MEASURED from
            // the artifact that just landed (`libc` / `gjsify.glibcRequires`) —
            // numbers a delete cannot invent and this job must not declare.
            if (want['package.json'] !== surgical) {
                throw new Error(
                    `clear-committed-platform-exemptions: refusing to write ${data.name}.\n` +
                        `The generator's manifest differs from clearing the exemption, which means it would\n` +
                        `also change a MEASURED declaration (libc / gjsify.glibcRequires). A floor is a\n` +
                        `promise to consumers — declare it in a reviewed commit, not from a [skip ci] job.\n` +
                        firstDifference(surgical, want['package.json']),
                );
            }

            // Every OTHER generated entry, derived rather than hard-coded: a third
            // generated file added to `expectedFiles` later is covered for free.
            for (const [name, contents] of Object.entries(want)) {
                if (name === 'package.json') continue;
                const target = join(dirname(manifest), name);
                if (existsSync(target) && readFileSync(target, 'utf8') === contents) continue;
                if (!dry) writeFileSync(target, contents);
                written.push(target);
            }
        }

        // The `!dry` guard is load-bearing, not cosmetic: the e2e suite calls this
        // function on the REAL monorepo root with `dryRun: true`, so unguarded
        // re-emission would rewrite live package READMEs on every test run.
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
