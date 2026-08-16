// E2E test: every output the `changes` job publishes must GATE something.
//
// WHY THIS EXISTS
//
// The selective-CI classifier emits its verdict as job outputs, and each one is
// a promise that some job reads it. `run-integration` was emitted for months
// and read by exactly one place: a `printf` in the step summary. So the
// classifier correctly decided "this PR needs the integration suites", printed
// that decision, and nothing acted on it — the 35 suites ran on no event at
// all. Nothing was red, because an output that gates nothing cannot be red.
//
// That is the shape this file catches: not a wrong answer, an unread one. It is
// cheap to reintroduce — adding an output is one line, and wiring it to a job
// is a different edit in a different part of the file, so the two drift apart
// silently and in the safe-looking direction.
//
// WHAT COUNTS AS GATING
//
// The output must appear in some job's `if:` expression. Appearing in an `env:`
// or a `run:` is explicitly NOT enough: that is how `run-integration` looked
// while gating nothing. A diagnostic-only output is legitimate and must say so
// by name in DIAGNOSTIC_ONLY below, with its reason — an honest "reports, never
// gates" is available, a silent one is not. Same shape as
// `scripts/e2e-unlisted-suites.mjs` and `scripts/manifest-conformance/unchecked-fields.mjs`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-classifier-output-coverage/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const MAIN_YML = join(MONOREPO_ROOT, '.github', 'workflows', 'main.yml');

/**
 * Outputs that legitimately never gate a job, each with the reason.
 *
 * The reason must say what the output is FOR. "Not used yet" is not a reason —
 * that is the defect this file exists to find, and parking it here would turn
 * the ledger into the place the finding goes to die.
 */
export const DIAGNOSTIC_ONLY = {
    reason: [
        'A human-readable sentence explaining the classifier’s verdict ("docs-only change", ',
        '"global trigger: packages/infra/cli/**"). It is rendered into the run’s step summary so ',
        'the person reading a skipped leg learns WHY it skipped. Gating on a prose string would ',
        'be a bug, not a feature — the machine-readable half of the same verdict is `skip-all` / ',
        '`global` / `include-args`, and those three do gate.',
    ].join(''),
};

/** The `changes` job's declared outputs, in file order. */
export function classifierOutputs(lines) {
    const jobAt = lines.findIndex((l) => /^ {2}changes:\s*$/.test(l));
    if (jobAt < 0) throw new Error('no `changes:` job in main.yml');
    const outAt = lines.slice(jobAt).findIndex((l) => /^ {4}outputs:\s*$/.test(l));
    if (outAt < 0) throw new Error('the `changes` job declares no `outputs:` block');
    const names = [];
    for (const line of lines.slice(jobAt + outAt + 1)) {
        const m = /^ {6}([A-Za-z0-9_-]+):/.exec(line);
        if (!m) break;
        names.push(m[1]);
    }
    return names;
}

/**
 * Every `if:` expression in the file, joined.
 *
 * Deliberately only `if:` — see the header. A multi-line `if:` written as a
 * block scalar would be missed, so the shape is asserted rather than assumed:
 * `assertNoBlockScalarIfs` fails if one ever appears, instead of letting this
 * check quietly stop covering it.
 */
export function ifExpressions(lines) {
    return lines.filter((l) => /^\s+if:/.test(l)).join('\n');
}

/** `if: |` / `if: >` would put the expression on FOLLOWING lines, out of reach above. */
export function blockScalarIfs(lines) {
    return lines.filter((l) => /^\s+if:\s*[|>]/.test(l));
}

/** Outputs that no job's `if:` reads. */
export function ungatingOutputs(lines) {
    const ifs = ifExpressions(lines);
    return classifierOutputs(lines).filter((name) => !ifs.includes(`needs.changes.outputs.${name}`));
}

const LINES = readFileSync(MAIN_YML, 'utf8').split('\n');

describe('classifier outputs', () => {
    it('declares the set this check knows how to read', () => {
        const outputs = classifierOutputs(LINES);
        // Not pinned to an exact list — that would need editing on every
        // legitimate addition and would teach people to edit it thoughtlessly.
        // What IS asserted: the block was found and is not empty, so a parser
        // that silently stopped matching cannot report "all zero outputs gate".
        assert.ok(outputs.length >= 4, `expected the changes job to declare several outputs, got ${outputs.length}`);
        assert.ok(outputs.includes('skip-all'), 'skip-all missing — the parser is probably reading the wrong block');
    });

    it('has no block-scalar `if:`, which this check could not see', () => {
        assert.deepEqual(
            blockScalarIfs(LINES),
            [],
            'an `if:` written as a block scalar puts its expression on following lines, where ' +
                'ifExpressions() does not look. Extend the parser before adding one.',
        );
    });

    it('every output gates a job, or is declared diagnostic-only', () => {
        const unexplained = ungatingOutputs(LINES).filter((n) => !(n in DIAGNOSTIC_ONLY));
        assert.deepEqual(
            unexplained,
            [],
            `these \`changes\` outputs gate no job's \`if:\`: ${unexplained.join(', ')}. ` +
                'An output nothing reads is a decision CI makes and then ignores — the classifier ' +
                'says the work is needed and no job runs it, with nothing red to show for it. ' +
                'Wire it into a job, or add it to DIAGNOSTIC_ONLY with the reason it only reports.',
        );
    });

    it('the diagnostic-only ledger names no output that has gone away', () => {
        const declared = new Set(classifierOutputs(LINES));
        const stale = Object.keys(DIAGNOSTIC_ONLY).filter((n) => !declared.has(n));
        assert.deepEqual(
            stale,
            [],
            `DIAGNOSTIC_ONLY names output(s) the classifier no longer emits: ${stale.join(', ')}`,
        );
    });

    it('the diagnostic-only ledger names no output that DOES gate', () => {
        // The other direction, and the one that rots quietly: an output parked
        // here and later wired up stays exempt forever, so the next unread
        // output added beside it inherits an exemption nobody re-read.
        const ifs = ifExpressions(LINES);
        const nowGating = Object.keys(DIAGNOSTIC_ONLY).filter((n) => ifs.includes(`needs.changes.outputs.${n}`));
        assert.deepEqual(
            nowGating,
            [],
            `DIAGNOSTIC_ONLY names output(s) that now gate a job: ${nowGating.join(', ')}. Remove the entry.`,
        );
    });
});

describe('the check itself can fail', () => {
    // A gate nobody has watched fail is a gate nobody knows the shape of. These
    // drive the same functions over synthetic files, so the discriminator is
    // proven here rather than asserted in a commit message.
    const synthetic = (outputs, ifs) =>
        [
            'jobs:',
            '  changes:',
            '    outputs:',
            ...outputs.map((o) => `      ${o}: \${{ steps.classify.outputs.${o} }}`),
            '    steps:',
            '      - run: true',
            '  build:',
            ...ifs.map((e) => `    if: \${{ ${e} }}`),
            '    steps:',
            '      - run: true',
        ]
            .join('\n')
            .split('\n');

    it('reports an output that only appears in an env block', () => {
        const lines = [
            ...synthetic(['skip-all', 'run-widgets'], ["needs.changes.outputs.skip-all != 'true'"]),
            '      env:',
            '        C_WIDGETS: ${{ needs.changes.outputs.run-widgets }}',
        ];
        assert.deepEqual(ungatingOutputs(lines), ['run-widgets']);
    });

    it('accepts an output once a job’s `if:` reads it', () => {
        const lines = synthetic(
            ['skip-all', 'run-widgets'],
            ["needs.changes.outputs.skip-all != 'true'", "needs.changes.outputs.run-widgets == 'true'"],
        );
        assert.deepEqual(ungatingOutputs(lines), []);
    });

    it('sees a block-scalar `if:` as unreadable rather than as absent', () => {
        const lines = ['jobs:', '  build:', '    if: >', "      needs.changes.outputs.run-widgets == 'true'"];
        assert.equal(blockScalarIfs(lines).length, 1);
    });
});
