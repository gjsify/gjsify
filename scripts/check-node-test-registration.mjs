#!/usr/bin/env node
// Every `*.spec.ts` in a package reaches a runner, or it is not a test.
//
// THE INCIDENT
//
// `packages/infra/cli/src/utils/ship/discover-license.spec.ts` was written with seven
// cases, run, and reported green — while `src/test.mts` did not import it. A package's
// specs reach `@gjsify/unit` through exactly one path: the hand-written `run({…})` call
// in its test entry. A spec that is not in that call stays on disk, stays type-checked
// by `include: src/**/*.ts`, and stops being a test. Nothing said so. It was caught by
// counting — 2497 completed where +8 was due — which works only if someone knows the
// number they expected.
//
// The sibling rule for the BROWSER entry already exists
// (`check-browser-test-registration.mjs`, written after a spec set shrank unnoticed in
// `packages/web/adwaita-web`). This is the same rule for every other entry, and the
// reason it is a separate script rather than a flag on that one is scope: the browser
// rule is "every spec, in browser-ONLY packages"; this one is "every spec, in every
// package, through ANY of its entries".
//
// WHAT REACHABILITY MEANS, and why it is not "is imported by the entry"
//
// A spec may be imported by another SPEC — `packages/node/fs/src/capabilities.spec.ts`
// is a shared helper for six of them, `packages/node/child_process/src/commands.spec.ts`
// for two. Those are registered, transitively, and a rule that only looked at entries
// would report seven false violations on the day it landed. So the set is closed over
// spec-to-spec imports, starting from every `src/test*.mts` the package has: the node
// entry, the browser entry, the node-gi entry, whatever else appears. One reachable
// path is enough — a spec belonging to the browser leg is not orphaned by being absent
// from the node leg.
//
// Reading the entries — the walk, the four import spellings, the closure — is
// `scripts/suite-registration.mjs`, which is also where the driver gate now gets its
// answer from. It reports TWO facts about a spec, and this file asks for the weaker
// one: `reachable`, "some entry imports it". The stronger one, `live` ("an entry hands
// its suite to `run({…})`"), is deliberately not gated here — `packages/web/webrtc`
// awaits its four spec defaults instead of registering them, and a package with several
// entries registers a leg-appropriate subset in each. Gating reachability repo-wide and
// liveness where a caller can justify it is the split that holds.
//
// Usage: node scripts/check-node-test-registration.mjs [--root <dir>]

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageDirs, readSuiteRegistration } from './suite-registration.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (rootFlag !== -1 && args[rootFlag + 1] === undefined) {
    console.error('check-node-test-registration: --root needs a directory.');
    process.exit(2);
}
const ROOT =
    rootFlag === -1
        ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
        : resolve(process.cwd(), args[rootFlag + 1]);

const violations = [];
let packagesChecked = 0;
let specsChecked = 0;

for (const pkg of packageDirs(join(ROOT, 'packages'))) {
    const { entries, specs, reachable } = readSuiteRegistration(pkg);
    if (entries.length === 0 || specs.length === 0) continue;
    packagesChecked++;
    specsChecked += specs.length;

    for (const spec of specs.sort()) {
        if (!reachable.has(spec)) {
            violations.push({ spec: relative(ROOT, spec), entries: entries.map((entry) => relative(pkg, entry)) });
        }
    }
}

if (violations.length > 0) {
    console.error('check-node-test-registration: spec files no test entry reaches.\n');
    for (const { spec, entries } of violations) {
        console.error(`  ${spec}`);
        console.error(`      not imported by, or through, any of: ${entries.join(', ')}`);
    }
    console.error(
        '\nA spec that no entry imports never runs, and nothing else in the repository will\n' +
            'say so — it stays on disk and stays type-checked. Add it to the `run({…})` call in\n' +
            'the entry it belongs to, or delete it if what it asserts is covered elsewhere.\n',
    );
    process.exit(1);
}

console.log(
    `check-node-test-registration: ${specsChecked} spec file(s) across ${packagesChecked} package(s) ` +
        'all reach a test entry.',
);
