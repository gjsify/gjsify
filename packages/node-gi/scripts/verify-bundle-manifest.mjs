#!/usr/bin/env node
// Gate a GTK runtime bundle on the properties of its own manifest, before publish.
//
// WHY THIS IS A FILE AND NOT AN INLINE `node -e`
//
// It was two inline `node -e '…'` blocks — one in `release.yml`'s darwin job under
// bash, a near-identical copy in the win32 job under pwsh — and both were DEAD ON
// ARRIVAL. The last line of each read
//
//     … data sets ${verified.map((v) => v.id).join('+')}`);
//
// inside a SINGLE-QUOTED shell string. The shell closed the string at the quote
// before `+`, so node received `join(+)` and died with
// `SyntaxError: Unexpected token ')'` before evaluating a single assertion. All
// three publish legs of v0.28.0 failed at that step (run 30932413…/jobs 920781919{09,40},
// 92078192028) while every bundle they were gating was CORRECT — measured from the
// manifests those same steps had already printed: darwin-arm64 `windowing: true`,
// `dataBytes: 20247017`, 25 backed typelibs, 65 license texts; win32-x64 the same
// shape at `dataBytes: 5628218` / 37 texts. `@gjsify/cli`, `@gjsify/node-gi` and
// `@gjsify/napi` published at 0.28.0; the three bundles stayed at 0.27.1 — the one
// version whose defects this gate exists to prevent shipping.
//
// A script file has no shell-quoting layer to get wrong, is ONE copy instead of two
// that must agree across two different shells, and can be tested without a release.
// `release.yml` is `on: release`/`workflow_dispatch` only, so nothing on a PR ever
// executed either block — the same PR-coverage-parity hole AGENTS.md documents for
// `deploy-docs` and `build-ci-image`, paid for once more. The regrow guard is
// `scripts/check-workflow-inline-scripts.mjs`.
//
// WHAT IT ASSERTS, AND WHY EACH LINE IS HERE
//
// Every check below is a property of the ARTIFACT as a consumer holding only the
// tarball can read it — deliberately the manifest and not the build log, because the
// build log is not shipped. Each one names a v0.27.1 defect:
//
//   windowing/dataBytes  — 0.27.1 published the display-free variant (`windowing:
//                          false`, `dataBytes: 0`, no `share/` at all), so every
//                          GSettings-backed API and icon lookup silently misbehaved.
//   typelibSymmetry      — the typelib copy was unfiltered while the seeds were not,
//                          so 0.27.1 shipped `Adw-1.typelib` with NO libadwaita: 6 of
//                          38 darwin typelibs and 3 of 37 win32 ones advertised
//                          constructible types that died with "Failed to load shared
//                          library 'libadwaita-1.0.dylib'" at first use.
//   licenses             — 0.27.1 shipped 37–45 relocated LGPL/MPL/GPL libraries with
//                          no license file of any kind.
//   windowingData.verified — the builder records which declared data sets it verified;
//                          requiring the RECORD means a bundle built by an older
//                          builder, or with the gate bypassed, cannot publish.
//
// Usage:
//   node packages/node-gi/scripts/verify-bundle-manifest.mjs --bundle <dir>
//                                                            [--expect-host-target <os>]
//
// `--expect-host-target darwin` asserts `manifest.platform === darwin-${process.arch}`,
// i.e. that the bundle was built for the machine now verifying it. It reads the
// RUNNER's arch on purpose rather than the matrix value: a matrix/runner mismatch is
// exactly the class that let the emulated prebuild legs stage x86-64 into
// `prebuilds/linux-ppc64/` with every downstream check green.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    // Both halves against the HOST, not against the caller's claim: the OS so a leg
    // cannot verify a darwin bundle on a Linux runner, the arch so a matrix value and
    // the machine it landed on cannot disagree. That second half is the class that let
    // the emulated prebuild legs stage x86-64 into `prebuilds/linux-ppc64/` with every
    // downstream check green — only reading the artifact against the machine caught it.
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

const verified = manifest.windowingData?.verified ?? [];
if (!verified.length) {
    problems.push(`manifest records no verified windowing data sets: ${JSON.stringify(manifest.windowingData)}`);
} else {
    // An empty declared data set is the same missing signal as an absent one, and is
    // what shipped in 0.27.1 — so the count, not the presence of the entry, decides.
    const empty = verified.filter((set) => !(set.files > 0));
    if (empty.length) {
        problems.push(`verified windowing data sets with no files: ${JSON.stringify(empty)}`);
    }
}

if (problems.length) {
    console.error(`verify-bundle-manifest: ${manifestPath} FAILED ${problems.length} check(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

const sets = verified.map((set) => `${set.id}:${set.files}`).join(' ');
console.log(
    `verify-bundle-manifest: ${manifest.platform} clean — windowing superset, ` +
        `${manifest.typelibSymmetry.backed} backed typelibs, ${manifest.licenses.texts} license texts, ` +
        `${manifest.dataBytes} data bytes, sets ${sets}`,
);
