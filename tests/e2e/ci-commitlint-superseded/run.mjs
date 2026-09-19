// E2E test for the two halves of `commitlint.yml`'s superseded-state fix —
// `scripts/decide-commitlint-verdict.mjs` (a run whose description moved under it ends green)
// and `scripts/rerun-superseded-commitlint.mjs` (a run that already concluded gets restarted).
//
// THE MECHANISM IS UNDER FIXTURES BECAUSE THE OBVIOUS READING OF IT IS WRONG. The rollup keeps
// the LATEST check run per context, not the worst: acca841ff1 carries `Lint commit messages` =
// FAILURE, FAILURE, SUCCESS, SUCCESS with no other context non-success and rolls up SUCCESS,
// and #1667 MERGED on c0629ff7 over an older failure of that same required context. So the
// defect is not a red that lingers — it is that WHICH run reports last is decided by the runner
// queue. On fc14d85a99 three runs were created 06:02:32 / :38 / :46 and their check runs
// STARTED 06:05:19, 06:06:54, 06:06:56: the run created second started last, so a superseded
// body state owns the context.
//
// #1704 IS THE WORKED CASE, and the part that matters most is what did NOT fix it. Its entries
// are SUCCESS at 06:49 and then FAILURE at 07:13, 07:14 and 07:22 — three hand re-runs, each
// replaying the same superseded payload under the old workflow and failing again. Re-running by
// hand is what put that PR in the state it is in. The re-run half of this fix works only
// BECAUSE the verdict half turns a replayed stale payload green.
//
// CANCELLING IS THE CURE THAT IS NOT ONE, which is why the wiring describe asserts the absence
// of a `concurrency:` block: it leaves a CANCELLED conclusion (b0ee2c0068 carries one as the
// newest entry for that context), it keeps the verdict a function of report order rather than
// of the description, and it cannot reach a run that has already concluded.
//
// THE DIRECTION THAT MUST NOT BE CHEAP TO GET WRONG. This check now has paths on which it
// reports GREEN without judging the current text. A voiding rule that fires too readily is a
// dead required check that nobody notices, which is worse than the red it replaces — so the
// cases below spend more assertions on refusing to void (CRLF, an absent body, an unreadable
// current state, an outcome word nobody has seen, a step that did not run, and an edit with no
// successor run to judge what it changed to) than on voiding.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-commitlint-superseded/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const DECIDE = join(MONOREPO_ROOT, 'scripts', 'decide-commitlint-verdict.mjs');
const RERUN = join(MONOREPO_ROOT, 'scripts', 'rerun-superseded-commitlint.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'commitlint.yml');

const { decideCommitlintVerdict, whatMoved, successorExists, findingsFrom } = await import(`file://${DECIDE}`);
const { supersededCommitlintRuns, rerunSupersededCommitlint } = await import(`file://${RERUN}`);

/** #1704's title, and a body long enough that an edit to it is a real edit. */
const TITLE = 'ci: measure four probes, promote the one that earned it';
const BODY = 'Four probes ran against the same tree.\n\nCloses #1700\n';
const ALL_GREEN = {
    commits: 'success',
    'title-form': 'success',
    'title-subject': 'success',
    'body-lines': 'success',
    'closing-keywords': 'success',
};

const decide = (over = {}) =>
    decideCommitlintVerdict({
        event: 'pull_request',
        examined: { title: TITLE, body: BODY },
        current: { title: TITLE, body: BODY },
        outcomes: ALL_GREEN,
        // A later run on the commit exists unless a case says otherwise — every edit through
        // the web UI or a user token starts one.
        successor: true,
        ...over,
    });

describe('decide-commitlint-verdict: whose text this run judged', () => {
    it('lets a verdict stand when the PR still carries the strings it examined', () => {
        assert.deepEqual(decide(), { state: 'current-pass', failed: [], moved: null });
    });

    it('fails the job on a finding against the CURRENT text', () => {
        const verdict = decide({ outcomes: { ...ALL_GREEN, 'body-lines': 'failure' } });
        assert.equal(verdict.state, 'current-fail');
        assert.deepEqual(verdict.failed, ['body-lines']);
    });

    it('voids a finding about a body that has since been edited', () => {
        // #1704's three reds. Each examined a body the PR no longer carries, and each stayed
        // on the commit as a required-context FAILURE until somebody re-ran it.
        const verdict = decide({
            current: { title: TITLE, body: `${BODY}\nOne more paragraph, pasted after the run started.` },
            outcomes: { ...ALL_GREEN, 'body-lines': 'failure' },
        });
        assert.equal(verdict.state, 'superseded');
        assert.equal(verdict.moved, 'body');
        // The finding is still reported: a voided run that says only "superseded" hides
        // whether what it examined was ALSO broken.
        assert.deepEqual(verdict.failed, ['body-lines']);
    });

    it('voids a finding about a title that has since been edited', () => {
        const verdict = decide({
            current: { title: 'ci: measure four probes and promote one', body: BODY },
            outcomes: { ...ALL_GREEN, 'title-subject': 'failure' },
        });
        assert.equal(verdict.state, 'superseded');
        assert.equal(verdict.moved, 'title');
    });

    it('names both halves when both moved', () => {
        assert.equal(whatMoved({ title: 'a', body: 'b' }, { title: 'c', body: 'd' }), 'title and body');
    });

    it('does NOT void on line endings alone', () => {
        // The dead-check direction. The same body reaches a run through the event payload and
        // through the API, and the two only agree on being the same text — a rule that read
        // CRLF as an edit would void every run on a body written in the web editor, and the
        // required check would report green having judged nothing, forever.
        const verdict = decide({
            examined: { title: TITLE, body: 'first line\r\nsecond line\r\n' },
            current: { title: TITLE, body: 'first line\nsecond line\n' },
            outcomes: { ...ALL_GREEN, 'body-lines': 'failure' },
        });
        assert.equal(verdict.state, 'current-fail');
    });

    it('does NOT void when an absent body is spelled two ways', () => {
        // GitHub sends `null` for an empty description on one field and `''` on the other.
        const verdict = decide({
            examined: { title: TITLE, body: undefined },
            current: { title: TITLE, body: null },
        });
        assert.equal(verdict.state, 'current-pass');
    });

    it('refuses to decide when the current PR could not be read', () => {
        // FAIL CLOSED: without the current text there is no way to tell a stale verdict from a
        // live one, and the wrong guess here is the one that passes a check that read nothing.
        assert.throws(() => decide({ current: null }), /could not be read/);
        assert.throws(() => decide({ current: {} }), /could not be read/);
    });

    it('treats an outcome word it does not know as a finding', () => {
        // Enumerated rather than `!== 'failure'`, so a status GitHub adds later fails loudly
        // instead of being read as a pass by default.
        assert.equal(decide({ outcomes: { ...ALL_GREEN, commits: 'neutral' } }).state, 'current-fail');
        assert.equal(decide({ outcomes: { ...ALL_GREEN, commits: 'cancelled' } }).state, 'current-fail');
    });

    it('treats a check that did NOT run as a gap, not as a pass', () => {
        // The hole this pins: a failed checkout skips every check under it, and every step here
        // carries `continue-on-error`, so the job would reach this decision with four `skipped`
        // outcomes and nothing failed. Green over nothing is the one verdict this file exists to
        // make impossible.
        const verdict = decide({
            outcomes: {
                commits: 'skipped',
                'title-form': 'skipped',
                'title-subject': 'skipped',
                'body-lines': 'skipped',
                'closing-keywords': 'skipped',
            },
        });
        assert.equal(verdict.state, 'current-fail');
        assert.deepEqual(verdict.failed, [
            'body-lines (did not run)',
            'closing-keywords (did not run)',
            'commits (did not run)',
            'title-form (did not run)',
            'title-subject (did not run)',
        ]);
    });

    it('accepts the four PR-only steps as skipped on a push, and not the commit lint', () => {
        const onPush = (outcomes) => findingsFrom({ event: 'push', outcomes });
        assert.deepEqual(
            onPush({
                commits: 'success',
                'title-form': 'skipped',
                'title-subject': 'skipped',
                'body-lines': 'skipped',
                'closing-keywords': 'skipped',
            }),
            [],
        );
        assert.deepEqual(onPush({ commits: 'skipped' }), ['commits (did not run)']);
    });

    it('REFUSES to void when no later run exists to judge what the edit changed to', () => {
        // Reachable only by an edit that starts no run — one authored with `GITHUB_TOKEN`. No
        // workflow here holds `pull-requests: write` today, so this is latent; it is also the
        // one branch where voiding would be SILENT, taking the commit green with the current
        // description judged by nobody.
        const moved = { current: { title: TITLE, body: `${BODY}\nan edit no run witnessed` } };
        assert.equal(decide({ ...moved, successor: false }).state, 'moved-no-successor');
        assert.equal(decide({ ...moved, successor: null }).state, 'moved-no-successor');
        // ...and the findings it did make are kept rather than discarded.
        const verdict = decide({ ...moved, successor: false, outcomes: { ...ALL_GREEN, 'body-lines': 'failure' } });
        assert.deepEqual(verdict.failed, ['body-lines']);
        assert.equal(verdict.moved, 'body');
    });

    it('skips the supersede question entirely on a push, where there is no PR', () => {
        const verdict = decideCommitlintVerdict({
            event: 'push',
            examined: { title: undefined, body: undefined },
            current: null,
            outcomes: { commits: 'failure' },
        });
        assert.equal(verdict.state, 'current-fail');
    });
});

describe('decide-commitlint-verdict: the witness a void needs', () => {
    const SHA = '4db0edf92eca3896925c8bb61b95facefb3685cd';
    const at = (id, created, sha = SHA) => ({ id, head_sha: sha, created_at: created });
    // #1704's four runs, two of which share a clock second.
    const FOUR = [
        at(35426493454, '2026-09-19T06:24:00Z'),
        at(35426493503, '2026-09-19T06:24:00Z'),
        at(35426501626, '2026-09-19T06:24:11Z'),
        at(35426505343, '2026-09-19T06:24:15Z'),
    ];
    const witness = (selfRunId, runs = FOUR) => successorExists({ runs, headSha: SHA, selfRunId });

    it('sees the later runs of a burst', () => {
        assert.equal(witness(35426493454), true);
        assert.equal(witness(35426501626), true);
    });

    it('breaks a same-second tie on the run id, which rises with creation', () => {
        // Without this, the earlier of the pair created at 06:24:00 sees no successor, refuses
        // to void, and the class comes back for exactly the burst the fix is for.
        assert.equal(witness(35426493454, FOUR.slice(0, 2)), true);
        assert.equal(witness(35426493503, FOUR.slice(0, 2)), false);
    });

    it('answers false for the newest run, which is the one that must decide', () => {
        assert.equal(witness(35426505343), false);
    });

    it('does not count a run on another commit', () => {
        const elsewhere = [at(1, '2026-09-19T06:24:00Z'), at(2, '2026-09-19T09:00:00Z', 'ca61cbf8ce')];
        assert.equal(successorExists({ runs: elsewhere, headSha: SHA, selfRunId: 1 }), false);
    });

    it('answers null rather than guessing when it cannot place itself', () => {
        // `null` is not `false`: the caller must refuse to void on either, and the log has to be
        // able to tell "nothing came after me" from "I could not tell".
        assert.equal(witness(99999), null);
        assert.equal(successorExists({ runs: FOUR, headSha: SHA, selfRunId: 'not-a-number' }), null);
        assert.equal(successorExists({ runs: [{ id: 7, head_sha: SHA }], headSha: SHA, selfRunId: 7 }), null);
    });
});

/** One row of the commitlint runs listing, with only the fields the selection reads. */
const HEAD_SHA = '4db0edf92eca3896925c8bb61b95facefb3685cd';
const SELF = 35426505343;
function run({
    id,
    sha = HEAD_SHA,
    status = 'completed',
    conclusion = 'failure',
    attempt = 1,
    created = '2026-09-19T06:24:00Z',
}) {
    return { id, head_sha: sha, status, conclusion, run_attempt: attempt, created_at: created };
}
/** This job's own run — #1704's green one, the last of the four to be created. */
const me = run({ id: SELF, status: 'in_progress', conclusion: null, created: '2026-09-19T06:24:15Z' });

const select = (runs) => supersededCommitlintRuns({ runs, headSha: HEAD_SHA, selfRunId: SELF });

describe('rerun-superseded-commitlint: which concluded runs a live green verdict clears', () => {
    it("clears #1704's three stale reds and not its own run", () => {
        const stale = [
            run({ id: 35426493454, created: '2026-09-19T06:24:00Z' }),
            run({ id: 35426493503, created: '2026-09-19T06:24:00Z' }),
            run({ id: 35426501626, created: '2026-09-19T06:24:11Z' }),
        ];
        assert.deepEqual(select([...stale, me]), [35426493454, 35426493503, 35426501626]);
    });

    it('clears a CANCELLED run, which blocks exactly as a failure does', () => {
        // 934319ead0: cancelled is not a milder red, it is the same red under another word.
        assert.deepEqual(select([run({ id: 1, conclusion: 'cancelled' }), me]), [1]);
    });

    it('leaves a run it has already restarted once alone', () => {
        // The loop breaker. A run retried once and red again is red for a reason that is not
        // staleness, and a repair that retries forever is not a repair.
        assert.deepEqual(select([run({ id: 1, attempt: 2 }), me]), []);
    });

    it('leaves a NEWER red alone', () => {
        // Our verdict is known current only as of our own read. A red created after us may be
        // the live one, and restarting it would discard a finding nobody has seen.
        assert.deepEqual(select([run({ id: 1, created: '2026-09-19T06:24:30Z' }), me]), []);
    });

    it('leaves another commit, a green run and an unfinished run alone', () => {
        const rows = [
            run({ id: 1, sha: 'ca61cbf8ce0000000000000000000000000000000' }),
            run({ id: 2, conclusion: 'success' }),
            run({ id: 3, status: 'queued', conclusion: null }),
            run({ id: 4, conclusion: 'action_required' }),
            run({ id: 5, conclusion: 'startup_failure' }),
            me,
        ];
        assert.deepEqual(select(rows), []);
    });

    it('caps how many runs one green verdict may restart', () => {
        const many = Array.from({ length: 25 }, (_, i) => run({ id: 100 + i }));
        assert.equal(select([...many, me]).length, 10);
    });

    it('selects NOTHING rather than guessing when its own run is missing from the listing', () => {
        // Without our own `created_at` there is no ordering, and "restart everything red on
        // this commit" is a different act from the one this script is allowed to perform.
        assert.equal(supersededCommitlintRuns({ runs: [run({ id: 1 })], headSha: HEAD_SHA, selfRunId: SELF }), null);
    });
});

describe('rerun-superseded-commitlint: counting what restarted, not what was posted', () => {
    /** @param {Record<string, {status: number, attempt?: number|number[]}>} plan */
    const apiFrom = (plan) => {
        const reads = new Map();
        return async (method, path) => {
            const id = path.split('/')[2];
            if (method === 'POST') return { status: plan[id].status, body: undefined };
            // An `attempt` array is what successive reads return, so a test can hold the
            // difference between "not restarted" and "not restarted YET".
            const seq = plan[id].attempt ?? 1;
            const n = reads.get(id) ?? 0;
            reads.set(id, n + 1);
            const attempt = Array.isArray(seq) ? (seq[n] ?? seq.at(-1)) : seq;
            return { status: 200, body: { run_attempt: attempt } };
        };
    };
    /** The settle is real time in CI and nothing here should spend it. */
    const instantly = { settleMs: 0, pollMs: 0, sleep: async () => {} };

    it('counts a run only once it has been read back on a later attempt', async () => {
        const result = await rerunSupersededCommitlint({
            ids: [1, 2],
            api: apiFrom({ 1: { status: 201, attempt: 2 }, 2: { status: 201, attempt: 1 } }),
            log: () => {},
            ...instantly,
        });
        // #1548 is the incident where a job counted its own accepted POSTs as outcomes. Two
        // were accepted here and one of them moved nothing.
        assert.equal(result.posted, 2);
        assert.equal(result.restarted, 1);
        assert.deepEqual(result.stuck, ['2']);
    });

    it("reports a fork PR's refused POSTs without claiming a repair", async () => {
        const result = await rerunSupersededCommitlint({
            ids: [1],
            api: apiFrom({ 1: { status: 403 } }),
            log: () => {},
        });
        assert.deepEqual(
            { posted: result.posted, refused: result.refused, restarted: result.restarted },
            {
                posted: 0,
                refused: 1,
                restarted: 0,
            },
        );
    });

    it('waits out a restart that has not registered yet', async () => {
        // MEASURED on probe #1708: the POST was accepted at 08:52:22.566, the read-back 312 ms
        // later still said attempt 1, and the job annotated `0 of 1 … restarted` — while the run
        // was on attempt 2 moments afterwards. A warning that cries wolf is a warning nobody
        // reads, which is the same failure the count itself was written to avoid.
        const result = await rerunSupersededCommitlint({
            ids: [1],
            api: apiFrom({ 1: { status: 201, attempt: [1, 1, 2] } }),
            log: () => {},
            settleMs: 8,
            pollMs: 4,
            sleep: async () => {},
        });
        assert.equal(result.restarted, 1);
        assert.deepEqual(result.stuck, []);
    });

    it('survives a transport error instead of putting a red X on a green PR', async () => {
        const result = await rerunSupersededCommitlint({
            ids: [1],
            api: async () => {
                throw new Error('getaddrinfo EAI_AGAIN api.github.com');
            },
            log: () => {},
            ...instantly,
        });
        assert.equal(result.restarted, 0);
    });
});

describe('commitlint.yml: the wiring', () => {
    const yaml = readFileSync(WORKFLOW, 'utf8');
    const lintJob = yaml.slice(yaml.indexOf('  commitlint:'), yaml.indexOf('  clear-superseded:'));
    const clearJob = yaml.slice(yaml.indexOf('  clear-superseded:'));
    /** The YAML a runner acts on. A comment naming a permission is not a permission. */
    const directives = (text) =>
        text
            .split('\n')
            .filter((line) => !/^\s*#/.test(line))
            .join('\n');

    it('adds no concurrency group, because cancelling does not make the verdict right', () => {
        // A group reads like the fix and is not one: it leaves a CANCELLED conclusion
        // (b0ee2c0068 carries one as the newest entry for this required context), it keeps the
        // verdict a function of which run reports LAST rather than of the description, and it
        // cannot reach a run that has already concluded — which is the state #1704 is in. If
        // this assertion is ever in the way, re-measure before deleting it.
        assert.doesNotMatch(yaml, /^\s*concurrency:/m);
    });

    it('gives the verdict step the run listing its void depends on', () => {
        // A void without a witness is an assumption, and the wiring is the half a unit test
        // cannot see: the script reads `COMMITLINT_RUNS`, so a workflow that stops writing it
        // would make every run fail closed — loudly, but only because this is here to say why.
        assert.match(lintJob, /actions: read/);
        assert.match(lintJob, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
        assert.match(lintJob, /actions\/workflows\/commitlint\.yml\/runs/);
        assert.match(lintJob, /export COMMITLINT_RUNS=/);
        const decide = readFileSync(DECIDE, 'utf8');
        assert.match(decide, /required\(process\.env\.COMMITLINT_RUNS/);
    });

    it('lets every check step report rather than abort the job', () => {
        // THE LOAD-BEARING WIRING. A check step without `continue-on-error` ends the job where
        // it fails, the verdict step never runs, and the whole fix is gone — silently, on a
        // workflow whose remaining steps still look right.
        const ids = [...lintJob.matchAll(/^\s+id: ([\w-]+)$/gm)].map((m) => m[1]).filter((id) => id !== 'verdict');
        assert.deepEqual(ids, ['commits', 'title-form', 'title-subject', 'body-lines', 'closing-keywords']);
        assert.equal(lintJob.match(/continue-on-error: true/g)?.length, ids.length);
        for (const id of ids) assert.match(lintJob, new RegExp(`"${id}": "\\$\\{\\{ steps\\.${id}\\.outcome \\}\\}"`));
    });

    it('decides the job in a step that always runs, and runs it last', () => {
        assert.match(
            lintJob,
            /- name: Decide whether this run's verdict still describes the PR\n\s+id: verdict\n\s+if: always\(\)/,
        );
        const verdict = lintJob.indexOf('id: verdict');
        assert.equal(lintJob.slice(verdict).indexOf('\n      - name:'), -1, 'no check may run after the verdict');
        assert.match(lintJob, /\n\s+node scripts\/decide-commitlint-verdict\.mjs/);
    });

    it('reads the CURRENT title and body through env, never into the run: text', () => {
        // PR-controlled strings become program text in neither script nor shell — the rule
        // `cancel-pr-runs.yml` follows for the head branch name.
        assert.match(lintJob, /COMMITLINT_EXAMINED_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
        assert.match(lintJob, /COMMITLINT_EXAMINED_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
        assert.match(lintJob, /gh api "repos\/\$\{REPO\}\/pulls\/\$\{PR_NUMBER\}"/);
    });

    it('keeps the write token out of the job that has head code', () => {
        assert.match(lintJob, /permissions:\n\s+contents: read\n\s+pull-requests: read/);
        assert.doesNotMatch(directives(lintJob), /actions: write/);
        assert.match(clearJob, /permissions:\n\s+actions: write/);
        // The repair job materialises the selection ONLY, and from the base — no head code
        // shares a runner with that token.
        assert.match(clearJob, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
        assert.match(clearJob, /sparse-checkout: \|\n\s+scripts\/rerun-superseded-commitlint\.mjs/);
    });

    it('clears only on a verdict known to describe the PR as it is now', () => {
        assert.match(clearJob, /needs\.commitlint\.outputs\.state == 'current-pass'/);
        assert.match(lintJob, /outputs:\n\s+state: \$\{\{ steps\.verdict\.outputs\.state \}\}/);
    });

    it('no-ops instead of failing when the PR base predates the rerun script', () => {
        // #1340's shape exactly: the script comes from `base.sha`, the YAML from the merge
        // ref, so the first event on any branch cut before this landed runs the new invocation
        // against a `scripts/` that does not hold it.
        const guard = clearJob.indexOf('[ ! -f scripts/rerun-superseded-commitlint.mjs ]');
        assert.notEqual(guard, -1, 'the invocation must be guarded on the script existing in the base checkout');
        assert.ok(guard < clearJob.indexOf('node scripts/rerun-superseded-commitlint.mjs'));
        assert.match(clearJob.slice(guard, guard + 400), /exit 0/);
    });
});
