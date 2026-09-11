#!/usr/bin/env node
// Gate a GTK runtime bundle on the properties of its own manifest, before publish.
//
// A file, not the two inline `node -e` blocks it replaced (`release.yml`'s darwin job under bash,
// a near-identical copy in the win32 job under pwsh): both ended in `join('+')` inside a
// SINGLE-QUOTED shell string, so node received `join(+)` and died with a SyntaxError before
// evaluating a single assertion. All three publish legs of v0.28.0 failed at that step while every
// bundle they were gating was correct, and the three bundles stayed at 0.27.1 — the one version
// whose defects this gate exists to prevent shipping. `release.yml` is `on: release`/
// `workflow_dispatch` only, so nothing on a PR ever executed either block. Regrow guard:
// `scripts/check-workflow-inline-scripts.mjs`.
//
// Every check below is a property of the ARTIFACT as a consumer holding only the tarball can read
// it — deliberately the manifest and not the build log, because the build log is not shipped. Each
// names a v0.27.1 defect (display-free variant published as the release; unfiltered typelib copy
// advertising constructible types with no backing library; relocated LGPL/MPL/GPL libraries with
// no license file) — detail in docs/node-gi-platform-notes.md. `windowingData.verified` and
// `windowingData.decodeProbe` require the builder's RECORD, so a bundle built by an older builder,
// or with the gate bypassed, cannot publish.
//
// TWO ROLES, AND A NEW RECORD ONLY ONE OF THEM CAN DEMAND. This script gates a bundle the builder
// just produced (release.yml, both legs) AND the tarball a consumer already receives
// (gtk-os-suites.yml, after stage-published-gtk-runtime.mjs). Adding `licenses.binariesCovered` as
// a hard requirement broke the second role on all three targets at once: the published 0.45.0
// manifests were written before the field existed and can never gain it — only the NEXT release
// can. A check that a shipped artifact cannot pass is not a gate, it is a permanently red leg.
// So `--allow-legacy-license-record` narrows the requirement for the published-closure role only,
// and it is deliberately self-retiring: it excuses the field being ABSENT and nothing else (present
// and zero still fails, in every role), and the script SAYS when it was not needed — which is the
// day the flag can be deleted from the two workflow call sites.
//
// Usage:
//   node packages/node-gi/scripts/verify-bundle-manifest.mjs --bundle <dir>
//                                                            [--expect-host-target <os>]
//                                                            [--allow-legacy-license-record]
//                                                            [--allow-legacy-api-record]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeProbeProblems } from './decode-probe.mjs';

const args = process.argv.slice(2);

function flag(name) {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
        fail(`${name} requires a value`);
    }
    return value;
}

function fail(message) {
    console.error(`verify-bundle-manifest: ${message}`);
    process.exit(1);
}

const bundle = flag('--bundle');
if (!bundle) fail('--bundle <dir> is required');
const expectHostTarget = flag('--expect-host-target');
// Published-closure role only — see § TWO ROLES. Narrow (it excuses an ABSENT coverage
// record, never a recorded zero) and self-retiring (the run says when it went unused).
const allowLegacyLicenseRecord = args.includes('--allow-legacy-license-record');
// The same narrow, self-retiring shape one field over, and for the same reason § TWO ROLES
// gives: `typelibApi` postdates every tarball published before it, so requiring it outright
// would turn all three published-closure legs red over a property no already-published
// artifact can acquire — the exact mistake `--allow-legacy-license-record` was built to undo,
// and whose removal from `gtk-os-suites.yml` is recorded there. It excuses the record being
// ABSENT and nothing else: a recorded zero, or a gap that names no upstream cause, still fails
// in every role. release.yml passes none of these — there the bundle was just built.
const allowLegacyApiRecord = args.includes('--allow-legacy-api-record');

const manifestPath = join(bundle, 'manifest.json');
let manifest;
try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
    fail(`cannot read ${manifestPath}: ${error.message}`);
}

const problems = [];
// Declared beside `problems` because BOTH legacy allowances write here, and the first of
// them is read further up the file than the licence section that used to own it.
const legacyNotes = [];

if (expectHostTarget) {
    // Both halves against the HOST, not against the caller's claim: the OS so a leg cannot verify
    // a darwin bundle on a Linux runner, the arch so a matrix value and the machine it landed on
    // cannot disagree. That second half is the class that let the emulated prebuild legs stage
    // x86-64 into `prebuilds/linux-ppc64/` with every downstream check green.
    if (process.platform !== expectHostTarget) {
        problems.push(`--expect-host-target ${expectHostTarget} but this runner is ${process.platform}`);
    }
    const want = `${expectHostTarget}-${process.arch}`;
    if (manifest.platform !== want) {
        problems.push(`bundle manifest says platform=${manifest.platform}, this runner is ${want}`);
    }
}

if (manifest.windowing !== true || !(manifest.dataBytes > 0)) {
    problems.push(
        `published bundle must be the windowing superset with runtime data: ` +
            `windowing=${manifest.windowing} dataBytes=${manifest.dataBytes}`,
    );
}

if (!(manifest.typelibSymmetry?.backed > 0)) {
    problems.push(`manifest records no verified typelib symmetry: ${JSON.stringify(manifest.typelibSymmetry)}`);
}

// A BACKED TYPELIB IS NOT A CALLABLE ONE. Symmetry answers "is the library behind this
// namespace here"; it cannot answer "is the FUNCTION here", and the published 0.50.0
// bundles are the proof: both darwin ones carry `adw_about_dialog_new_from_appdata`,
// win32-x64 does not — same namespace, same version, same green symmetry record, and an
// About dialog that does not open on Windows. So the builder's floor record is required,
// which also refuses a bundle assembled by a builder from before the floor existed.
//
// A NARROW, SELF-RETIRING ALLOWANCE for the published-closure role, on the precedent
// `licenses.binariesCovered` set and for the reason its own removal records: a check a
// shipped artifact CANNOT pass is not a gate, it is a permanently red leg. `--allow-legacy-
// api-record` excuses the record being ABSENT there and nothing else, and it SAYS when it
// went unused — which is the day it is deleted from the two call sites.
const typelibApi = manifest.typelibApi;
if (typelibApi === undefined && allowLegacyApiRecord) {
    legacyNotes.push(
        'manifest carries no typelibApi record (allowed: --allow-legacy-api-record, published-closure role) — ' +
            "the entry points of this tarball's namespaces were never checked; the next release carries the record",
    );
} else if (!(typelibApi?.checked > 0)) {
    problems.push(
        `manifest records no typelib API floor check: ${JSON.stringify(typelibApi)} — rebuild with a builder ` +
            'that runs verifyTypelibApiFloor over the finished bundle (packages/node-gi/scripts/typelib-symbols.mjs)',
    );
} else if (!Array.isArray(typelibApi.gaps)) {
    problems.push(`manifest's typelibApi record has no \`gaps\` array: ${JSON.stringify(typelibApi)}`);
} else {
    // A gap may exist; an UNEXPLAINED one may not. The builder already refuses a missing
    // entry point that no gap covers, so what is left to hold here is the record's own
    // honesty — a gap naming no upstream cause is a hole with a note attached, and that
    // note is the only thing a consumer holding the tarball ever gets.
    for (const [index, gap] of typelibApi.gaps.entries()) {
        const named = typeof gap?.upstream?.catalogue === 'string' && gap.upstream.catalogue.length > 0;
        const symbols = Array.isArray(gap?.symbols) && gap.symbols.length > 0;
        const why = typeof gap?.why === 'string' && gap.why.length > 0;
        if (named && symbols && why) continue;
        problems.push(
            `typelibApi.gaps[${index}] does not say what is missing and why upstream: ${JSON.stringify(gap)} — ` +
                'every gap carries `symbols`, `why` and `upstream.catalogue`',
        );
    }
}

if (!(manifest.licenses?.texts > 0)) {
    problems.push(`manifest records no license texts: ${JSON.stringify(manifest.licenses)}`);
}

// A COUNT OF TEXTS IS NOT COVERAGE — the win32 bundles satisfied the line above while
// shipping GLib and OpenSSL with no terms at all, because their license step counted the
// corpus and never looked at a binary. `binariesCovered` is written only by a builder
// whose coverage gate walked the binaries it actually copied, so requiring it here
// refuses an uncovered bundle AND one assembled by a builder from before that gate.
//
// The two cases are NOT the same and are kept apart on purpose (see § TWO ROLES): a
// RECORDED zero is a builder saying it covered nothing, which is fatal wherever it is
// read; an ABSENT field is a manifest older than the record, which only the
// published-closure role can legitimately be handed.
if (manifest.licenses?.binariesCovered === undefined) {
    const problem =
        `manifest records no license coverage over the bundled binaries: ${JSON.stringify(manifest.licenses)} — ` +
        'rebuild with a builder that runs assertLicenseCoverage over every binary it ships';
    if (allowLegacyLicenseRecord) {
        legacyNotes.push(`${problem} (allowed: --allow-legacy-license-record, published-closure role)`);
    } else {
        problems.push(problem);
    }
} else if (!(manifest.licenses.binariesCovered > 0)) {
    problems.push(
        `manifest records license coverage over ZERO bundled binaries: ${JSON.stringify(manifest.licenses)} — ` +
            'the license step ran and covered nothing',
    );
}

const verified = manifest.windowingData?.verified ?? [];
if (!verified.length) {
    problems.push(`manifest records no verified windowing data sets: ${JSON.stringify(manifest.windowingData)}`);
} else {
    // An empty declared data set is the same missing signal as an absent one, and is what shipped
    // in 0.27.1 — so the count, not the presence of the entry, decides.
    const empty = verified.filter((set) => !(set.files > 0));
    if (empty.length) {
        problems.push(`verified windowing data sets with no files: ${JSON.stringify(empty)}`);
    }
}

// And the check the counts above CANNOT make. The darwin-x64 0.28.0 bundle satisfied every
// line so far — `iconFiles: 860`, `verified icons: 863` — while zero of those files decoded:
// two GObject registries (the addon kept absolute Homebrew install names, the bundle shipped
// its own libgio/libgobject) meant `Pixbuf.new_from_file()` on the bundle's own Adwaita SVG
// returned −1×−1. A file count is not a capability. The builder, which is the only thing that
// runs on the target platform, decodes one bundled icon and records the pixel dimensions; this
// asserts that record. Requiring it — rather than treating its absence as "unverified" — is
// what stops a bundle built by an older builder, or with the probe bypassed, from publishing.
// The count checks above stay: they still catch an EMPTY data set, which fails earlier and
// with a clearer cause than a decode that found nothing to open.
problems.push(...decodeProbeProblems(manifest.windowingData?.decodeProbe));

if (problems.length) {
    console.error(`verify-bundle-manifest: ${manifestPath} FAILED ${problems.length} check(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

// The allowance reports itself in BOTH directions, so it cannot quietly become permanent:
// used, it names what it let through; unused, it names itself as deletable. Only the SECOND
// is an event — the first is today's expected state on every published-closure run, and
// annotating it would train the reader to ignore the one line that matters.
for (const note of legacyNotes) console.log(`verify-bundle-manifest: LEGACY — ${note}`);
// AND THE EXPIRY SAYS SO WHERE SOMEBODY LOOKS. A line in the log of a step that PASSED is
// read by nobody, which is how a temporary allowance becomes the permanent state — an
// escape hatch outliving its reason is the next blind spot, not a smaller version of the
// one it patched. So on Actions it is an ANNOTATION, on the run summary and on the PR
// beside the job, while the build stays green: this is a deletion to schedule, not a build
// to break.
if ((allowLegacyLicenseRecord || allowLegacyApiRecord) && legacyNotes.length === 0) {
    const flags = [
        allowLegacyLicenseRecord ? '--allow-legacy-license-record' : null,
        allowLegacyApiRecord ? '--allow-legacy-api-record' : null,
    ]
        .filter(Boolean)
        .join(' and ');
    const expired =
        `verify-bundle-manifest: ${flags} was not needed — this bundle records everything the gate asks ` +
        'for, so the published closure has caught up with it. DELETE the flag from the two call sites in ' +
        '.github/workflows/gtk-os-suites.yml.';
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${expired}` : expired);
}

const sets = verified.map((set) => `${set.id}:${set.files}`).join(' ');
const probe = manifest.windowingData.decodeProbe;
console.log(
    `verify-bundle-manifest: ${manifest.platform} clean — windowing superset, ` +
        `${manifest.typelibSymmetry.backed} backed typelibs carrying ` +
        `${typelibApi === undefined ? 'an unrecorded number of' : `${typelibApi.present.length} of ${typelibApi.checked}`} ` +
        `floor entry point(s) (${typelibApi?.gaps.length ?? 0} declared upstream gap(s)), ` +
        `${manifest.licenses.texts} license texts ` +
        `covering ${manifest.licenses.binariesCovered ?? 'an unrecorded number of'} binaries, ` +
        `${manifest.dataBytes} data bytes, sets ${sets}, ` +
        `decoded ${probe.svg.file} ${probe.svg.width}x${probe.svg.height} + ` +
        `${probe.png.file} ${probe.png.width}x${probe.png.height} through the ${probe.gtkSource} GTK`,
);
