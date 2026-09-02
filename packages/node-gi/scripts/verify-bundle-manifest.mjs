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
// Usage:
//   node packages/node-gi/scripts/verify-bundle-manifest.mjs --bundle <dir>
//                                                            [--expect-host-target <os>]

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

const manifestPath = join(bundle, 'manifest.json');
let manifest;
try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
    fail(`cannot read ${manifestPath}: ${error.message}`);
}

const problems = [];

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

if (!(manifest.licenses?.texts > 0)) {
    problems.push(`manifest records no license texts: ${JSON.stringify(manifest.licenses)}`);
}

// A COUNT OF TEXTS IS NOT COVERAGE — the win32 bundles satisfied the line above while
// shipping GLib and OpenSSL with no terms at all, because their license step counted the
// corpus and never looked at a binary. `binariesCovered` is written only by a builder
// whose coverage gate walked the binaries it actually copied, so requiring it here
// refuses an uncovered bundle AND one assembled by a builder from before that gate.
if (!(manifest.licenses?.binariesCovered > 0)) {
    problems.push(
        `manifest records no license coverage over the bundled binaries: ${JSON.stringify(manifest.licenses)} — ` +
            'rebuild with a builder that runs assertLicenseCoverage over every binary it ships',
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

const sets = verified.map((set) => `${set.id}:${set.files}`).join(' ');
const probe = manifest.windowingData.decodeProbe;
console.log(
    `verify-bundle-manifest: ${manifest.platform} clean — windowing superset, ` +
        `${manifest.typelibSymmetry.backed} backed typelibs, ${manifest.licenses.texts} license texts ` +
        `covering ${manifest.licenses.binariesCovered} binaries, ` +
        `${manifest.dataBytes} data bytes, sets ${sets}, ` +
        `decoded ${probe.svg.file} ${probe.svg.width}x${probe.svg.height} + ` +
        `${probe.png.file} ${probe.png.width}x${probe.png.height} through the ${probe.gtkSource} GTK`,
);
