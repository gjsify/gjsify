#!/usr/bin/env node
// The glibc floor of what THIS LEG JUST BUILT, measured where it can still block a PR.
//
// THE INCIDENT
//
// `prebuilds.yml`'s base image decides which glibc our published binaries link against, so
// bumping it rewrites `gjsify.glibcRequires` for every consumer without touching a line of
// source. #897 bumped it 43 → 44 in a hygiene sweep; glibc 2.43 re-versions
// `acosf`/`asinf`/`atan2f`, which lightningcss's colour conversion calls, so the measured
// floor went 2.39 → 2.43 and `main` was red for three consecutive `commit-prebuilds` runs
// (#924). The gate WORKED — it named both numbers and refused the artifacts — it just fired
// POST-MERGE, because `commit-prebuilds` is main-only. The PR that caused it was green.
//
// That is the shape AGENTS.md § "PR coverage parity" calls dishonest: a green PR must
// predict a green main. This runs the same measurement in the BUILD legs, which do run on
// `pull_request`.
//
// WHY IT DOES NOT JUST CALL `audit-runtimes --check`
//
// Because that would measure the WRONG BYTES, and would do so SILENTLY.
//
// After ADR 0017 the committed binaries live in the per-target platform packages
// (`packages/<pillar>/<bridge>-linux-x64/prebuilds/linux-x64/`), which is also where
// `commit-prebuilds` downloads the artifacts to. A build leg stages into the BRIDGE's own
// `prebuilds/<target>/` — `stage-prebuild.mjs --scratch`, deliberately: the leg commits
// nothing. `audit-runtimes` resolves directories through the manifests, so in a build leg it
// would walk straight past the freshly built files and grade the OLD COMMITTED ONES.
//
// And it would pass while doing it. `auditPrebuildLibc` treats a missing target directory as
// a STAT, not a failure (`stats.skippedMissing++; continue;`), so a gate pointed at the wrong
// place reports "0 targets measured" and goes green — worse than not having it.
//
// WHAT THIS DOES INSTEAD
//
// `auditPrebuildLibc` is kept as a standalone export precisely so it can be driven against
// packages other than the ones on disk ("so an e2e suite can drive it against SYNTHETIC
// packages in a temp directory"). Its rows carry WHERE TO MEASURE (`prebuildDir`) and WHAT TO
// HOLD IT TO (`manifestGjsify.glibcRequires`) as separate fields. So this takes the real rows
// — declarations and all, from the platform packages — and redirects only `prebuildDir` at
// the freshly staged bridge directory. Same rule, same failure text, fresh bytes.
//
// Two properties this shape has and a path-guessing one would not:
//
//   1. It STRUCTURALLY cannot read a committed copy. The bridge `prebuilds/` directories are
//      empty in git (verified across all ten bridges), so anything found under one was
//      written by this leg's collect steps.
//   2. The bridge ↔ platform-package mapping stays ONE derivation: `platformPackageDirName()`
//      builds the name, and this strips exactly that suffix. A second spelling in a workflow
//      is how the two drift.
//
// And the guard the silent-skip above demands: **zero staged directories is a FAILURE**, not
// a quiet pass. In a build leg it means the collect steps did not run.
//
// SCOPE, stated rather than silently narrowed: this holds the libc rule — glibc floor, libc
// flavour, musl verdict, unreadable ELF — over the freshly built artifacts. The other
// prebuild rules (artifact existence, loader paths, `.gir` provenance) still run only in
// `commit-prebuilds` and `audit-runtimes.yml`.
//
// Plain Node over the repo's own files — no install, no build. The build legs already install
// `nodejs` for `stage-prebuild.mjs`.
//
// Usage: node scripts/check-staged-prebuild-libc.mjs [--root <dir>]

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    auditPrebuildLibc,
    collectLibcPackages,
    createContext,
    isPlatformPackageManifest,
} from '../packages/infra/manifest-conformance/lib/index.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

function fail(lines) {
    console.error(`check-staged-prebuild-libc: ${lines.join('\n  ')}`);
    process.exit(1);
}

const ctx = createContext({ root: ROOT, discoveryRoots: ['packages'] });

/**
 * Rows whose measurement is redirected at this leg's freshly staged output.
 *
 * Only platform packages are considered: they are the ones that carry both a single target
 * and the `gjsify.glibcRequires` entry for it, and they are the ones a bridge's staged
 * directory is destined to become.
 */
const redirected = [];
/** Platform packages whose bridge staged nothing — this leg did not build them. */
const notStaged = [];

for (const row of collectLibcPackages(ctx)) {
    if (!isPlatformPackageManifest(row.manifest)) continue;
    const target = row.declared?.length === 1 ? row.declared[0] : null;
    if (target === null) continue;
    if (!target.startsWith('linux-')) continue;

    // The inverse of `platformPackageDirName(parentDirName, target)`, which is the ONE
    // derivation of the forward direction. `isPlatformPackageManifest` has already
    // established that the NAME ends in `-${target}`; the directory follows the same rule.
    const suffix = `-${target}`;
    if (!row.path.endsWith(suffix)) continue;
    const bridgeRel = row.path.slice(0, -suffix.length);

    const bridgePrebuilds = join(ROOT, bridgeRel, 'prebuilds');
    if (!existsSync(join(bridgePrebuilds, target))) {
        notStaged.push(`${row.name} → ${bridgeRel}/prebuilds/${target}/`);
        continue;
    }
    // `path` follows the measurement, not the declaration, so a failure message points a
    // reader at the bytes that actually failed. `name` stays the declaration's owner.
    redirected.push({ ...row, path: `${bridgeRel}/prebuilds`, prebuildDir: bridgePrebuilds });
}

if (redirected.length === 0) {
    fail([
        'no freshly staged prebuild directory was found under any bridge package.',
        'In a build leg that means the collect steps did not run — `stage-prebuild.mjs --scratch`',
        'writes `<bridge>/prebuilds/<target>/`, and this check measures exactly those.',
        'Reporting "0 targets measured" as a pass is the failure mode this check exists to remove,',
        'so it is an error instead. Candidates that staged nothing:',
        ...notStaged.map((n) => `  - ${n}`),
    ]);
}

console.log(
    `check-staged-prebuild-libc: measuring ${redirected.length} freshly staged target(s) against the ` +
        'floors their platform packages declare:',
);
for (const row of redirected) console.log(`  ${row.name}  ←  ${row.path}/${row.declared[0]}/`);

const { failures, notes } = auditPrebuildLibc(redirected);

for (const note of notes) console.log(`  note: ${note}`);

if (failures.length > 0) {
    fail([
        `the libc claim does not hold for what this leg just built (${failures.length} finding(s)):`,
        ...failures.map((f) => `- ${f}`),
        '',
        'This is the measurement `commit-prebuilds` runs post-merge, moved onto the PR. A finding here',
        'is the same finding that would turn `main` red — fix the declaration or the build, not this gate.',
    ]);
}

console.log('check-staged-prebuild-libc: the freshly built artifacts match their declared libc floors.');
