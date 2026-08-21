#!/usr/bin/env node
// The glibc floor of what THIS LEG JUST BUILT, measured where it can still block a PR.
//
// `prebuilds.yml`'s base image decides which glibc the published binaries link against, so
// bumping it rewrites `gjsify.glibcRequires` for every consumer without touching a line of
// source. #897 bumped it 43 → 44; glibc 2.43 re-versions `acosf`/`asinf`/`atan2f`, which
// lightningcss's colour conversion calls, so the measured floor went 2.39 → 2.43 and `main`
// was red for three consecutive `commit-prebuilds` runs (#924). The gate WORKED — it named
// both numbers and refused the artifacts — it just fired POST-MERGE, because
// `commit-prebuilds` is main-only, and the PR that caused it was green. That is the dishonesty
// docs/ci-selective.md § "PR coverage parity" forbids, so the same measurement runs in the
// BUILD legs, which do run on `pull_request`.
//
// It does NOT just call `audit-runtimes --check`: that would measure the WRONG BYTES, and
// silently. After ADR 0017 the committed binaries live in the per-target platform packages,
// where `commit-prebuilds` downloads artifacts to, while a build leg stages into the BRIDGE's
// own `prebuilds/<target>/` (`stage-prebuild.mjs --scratch` — the leg commits nothing).
// `audit-runtimes` resolves directories through the manifests, so it would walk past the fresh
// files and grade the OLD COMMITTED ones — and pass, because `auditPrebuildLibc` counts a
// missing target directory as a stat rather than a failure (`stats.skippedMissing++`), so a
// gate pointed at the wrong place reports "0 targets measured" and goes green.
//
// So this takes the real rows — declarations and all, from the platform packages — and
// redirects only `prebuildDir` at the freshly staged bridge directory. Same rule, same failure
// text, fresh bytes. Two properties a path-guessing version would not have:
//
//   1. It STRUCTURALLY cannot read a committed copy: the bridge `prebuilds/` directories are
//      empty in git, so anything under one was written by this leg's collect steps.
//   2. The bridge ↔ platform-package mapping stays ONE derivation — `platformPackageDirName()`
//      builds the name and this strips exactly that suffix. A second spelling in a workflow is
//      how the two drift.
//
// ── THERE ARE TWO ZEROS, AND THEY ARE NOT THE SAME FINDING ─────────────────────────────
//
// "Zero targets measured" used to be one verdict here — an unconditional error, on the
// reasoning that a build leg which staged nothing did not run its collect steps. That is one
// of the two ways to arrive at zero, and it is still an error. The other one is legitimate and
// this gate called it a defect for as long as both mechanisms existed side by side:
//
//   • ZERO BECAUSE COLLECTION FAILED — the leg was told to build packages and produced no
//     bytes. Reporting that as a pass is precisely the failure mode this file exists to
//     remove, so it stays an error.
//   • ZERO BECAUSE EVERY CANDIDATE WAS SKIPPED AS UNCHANGED — `prebuilds.yml`'s `changes` job
//     builds a package only when something it depends on changed, and a leg whose whole
//     package set was skipped correctly compiles nothing. There are no fresh bytes, and there
//     is nothing dishonest about saying so.
//
// MEASURED, on #1232 (a PR that edits TypeScript under `packages/infra/rolldown-native/src/ts/`
// — enough to match the workflow's `src/**` trigger, not a byte of native source). All three
// QEMU legs went red here while their build step was green and had skipped all ten packages,
// and all eight uploads were correctly skipped with them. `rolldown-native` WAS classified as
// "build" — but no emulated leg builds it (it has no `-linux-ppc64`/`-s390x`/`-riscv64`
// platform package), so those legs had a candidate set of eight, all skipped. Compare
// job 96741121999 on main: `PREBUILD_SKIP: []`, everything built, gate green. Two correct
// mechanisms, one contradiction.
//
// It is NOT a trigger bug, and narrowing `on: paths:` would not have fixed it. Any PR touching
// only `oxfmt-native`'s or `rolldown-native`'s Rust sources reproduces it exactly — both are
// real prebuild inputs, both legitimately start the workflow, and neither is built on an
// emulated leg. The trigger decides how OFTEN this shape occurs; only the gate can decide what
// it means.
//
// SO THE GATE IS TOLD WHAT THE LEG WAS SUPPOSED TO BUILD, and refuses to guess:
//
//   PREBUILD_TARGET  `linux-<arch>` — the one target this leg stages, `matrix.arch` verbatim.
//                    Needed because the candidate rows cover EVERY linux target in the tree,
//                    and `rolldown-native-linux-x64` staging nothing on a ppc64 leg is not a
//                    finding about that leg.
//   PREBUILD_REPORT  the `changes` job's own `report` output — `[{key, dir, build, why}]`, one
//                    entry per package `prebuilds.yml` produces an artifact for. It is the
//                    decision that was ACTED on, `dir` maps straight onto the bridge directory
//                    this file already derives, and `prebuilds-summary` reads the same output
//                    for the same reason. Taking `PREBUILD_SKIP` instead would need a second
//                    derivation of "which packages does this workflow even gate", and that
//                    second copy is what drifts.
//
// The three rules it applies, none of which is "pass when in doubt":
//
//   1. Every freshly staged directory is MEASURED — always, skip list or not. A partial skip
//      is not a blanket exemption: the packages that WERE built are gated exactly as before.
//   2. A candidate for this leg's target that staged nothing and is NOT in the report as
//      `build: false` is UNACCOUNTED FOR — neither built nor skipped — and is an error, even
//      when other packages on the same leg were measured fine.
//   3. Zero measured passes ONLY when every candidate is accounted for as skipped, and it says
//      so by name in the log. Without a target and a report the gate cannot tell the two zeros
//      apart, so zero stays an error — the fail-closed direction.
//
// And what the silent-skip demands, restated: a zero this gate cannot EXPLAIN is a failure.
//
// SCOPE, stated rather than silently narrowed: the libc rule only — glibc floor, libc flavour,
// musl verdict, unreadable ELF. Artifact existence, loader paths and `.gir` provenance still
// run only in `commit-prebuilds` and `audit-runtimes.yml`.
//
// Plain Node over the repo's own files — no install, no build; the build legs already install
// `nodejs` for `stage-prebuild.mjs`.
//
// Usage: node scripts/check-staged-prebuild-libc.mjs [--root <dir>] [--target <os-arch>]
//                                                    [--report <json>]
//        (the two latter default to $PREBUILD_TARGET / $PREBUILD_REPORT)

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
/** The value after `--name`, or undefined. */
function flag(name) {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
}

const ROOT = flag('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = (flag('--target') ?? process.env.PREBUILD_TARGET ?? '').trim();
const RAW_REPORT = (flag('--report') ?? process.env.PREBUILD_REPORT ?? '').trim();

function fail(lines) {
    console.error(`check-staged-prebuild-libc: ${lines.join('\n  ')}`);
    process.exit(1);
}

/**
 * The `changes` job's per-package decision, keyed by bridge directory.
 *
 * Returns `null` rows together with the REASON, never a silent empty map: the reason is
 * printed in the failure that a missing table then makes unavoidable, so "the gate could not
 * tell the two zeros apart" is a sentence a reader gets rather than an inference they have to
 * make.
 *
 * `[]` is deliberately treated as "no table". That is what the `changes` job publishes on its
 * fail-open path (`classifier failed; building everything`), where the correct expectation is
 * that EVERY package was built — so a zero under it is the defect zero, not the skipped one.
 * `prebuilds-summary` reads the same value the same way.
 */
function readReport(raw) {
    if (raw === '') {
        return {
            rows: null,
            why: 'PREBUILD_REPORT was empty — this leg was not told which packages the `changes` job decided to build.',
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (cause) {
        return { rows: null, why: `PREBUILD_REPORT is not valid JSON (${cause.message}).` };
    }
    if (!Array.isArray(parsed)) return { rows: null, why: 'PREBUILD_REPORT is not a JSON array.' };
    if (parsed.length === 0) {
        return {
            rows: null,
            why: 'PREBUILD_REPORT is `[]` — the classifier failed open, and that means every package was to be BUILT.',
        };
    }
    const bad = parsed.find((r) => typeof r?.dir !== 'string' || typeof r?.build !== 'boolean');
    if (bad) {
        return {
            rows: null,
            why: `PREBUILD_REPORT has an entry without a string \`dir\` + boolean \`build\`: ${JSON.stringify(bad)}.`,
        };
    }
    return { rows: parsed, why: null };
}

const report = readReport(RAW_REPORT);
/** Why the build/skip accounting is unavailable, or `null` when it is available. */
const noAccounting =
    TARGET === ''
        ? 'PREBUILD_TARGET was empty — without this leg’s target every linux platform package in the tree looks like a candidate.'
        : report.why;
const decisions = noAccounting === null ? new Map(report.rows.map((r) => [r.dir, r])) : null;

const ctx = createContext({ root: ROOT, discoveryRoots: ['packages'] });

/**
 * Rows whose measurement is redirected at this leg's freshly staged output.
 *
 * Platform packages only: they carry both a single target and its
 * `gjsify.glibcRequires` entry, and they are what a bridge's staged directory becomes.
 */
const redirected = [];
/** Platform packages whose bridge staged nothing — this leg did not build them. */
const notStaged = [];

for (const row of collectLibcPackages(ctx)) {
    if (!isPlatformPackageManifest(row.manifest)) continue;
    const target = row.declared?.length === 1 ? row.declared[0] : null;
    if (target === null) continue;
    if (!target.startsWith('linux-')) continue;

    // The inverse of `platformPackageDirName(parentDirName, target)`.
    // `isPlatformPackageManifest` has established the NAME ends in `-${target}`; the
    // directory follows the same rule.
    const suffix = `-${target}`;
    if (!row.path.endsWith(suffix)) continue;
    const bridgeRel = row.path.slice(0, -suffix.length);

    const bridgePrebuilds = join(ROOT, bridgeRel, 'prebuilds');
    if (!existsSync(join(bridgePrebuilds, target))) {
        notStaged.push({ name: row.name, bridgeRel, target });
        continue;
    }
    // `path` follows the measurement, not the declaration, so a failure message points a
    // reader at the bytes that actually failed. `name` stays the declaration's owner.
    redirected.push({ ...row, path: `${bridgeRel}/prebuilds`, prebuildDir: bridgePrebuilds });
}

// ── account for what did NOT stage ─────────────────────────────────────────────────────
//
// Only this leg's target, and only packages this workflow builds at all: `@gjsify/napi` has
// linux platform packages and its own workflow, so an empty `packages/napi/napi/prebuilds/`
// here is not this leg's business. The report's `dir` set answers both questions at once,
// because the classifier derives it from `prebuilds.yml`'s own upload/download steps.
/** Candidates for this leg that the `changes` job decided not to build. */
const skippedUnchanged = [];
/** Candidates for this leg that were to be BUILT and staged nothing — neither built nor skipped. */
const unaccounted = [];

if (decisions !== null) {
    for (const c of notStaged) {
        if (c.target !== TARGET) continue;
        const decision = decisions.get(c.bridgeRel);
        if (decision === undefined) continue;
        (decision.build ? unaccounted : skippedUnchanged).push({ ...c, why: decision.why ?? '' });
    }
}

const forThisLeg = (rows) => (TARGET === '' ? rows : rows.filter((r) => r.target === TARGET));

if (unaccounted.length > 0) {
    fail([
        `${unaccounted.length} package(s) this leg was told to BUILD staged nothing for ${TARGET}.`,
        'Neither built nor skipped is the state that must never pass: the `changes` job put them in',
        'the build set, so their collect steps were supposed to run, and `stage-prebuild.mjs --scratch`',
        'writes `<bridge>/prebuilds/<target>/` when they do.',
        ...unaccounted.map((u) => `  - ${u.name} → ${u.bridgeRel}/prebuilds/${u.target}/  (build: ${u.why})`),
        '',
        'If these are genuinely not built on this leg, they must not be in the classifier’s build set',
        'for it — fix the classification, not this gate.',
    ]);
}

// EVERYTHING BELOW IS ONE `if`/`else` RATHER THAN AN EARLY `process.exit(0)`, on purpose:
// stdout is a pipe under Actions and Node flushes it asynchronously, so exiting immediately
// after the lines that make this pass legible is how they would go missing — which would leave
// exactly the silent zero this gate exists to refuse.
if (redirected.length === 0) {
    if (decisions !== null && skippedUnchanged.length > 0) {
        // THE PASS THAT HAS TO BE LOUD. A silent "0 targets measured" is the exact failure this
        // gate was written to remove, so the legitimate zero names every package it stands for.
        console.log(
            `check-staged-prebuild-libc: 0 targets measured for ${TARGET} — every one of the ` +
                `${skippedUnchanged.length} package(s) this leg builds was SKIPPED AS UNCHANGED by the ` +
                '`changes` job, so no fresh bytes exist to measure:',
        );
        for (const s of skippedUnchanged) console.log(`  skipped  ${s.name}  (${s.why})`);
        console.log(
            '  This is the accounted-for zero. The other one — collect steps that were supposed to run\n' +
                '  and did not — is still a hard error, and every candidate above is named so the two can be\n' +
                '  told apart in this log rather than inferred from a green tick.',
        );
    } else {
        fail([
            'no freshly staged prebuild directory was found under any bridge package.',
            'In a build leg that means the collect steps did not run — `stage-prebuild.mjs --scratch`',
            'writes `<bridge>/prebuilds/<target>/`, and this check measures exactly those.',
            'Reporting "0 targets measured" as a pass is the failure mode this check exists to remove,',
            'so it is an error instead.',
            ...(noAccounting === null
                ? [`No candidate for ${TARGET} was skipped as unchanged either, so nothing explains the zero.`]
                : [
                      `The skipped-as-unchanged zero could not be ruled in: ${noAccounting}`,
                      'A zero this gate cannot explain is a failure — that is the fail-closed direction.',
                  ]),
            'Candidates that staged nothing:',
            ...forThisLeg(notStaged).map((n) => `  - ${n.name} → ${n.bridgeRel}/prebuilds/${n.target}/`),
        ]);
    }
} else {
    measure();
}

function measure() {
    console.log(
        `check-staged-prebuild-libc: measuring ${redirected.length} freshly staged target(s) against the ` +
            'floors their platform packages declare:',
    );
    for (const row of redirected) console.log(`  ${row.name}  ←  ${row.path}/${row.declared[0]}/`);
    // A PARTIAL SKIP IS STILL A SKIP, and stays visible: the measured rows below say nothing about
    // these, and a reader comparing two runs' target counts deserves the reason for the difference.
    for (const s of skippedUnchanged) console.log(`  skipped  ${s.name}  (${s.why})`);
    if (noAccounting !== null) console.log(`  note: no build/skip accounting on this run — ${noAccounting}`);

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
}
