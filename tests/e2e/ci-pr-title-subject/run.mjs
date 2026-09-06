// E2E test for `scripts/check-pr-title-subject.mjs` — the check that holds a PR title
// to commitlint AFTER the squash suffix, because `<title> (#<number>)` is the commit
// that lands on `main`.
//
// Two halves, and both are load-bearing.
//
// The SYNTHETIC half is the script's verdicts beside REAL commitlint's. The script
// mirrors two rules rather than resolving them (its header says why), so the table
// below is not a set of expectations someone thought were right: each row is what
// `@commitlint/lint` answered for that exact string under this repo's resolved
// config, recorded 2026-09-06 with commitlint 19.x. The same run compared the two
// over the last 600 first-parent subjects on `main` plus these rows — 619 strings,
// zero disagreements. To re-measure after a commitlint bump, lint each `subject`
// below with `@commitlint/lint` + `@commitlint/load` against `commitlint.config.cjs`
// and compare its `header-max-length` / `subject-case` errors with `fails`.
//
// The rows are chosen where the mirror could plausibly be wrong rather than where it
// obviously is not: quoted first words (commitlint strips `` ` ``/"/' spans before
// judging case), a `!` breaking-change header (a different parse), a title-case
// letter (upper-cased into a DIFFERENT character, so not flagged), a digit and an em
// dash in first position, non-ASCII upper case, and the two lengths that straddle
// the limit only once the suffix is appended.
//
// The REAL-TREE half asserts the wiring. A check nothing invokes is not a check, and
// this one lives in a workflow step rather than in the audit job, because only a
// `pull_request` event carries a title at all.
//
// The four subjects named `INCIDENT` are the merges this check exists for: each one
// went green on its PR and turned `main` red on the merge commit, which cannot be
// repaired without rewriting history.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-pr-title-subject/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'check-pr-title-subject.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'commitlint.yml');

function spawn(env) {
    const result = execFileSync(process.execPath, [SCRIPT], {
        encoding: 'utf-8',
        cwd: MONOREPO_ROOT,
        env: { ...process.env, ...env },
        // A rejected title exits 1, which is the answer rather than a crash.
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: result, stderr: '' };
}

// `execFileSync` throws on a non-zero exit, so the failing rows need the error object
// rather than a return value. Wrapped here so the table stays about titles.
function spawnEither(env) {
    try {
        return spawn(env);
    } catch (error) {
        return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
    }
}

/** Every row: `[title, number, failing rules, note]`. An empty rules list means green. */
const TABLE = [
    ['feat: Effect on GJS, and a GNOME platform layer', 1590, ['subject-case'], 'INCIDENT (2026-09-06)'],
    ['feat: effect on GJS, and a GNOME platform layer', 1590, [], 'the same title, repaired'],
    ['feat(rolldown-plugin-gjsify): Blueprint in libraries', 1275, ['subject-case'], 'INCIDENT (2026-08-24)'],
    ['feat: `Effect` on GJS', 1, [], 'a backtick-quoted first word is stripped before the case test'],
    ['feat: "Effect" on GJS', 1, [], 'so is a double-quoted one'],
    ["feat: 'Effect' on GJS", 1, [], 'and a single-quoted one'],
    ['feat(scope)!: A breaking change', 1, ['subject-case'], 'the `!` header parses to the same subject'],
    ['feat(scope)!: a breaking change', 1, [], 'and passes when the subject is lower-case'],
    ['fix: 3 things', 1, [], 'a digit is not a cased letter — the rule returns early'],
    ['fix: ǅ thing', 1, [], 'a title-case letter upper-cases to a DIFFERENT character, so it is not flagged'],
    ['chore: ÜBERALL uppercase', 1, ['subject-case'], 'upper case is not ASCII-only'],
    ['docs: Ärger mit Umlauten', 1, ['subject-case'], 'nor is sentence case'],
    ['docs: ärger mit umlauten', 1, [], 'the same subject, lower-cased'],
    ['feat: a Tree', 1, [], 'a capital later in the subject is nobody’s finding'],
    ['feat: — a dash', 1, [], 'a non-letter first character passes'],
    ['Run the transparent addon matrix in CI', 849, [], 'no conventional header: the PR-title step owns that, #849'],
    [
        'feat(storybook): appearance settings on all three targets, and the Adwaita accent palette in core',
        1127,
        ['header-max-length'],
        'INCIDENT (2026-08-13): 97 characters, and 105 with the suffix',
    ],
    [
        'feat(adwaita-nativescript): render <adw-shortcut-label>, and gate the theme against its own class names',
        1125,
        ['header-max-length'],
        'INCIDENT (2026-08-13): 111 with the suffix',
    ],
];

describe('check-pr-title-subject: the squash subject a PR title becomes', () => {
    for (const [title, number, expected, note] of TABLE) {
        it(`${expected.length === 0 ? 'accepts' : `rejects (${expected.join(', ')})`} "${title}" — ${note}`, () => {
            const result = spawnEither({ PR_TITLE: title, PR_NUMBER: String(number) });
            const output = `${result.stdout}${result.stderr}`;
            const rules = [
                ...(/limit of \d+/.test(output) ? ['header-max-length'] : []),
                ...(/starts upper-case/.test(output) ? ['subject-case'] : []),
            ];
            assert.deepEqual(rules, expected, `wrong rules for ${JSON.stringify(title)}:\n${output}`);
            assert.equal(
                result.status === 0,
                expected.length === 0,
                `exit code disagrees with the rules it reported:\n${output}`,
            );
        });
    }

    it('refuses to run outside a pull_request job rather than passing an empty title', () => {
        const result = spawnEither({ PR_TITLE: '', PR_NUMBER: '1' });
        assert.equal(result.status, 1);
        assert.match(`${result.stdout}${result.stderr}`, /PR_TITLE is empty/);
    });

    it('names the suffix, not just the title, when the subject is too long', () => {
        // The half that made #1127 possible: a title UNDER the limit on its own.
        const title = `feat: ${'x'.repeat(94)}`;
        assert.equal(title.length, 100);
        const result = spawnEither({ PR_TITLE: title, PR_NUMBER: '1127' });
        assert.equal(result.status, 1);
        assert.match(`${result.stdout}${result.stderr}`, /GitHub appends adds 8/);
    });
});

describe('check-pr-title-subject: the wiring', () => {
    const workflow = readFileSync(WORKFLOW, 'utf-8');

    it('is invoked by commitlint.yml', () => {
        assert.match(workflow, /run: node scripts\/check-pr-title-subject\.mjs/);
    });

    it('is given both halves of the composed subject', () => {
        // A step with the title and no number checks a string GitHub never writes.
        assert.match(workflow, /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
        assert.match(workflow, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
    });

    it('runs only on a pull_request, where a title exists', () => {
        const step = workflow.slice(workflow.indexOf('- name: Check the squash subject the PR title becomes'));
        const untilNextStep = step.slice(0, step.indexOf('\n      - name:'));
        assert.match(untilNextStep, /if: github\.event_name == 'pull_request'/);
    });
});
