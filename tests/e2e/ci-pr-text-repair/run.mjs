// E2E test for `scripts/repair-pr-text.mjs` — the job in `commitlint.yml` that edits a PR's
// title and body before the checks judge them.
//
// The oracle is NOT this file's idea of a good title: every repaired string is fed to the
// check scripts the required `Lint commit messages` check runs, and a repair counts only if
// they pass it. The other direction matters as much — what needs a decision (an unknown type,
// a header no branch can supply) must come back unchanged so the check still reports it.
//
// Two of the repairs have no local check that reds the ORIGINAL: the type-enum and the
// title-FORM rules live in `amannn/action-semantic-pull-request`, which this suite cannot
// run. Rows for those carry `judgedHere: false`, like `Feat :` below — they still prove the
// repaired string passes `check-pr-title-subject.mjs`.
//
// The INCIDENT rows are the merges the checks exist for; see the check scripts' headers.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-pr-text-repair/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const REPAIR = join(MONOREPO_ROOT, 'scripts', 'repair-pr-text.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'commitlint.yml');

const { repairTitle, repairBody, repairPr, wrapLine } = await import(`file://${REPAIR}`);

function check(script, env, { cwd = MONOREPO_ROOT } = {}) {
    const result = spawnSync(process.execPath, [join(MONOREPO_ROOT, 'scripts', script)], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });
    return result.status;
}

const titlePasses = (title) => check('check-pr-title-subject.mjs', { PR_TITLE: title, PR_NUMBER: '2100' }) === 0;
const bodyPasses = (body) => check('check-pr-body-lines.mjs', { PR_BODY: body }) === 0;

describe('repair-pr-text: the title', () => {
    /**
     * `[title, repaired, note, judgedHere = true, options]`. `judgedHere` is false where the
     * title-FORM or type-enum rule catches the original — `amannn/action-semantic-pull-request`,
     * which this suite cannot run — and where `options.branch` drives the repair.
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
        ['Features: Add things', 'feat: add things', '`Features` → `feat`, red on subject-case too'],
        ['feature: add a thing', 'feat: add a thing', '`feature` is `feat`', false],
        ['bugfix: retry the fetch', 'fix: retry the fetch', '`bugfix` is `fix`', false],
        ['Documentation: rewrite the guide', 'docs: rewrite the guide', '`Documentation` is `docs`', false],
        ['performance: warm the cache', 'perf: warm the cache', '`performance` is `perf`', false],
        ['chores: tidy the fixtures', 'chore: tidy the fixtures', '`chores` is `chore`', false],
        ['Refactoring: split the client', 'refactor: split the client', '`Refactoring` is `refactor`', false],
        ['builds: rebuild the bundle', 'build: rebuild the bundle', '`builds` is `build`', false],
        ['tests: exercise the matrix', 'test: exercise the matrix', '`tests` is `test`', false],
        [
            'Add the transparent addon matrix in CI',
            'ci: add the transparent addon matrix in CI',
            'the branch `ci/…` supplies the missing type',
            false,
            { branch: 'ci/transparent-addon-matrix' },
        ],
        [
            'Support the hotfixed path',
            'fix: support the hotfixed path',
            'a `hotfix-…` branch and its synonym',
            false,
            { branch: 'hotfix-1234' },
        ],
    ];
    for (const [title, expected, note, judgedHere = true, options = {}] of REPAIRED) {
        it(`repairs "${title}" — ${note}`, () => {
            if (judgedHere) assert.equal(titlePasses(title), false, 'the row must start red, or it tests nothing');
            const repaired = repairTitle(title, options);
            assert.equal(repaired, expected);
            assert.ok(titlePasses(repaired), `the check still rejects "${repaired}"`);
        });
    }

    /** What needs a decision comes back as it was, so the check still names it. */
    const LEFT = [
        ['feat: add the thing', 'already fine'],
        ['feat: `Effect` on GJS', 'already quoted'],
        ['wip: add a thing', 'a type outside the enum is a CHANGELOG decision'],
        ['Add a thing', 'no conventional header, and no branch was given'],
        [`feat: ${'long '.repeat(20).trim()}`, "too long for the squash subject — cutting is `repairPr`'s job"],
    ];
    for (const [title, note] of LEFT) {
        it(`leaves "${title.slice(0, 40)}" alone — ${note}`, () => {
            assert.equal(repairTitle(title), title);
        });
    }
});

describe('repair-pr-text: the PR as a whole', () => {
    it('keeps the scope of a title that already fits', () => {
        // A first draft shed the scope unconditionally: a dry run over 150 real PRs rewrote
        // 135 green titles, every one of them losing the package it names.
        const title = 'fix(webcrypto): raw-export non-public key as InvalidAccess';
        assert.equal(repairPr({ title, body: '', number: 2093, branch: '' }).title, title);
    });

    it('drops the scope so the squash subject fits, and touches nothing else', () => {
        // 107 with the scope, 83 without — over and under the 100 the suffix eats into.
        const title =
            'feat(rolldown-plugin-gjsify): apply the underline style to every component that supports it on every target';
        assert.equal(titlePasses(title), false, 'the row must start red, or it tests nothing');
        const { title: out, body, moved } = repairPr({ title, body: 'Summary.', number: 2100, branch: 'ci/demo' });
        assert.ok(titlePasses(out));
        assert.equal(out, 'feat: apply the underline style to every component that supports it on every target');
        assert.equal(body, 'Summary.');
        assert.deepEqual(moved, []);
    });

    it('cuts the subject at a word boundary and keeps the full title in the body', () => {
        const phrase = 'support every target that ships a gjs runtime';
        const title = `feat: ${`${phrase} `.repeat(3)}bundle`;
        assert.equal(titlePasses(title), false, 'the row must start red, or it tests nothing');
        const { title: out, body, moved } = repairPr({ title, body: 'Summary.', number: 2100, branch: 'ci/demo' });
        assert.ok(titlePasses(out));
        assert.deepEqual(moved, []);
        assert.ok(bodyPasses(body));
        assert.match(body, /^Full title: /);
        // The full title is in the body (wrapped), and the cut kept whole words.
        assert.ok(body.replace(/\n/g, ' ').includes(phrase));
        const words = new Set(phrase.split(' '));
        for (const word of out.slice(out.indexOf(': ') + 2).split(' ')) {
            assert.ok(words.has(word), `the cut broke a word: "${word}"`);
        }
    });
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

    it('wraps an over-long heading as bold prose under the limit', () => {
        const heading = `## ${'heading '.repeat(14)}rest`;
        assert.equal(bodyPasses(heading), false);
        const { body, moved } = repairBody(heading);
        assert.deepEqual(moved, []);
        assert.ok(bodyPasses(body));
        assert.match(body, /^\*\*/);
        assert.match(body, /\*\*$/);
        for (const line of body.split('\n')) assert.ok(line.length <= 100);
    });

    it('moves an unwrappable line (a long URL) into the comment and leaves a pointer', () => {
        const url = `https://example.org/${'a'.repeat(120)}`;
        assert.equal(bodyPasses(url), false);
        const { body, moved } = repairBody(url);
        assert.deepEqual(moved, [url]);
        assert.ok(bodyPasses(body));
        assert.equal(body, '_A long line moved to a PR comment: it does not fit the commit body._');
    });

    it('leaves a heading that is one unbreakable word, so the check still names it', () => {
        const heading = `# ${'w'.repeat(130)}`;
        assert.equal(repairBody(heading).body, heading);
    });
});

describe('repair-pr-text: closing keyword lists', () => {
    // `check-closing-keywords.mjs` also reads the PR's commit messages, so it needs a real
    // range — a throwaway repo with two commits, walked from its own directory.
    const repo = mkdtempSync(join(tmpdir(), 'ci-pr-text-closing-'));
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const identity = ['-c', 'user.name=repair test', '-c', 'user.email=repair-test@example.com'];
    let baseSha;
    let headSha;

    before(() => {
        git(['init', '-q']);
        git([...identity, 'commit', '--allow-empty', '-m', 'base']);
        baseSha = git(['rev-parse', 'HEAD']).trim();
        git([...identity, 'commit', '--allow-empty', '-m', 'head']);
        headSha = git(['rev-parse', 'HEAD']).trim();
    });
    after(() => rmSync(repo, { recursive: true, force: true }));

    const closingPasses = (body) =>
        check(
            'check-closing-keywords.mjs',
            { PR_BODY: body, PR_BASE_SHA: baseSha, PR_HEAD_SHA: headSha },
            { cwd: repo },
        ) === 0;

    const CHAINS = [
        [
            'Closes #99001, #99002, #99003, #99004.',
            'Closes #99001, closes #99002, closes #99003, closes #99004.',
            'the #1565 shape',
        ],
        ['Fixes #99001 and #99002', 'Fixes #99001, fixes #99002', '`and`'],
        ['Fixes #99001 & #99002', 'Fixes #99001, fixes #99002', '`&`'],
        [
            'Resolves #99001, #99002, and #99003',
            'Resolves #99001, resolves #99002, resolves #99003',
            'the oxford `and`',
        ],
        ['closes #99001, #99002', 'closes #99001, closes #99002', 'lowercase keeps its keyword case'],
        ['Closes #99001,\n#99002', 'Closes #99001, closes #99002', 'a list wrapped after the comma'],
    ];
    for (const [input, expected, note] of CHAINS) {
        it(`repeats the keyword before every reference — ${note}`, () => {
            assert.equal(closingPasses(input), false, 'the row must start red, or it tests nothing');
            const { body } = repairBody(input);
            assert.equal(body, expected);
            assert.ok(closingPasses(body), `the check still rejects "${body}"`);
        });
    }

    it('leaves a chain inside a fenced block, which the check exempts as code', () => {
        const input = ['```', 'Closes #99001, #99002', '```'].join('\n');
        assert.equal(repairBody(input).body, input);
        assert.ok(closingPasses(input));
    });

    it('leaves a chain inside inline code, which the check blanks', () => {
        const input = 'Write `Closes #99001, #99002` and it stays.';
        assert.equal(repairBody(input).body, input);
        assert.ok(closingPasses(input));
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

    it('gives the repair the head branch through env only, never the run text', () => {
        assert.match(repairJob, /HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
        const step = repairJob.slice(repairJob.indexOf('        run: |'));
        assert.doesNotMatch(step, /HEAD_REF|\$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
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
