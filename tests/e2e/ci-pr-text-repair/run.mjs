// E2E test for `scripts/repair-pr-text.mjs` — the job in `commitlint.yml` that edits a PR's
// title and body before the checks judge them.
//
// The oracle is NOT this file's idea of a good title: every repaired string is fed to the
// check scripts the required `Lint commit messages` check runs, and a repair counts only if
// they pass it. The other direction matters as much — what needs a decision (an unknown type,
// a subject too long for `<title> (#N)`) must come back unchanged so the check still reports it.
//
// The INCIDENT rows are the merges the checks exist for; see the check scripts' headers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-pr-text-repair/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const REPAIR = join(MONOREPO_ROOT, 'scripts', 'repair-pr-text.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'commitlint.yml');

const { repairTitle, repairBody, wrapLine } = await import(`file://${REPAIR}`);

function check(script, env) {
    const result = spawnSync(process.execPath, [join(MONOREPO_ROOT, 'scripts', script)], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });
    return result.status;
}

const titlePasses = (title) => check('check-pr-title-subject.mjs', { PR_TITLE: title, PR_NUMBER: '2100' }) === 0;
const bodyPasses = (body) => check('check-pr-body-lines.mjs', { PR_BODY: body }) === 0;

describe('repair-pr-text: the title', () => {
    /**
     * `[title, repaired, note, judgedHere]`. `judgedHere` is false where the title-FORM rule
     * catches the original — `amannn/action-semantic-pull-request`, which this suite cannot run.
     */
    const REPAIRED = [
        [
            'feat: Effect on GJS, and a GNOME platform layer',
            'feat: effect on GJS, and a GNOME platform layer',
            'INCIDENT #1590',
        ],
        [
            'feat(rolldown-plugin-gjsify): Blueprint in libraries',
            'feat(rolldown-plugin-gjsify): blueprint in libraries',
            'INCIDENT #1275',
        ],
        [
            'docs: ADR 0065 for linked packages',
            'docs: `ADR` 0065 for linked packages',
            'an acronym is quoted, not mangled',
        ],
        ['fix: TypeScript, not JS', 'fix: `TypeScript`, not JS', 'so is a camel-cased name, punctuation kept outside'],
        ['Feat : add a thing.', 'feat: add a thing', 'type case, colon spacing and the full stop', false],
        ['fix(scope)!:   Break   it', 'fix(scope)!: break it', 'the `!` header and whitespace runs', false],
        ['docs: Ärger mit Umlauten', 'docs: ärger mit Umlauten', 'upper case is not ASCII-only'],
    ];
    for (const [title, expected, note, judgedHere = true] of REPAIRED) {
        it(`repairs "${title}" — ${note}`, () => {
            if (judgedHere) assert.equal(titlePasses(title), false, 'the row must start red, or it tests nothing');
            const repaired = repairTitle(title);
            assert.equal(repaired, expected);
            assert.ok(titlePasses(repaired), `the check still rejects "${repaired}"`);
        });
    }

    /** What needs a decision comes back as it was, so the check still names it. */
    const LEFT = [
        ['feat: add the thing', 'already fine'],
        ['feat: `Effect` on GJS', 'already quoted'],
        ['feature: add a thing', 'a type outside the enum is a CHANGELOG decision'],
        ['Add a thing', 'no conventional header at all'],
        [`feat: ${'long '.repeat(20).trim()}`, 'too long for the squash subject'],
    ];
    for (const [title, note] of LEFT) {
        it(`leaves "${title.slice(0, 40)}" alone — ${note}`, () => {
            assert.equal(repairTitle(title), title);
        });
    }
});

describe('repair-pr-text: the body', () => {
    const LONG =
        'This paragraph was written in the web editor as one long line, which is how every description ' +
        'that broke `main` on body-max-line-length started out before somebody wrapped it by hand.';

    it('wraps an over-long prose line under the limit', () => {
        assert.equal(bodyPasses(LONG), false);
        const { body, moved } = repairBody(LONG);
        assert.deepEqual(moved, []);
        assert.ok(bodyPasses(body));
        assert.equal(body.replace(/\n/g, ' '), LONG);
    });

    it('keeps a list marker on the first line and indents the rest under it', () => {
        const lines = wrapLine(`- ${LONG}`);
        assert.ok(lines.length > 1);
        assert.ok(lines[0].startsWith('- '));
        for (const line of lines.slice(1)) assert.match(line, /^ {2}\S/);
    });

    it('keeps a quote prefix on every line', () => {
        for (const line of wrapLine(`> ${LONG}`)) assert.match(line, /^> /);
    });

    it('never starts a continuation with something markdown reads as a new block', () => {
        const tricky = `${'word '.repeat(19)}- and then ${'more '.repeat(10)}`.trim();
        for (const line of wrapLine(tricky).slice(1)) {
            assert.doesNotMatch(line, /^([-*+]|\d+[.)]|#{1,6}|>|\|) /);
        }
    });

    it('drops the session URL and the co-author trailer, and keeps the attribution line', () => {
        // INCIDENT #1699: green on every line length, and b3590e8fec carries the URL forever.
        const input = [
            'Summary.',
            '',
            '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
            'https://claude.ai/code/session_01EsCgGTiQa1JB2rxg25zxHH',
            'Co-Authored-By: Claude <noreply@anthropic.com>',
        ].join('\n');
        assert.equal(bodyPasses(input), false);
        const { body } = repairBody(input);
        assert.ok(bodyPasses(body));
        assert.match(body, /Generated with \[Claude Code\]/);
    });

    it('moves an over-long table into the comment and leaves a pointer', () => {
        // The shape of 03c49edc5f and its siblings: a table pasted in just before merging.
        const table = ['| a | b |', '|---|---|', `| ${'x'.repeat(120)} | y |`].join('\n');
        const { body, moved } = repairBody(`Intro.\n\n${table}\n\nOutro.`);
        assert.deepEqual(moved, [table]);
        assert.ok(bodyPasses(body));
        assert.match(body, /table moved to a PR comment/);
        assert.match(body, /^Outro\.$/m);
    });

    it('moves an over-long fenced block whole, and leaves a short one in place', () => {
        const long = ['```', 'x'.repeat(130), '```'].join('\n');
        const short = ['```', 'echo ok', '```'].join('\n');
        const { body, moved } = repairBody(`${short}\n\n${long}`);
        assert.deepEqual(moved, [long]);
        assert.match(body, /^echo ok$/m);
    });

    it('returns a body that needs nothing byte for byte, CRLF included', () => {
        const input = 'first line\r\nsecond line\r\n';
        assert.equal(repairBody(input).body, input);
        assert.equal(repairBody(null).body, '');
    });

    it('leaves a heading and an unbreakable word long, so the check still names them', () => {
        const heading = `## ${'heading '.repeat(15)}`;
        const url = `https://example.org/${'a'.repeat(120)}`;
        assert.equal(repairBody(heading).body, heading);
        assert.equal(repairBody(url).body, url);
    });
});

describe('repair-pr-text: the wiring', () => {
    const yaml = readFileSync(WORKFLOW, 'utf8');
    const repairJob = yaml.slice(yaml.indexOf('  repair-text:'), yaml.indexOf('  commitlint:'));
    const lintJob = yaml.slice(yaml.indexOf('  commitlint:'), yaml.indexOf('  clear-superseded:'));

    it('holds the write token in a job that checks out no head code', () => {
        assert.match(repairJob, /pull-requests: write/);
        assert.match(repairJob, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
        assert.match(repairJob, /sparse-checkout: \|\n\s+commitlint\.config\.cjs\n\s+scripts\/repair-pr-text\.mjs/);
    });

    it('runs before the lint, and the lint still runs when the repair did not', () => {
        // A required check that does not run blocks the PR forever — a push or merge_group
        // skips the repair, and a fork PR's repair may fail.
        assert.match(lintJob, /needs: repair-text\n/);
        assert.match(lintJob, /if: \$\{\{ !cancelled\(\) \}\}/);
    });

    it('lints the landing commits only where a commit is what lands', () => {
        const step = lintJob.slice(lintJob.indexOf('- name: Lint the landing commits'));
        const untilNextStep = step.slice(0, step.indexOf('\n      - name:'));
        assert.match(untilNextStep, /if: github\.event_name != 'pull_request'/);
    });

    it('no-ops instead of failing when the PR base predates the script', () => {
        const guard = repairJob.indexOf('[ ! -f scripts/repair-pr-text.mjs ]');
        assert.notEqual(guard, -1);
        assert.ok(guard < repairJob.indexOf('node scripts/repair-pr-text.mjs'));
    });
});
