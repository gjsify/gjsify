#!/usr/bin/env node
// Every `continue-on-error` step must be ADDRESSABLE and must be READ.
//
// THE CLASS (#1552). A `continue-on-error: true` step reports its conclusion as
// `success` whatever it did, so the PR page, `gh pr checks` and every API reader
// see green. `steps.<id>.outcome` is the only record — and a step with no `id`
// does not even have that. Measured by this check on the tree that introduced it:
// 18 such steps across 6 workflows (plus one JOB-level flag, below), of which 10
// — `cli-cross-platform.yml`'s diagnostic sweep — already carried ids and a
// summary table, and 8 did not. Three probes were red on the run that prompted
// the issue, two of them for a defect nobody had counted (#1556).
//
// SO TWO THINGS ARE CHECKED, and the first is what makes the second possible:
//
//   1. the step has an `id`;
//   2. the workflow reads `steps.<id>.outcome` somewhere.
//
// FILE SCOPE, NOT JOB SCOPE, for the reason the neighbouring workflow checks give:
// no YAML library is available here. The audit job that runs this does no install
// and no build — importing `yaml` cost one red PR before that constraint was
// believed — so every reader in `scripts/` is lexical. A step id is unique within
// its job, and a reference from a DIFFERENT job would be a workflow that does not
// run; that is a mistake this check would miss and `actionlint` catches, because
// an unknown `steps.<id>` context is an error there.
//
// WHAT IT DOES NOT DO: demand that the outcome FAIL anything. These probes are
// `continue-on-error` because something below them is knowably broken, each with a
// written retirement condition in the workflow. The rule is that what they
// measured is visible, not that it gates.
//
// Usage: node scripts/check-probe-outcomes-read.mjs [--root <dir>]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The probe walk itself lives in `workflow-probes.mjs`, shared with
// `check-probe-retirement.mjs`. Two hand-rolled copies of "what a probe is" would come to
// know two different sets of steps, and the one that fell out of a copy would be invisible
// in exactly the way both checks exist to end.
import { envValueOf, listProbes, stepBlockContaining } from './workflow-probes.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

const failures = [];
const probeList = listProbes(ROOT);

for (const probe of probeList) {
    const { rel, label, id, line, text, lines } = probe;
    if (id === undefined) {
        failures.push(
            `${rel}: the continue-on-error step "${label}" has no \`id\`, so its OUTCOME is not addressable ` +
                'at all — the only record of what it did is a log nobody opens.',
        );
        continue;
    }
    if (!text.includes(`steps.${id}.outcome`)) {
        failures.push(
            `${rel}:${line}: nothing reads \`steps.${id}.outcome\` ("${label}"). GitHub forces this step's ` +
                'CONCLUSION to success, so the PR reads green whatever it did. Report it with ' +
                '`scripts/report-probe-outcome.mjs`.',
        );
        continue;
    }

    // THE LABEL IS AN IDENTITY, NOT A CAPTION — and this is the half that was missing.
    //
    // `PROBE_LABEL` is what the reporter prints and what survives on the check run as an
    // annotation; the step `name` is what the API calls the step. Nothing coupled the two,
    // so they were free to be different sentences about the same step — and one pair WAS:
    // `conformance-win32` was named "Conformance audit (os-axis + the staged bundle's media
    // claim)" and labelled "Conformance audit — win32 media claim vs the PUBLISHED payload
    // (red until the release carrying gstvorbis.dll, #1626)". Any reader joining the two
    // records on the name then finds no annotation for a step that HAS them, and reads a
    // permanently red probe as green. `check-probe-retirement.mjs`'s `probe-green` did
    // exactly that, and reported a promotion for a step that has never passed.
    //
    // So the label is held to the name. The caption a reader wants still exists — it is the
    // step name, which is what the log, the PR page and the summary already show.
    //
    // Only when a `PROBE_LABEL` is declared at all: `cli-cross-platform.yml`'s ten-step
    // sweep reports its outcomes through a summary TABLE and passes no label, which is a
    // different reporting shape rather than a defect. What that costs is stated where it
    // lands — `check-probe-retirement.mjs`'s `probe-green` refuses a probe with no label,
    // because there is then no annotation it could join to the step.
    const reader = stepBlockContaining(lines, `steps.${id}.outcome`);
    const declared = reader === null ? undefined : envValueOf(reader, 'PROBE_LABEL');
    if (declared !== undefined && declared !== label) {
        failures.push(
            `${rel}:${line}: \`PROBE_LABEL\` is not this step's \`name\`, so the annotation it writes cannot ` +
                'be joined back to the step it is about — which is how a never-green probe was read as green.\n' +
                `      name:        ${label}\n` +
                `      PROBE_LABEL: ${declared}`,
        );
    }
}

if (failures.length > 0) {
    console.error(`check-probe-outcomes-read: ${failures.length} unreported probe(s).\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
        '\n  A continue-on-error step is a measurement whose result GitHub throws away.\n' +
            '  Give it an `id`, and add a step that reports `steps.<id>.outcome`:\n\n' +
            '      - name: Probe outcome — <what ran>\n' +
            '        if: always()\n' +
            '        env:\n' +
            '          PROBE_LABEL: <what ran>\n' +
            '          PROBE_OUTCOME: ${{ steps.<id>.outcome }}\n' +
            '        run: node scripts/report-probe-outcome.mjs\n',
    );
    process.exit(1);
}

console.log(
    `check-probe-outcomes-read: ${probeList.length} continue-on-error step(s), every outcome addressable and read.`,
);
