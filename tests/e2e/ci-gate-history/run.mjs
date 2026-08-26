// E2E test for `scripts/report-gate-history.mjs` — the reporter that answers "when did
// this gate last actually measure something?".
//
// WHY THE FIXTURES ARE THE POINT. The thing being guarded against is a report that is
// EMPTY, and an empty report is what a broken detector and a healthy repository both
// produce. So the suite is built as an A/B: the first case is the incident itself —
// `node-gi.yml`'s Windows leg `skipped` at this commit and for the two `main` runs before
// it, last executed three runs back — and it must name that SHA. The second is the same
// workflow with the same leg green here, and it must report nothing. A detector that
// always found something fails the second; one that never did fails the first.
//
// The API is injected, so every case is a data shape rather than a network call. That is
// also the only way to test the walk-back at all: the real answers live in GitHub's run
// history, which a test cannot arrange.
//
// The last describe block is the other half of the same question, one level up: a
// reporter nothing invokes reports nothing. `run-integration` was emitted for months and
// read by a `printf` (see `tests/e2e/ci-classifier-output-coverage`), so the wiring in
// `main.yml` is asserted here too — the step, the `actions: read` permission the query
// needs, and the checkout without which the script is not on disk.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-gate-history/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'report-gate-history.mjs');

const { annotationsFor, executed, gateHistoryReport, legMatcher, renderMarkdown } = await import(`file://${SCRIPT}`);

const REPO = 'gjsify/gjsify';
const WF = '.github/workflows/node-gi.yml';
const LEG = 'Windows build + conformance (Node / windows-latest x64)';
const LINUX_LEG = 'Build & test (Node / Fedora 44)';

/**
 * A fake GitHub Actions API over a run table.
 *
 * `runs` is newest-first, exactly as the runs endpoint returns them, and each entry
 * carries the job conclusions that run recorded. `calls` records every path asked for, so
 * a case can assert what was NOT fetched.
 */
function fakeApi({ runs, workflows = [{ path: WF, name: 'node-gi', state: 'active' }], headSha }) {
    const calls = [];
    const api = async (path) => {
        calls.push(path);
        if (path.startsWith(`repos/${REPO}/actions/workflows?`)) return { workflows };
        const atCommit = /^repos\/.+\/actions\/runs\?head_sha=([^&]+)/.exec(path);
        if (atCommit) {
            return { workflow_runs: runs.filter((r) => r.head_sha === atCommit[1]).map(toRunRecord) };
        }
        const history = /^repos\/.+\/actions\/workflows\/([^/]+)\/runs\?/.exec(path);
        if (history) {
            const perPage = Number(/per_page=(\d+)/.exec(path)?.[1] ?? 30);
            return {
                workflow_runs: runs
                    .filter((r) => r.path.endsWith(`/${history[1]}`))
                    .slice(0, perPage)
                    .map(toRunRecord),
            };
        }
        const jobs = /^repos\/.+\/actions\/runs\/(\d+)\/jobs/.exec(path);
        if (jobs) {
            const run = runs.find((r) => r.id === Number(jobs[1]));
            return {
                jobs: Object.entries(run?.jobs ?? {}).map(([name, conclusion]) => ({
                    name,
                    conclusion,
                    html_url: `https://example.invalid/job/${run.id}/${encodeURIComponent(name)}`,
                })),
            };
        }
        throw new Error(`the fixture API was asked for an unexpected path: ${path}`);
    };
    return { api, calls, headSha };
}

const toRunRecord = (r) => ({
    id: r.id,
    path: r.path,
    name: r.name ?? 'node-gi',
    head_sha: r.head_sha,
    conclusion: r.conclusion ?? 'success',
    updated_at: r.updated_at ?? '2026-08-20T10:00:00Z',
    html_url: `https://example.invalid/run/${r.id}`,
});

/** `n` history runs on main, oldest last, with the Windows leg skipped in each. */
const skippedHistory = (count, firstId) =>
    Array.from({ length: count }, (_, i) => ({
        id: firstId - i,
        path: WF,
        head_sha: `history${firstId - i}0000000000000000000000000000000`,
        jobs: { [LINUX_LEG]: 'success', [LEG]: 'skipped' },
    }));

const run = (fixture, overrides = {}) =>
    gateHistoryReport({ api: fixture.api, repo: REPO, shas: [fixture.headSha], maxRunsBack: 5, ...overrides });

describe('the incident: a skipped leg that last executed some commits ago', () => {
    // Reconstructed from the measurement in status/open-todos.md — the leg was skipped on
    // every recent main push and the last run that EXECUTED it was two PRs earlier, so
    // reading main as the baseline blamed the change on top.
    const fixture = fakeApi({
        headSha: 'aaaa111',
        runs: [
            { id: 500, path: WF, head_sha: 'aaaa111', jobs: { [LINUX_LEG]: 'success', [LEG]: 'skipped' } },
            ...skippedHistory(2, 499),
            {
                id: 497,
                path: WF,
                head_sha: 'deadbeef00000000000000000000000000000000',
                updated_at: '2026-08-13T09:30:00Z',
                jobs: { [LINUX_LEG]: 'success', [LEG]: 'success' },
            },
        ],
    });

    it('names the leg, the SHA it last executed at, and how far back that is', async () => {
        const report = await run(fixture);
        assert.equal(report.staleLegs.length, 1, 'exactly the one skipped leg is a row');
        const [leg] = report.staleLegs;
        assert.equal(leg.leg, LEG);
        assert.equal(leg.sha, 'deadbeef00000000000000000000000000000000');
        assert.equal(leg.conclusion, 'success');
        assert.equal(leg.runsBack, 3);
    });

    it('puts the SHA in the rendered table, which is what the ledger asked for', async () => {
        const md = renderMarkdown(await run(fixture));
        assert.match(md, /Legs that were `skipped` here/);
        assert.match(md, /`deadbee`/, 'the short SHA is the whole point of the row');
        assert.match(md, /3 run\(s\) back/);
        assert.match(md, /2026-08-13/);
    });

    it('does NOT annotate it — the last thing it said was `success`', async () => {
        // The policy `ci-summary` already had. Fourteen warnings per main push from this
        // one workflow is how a warning stops being read.
        const lines = annotationsFor(await run(fixture), { annotate: true });
        assert.deepEqual(lines, []);
    });

    it('leaves the leg that DID run out of the table', async () => {
        const report = await run(fixture);
        assert.ok(!report.staleLegs.some((l) => l.leg === LINUX_LEG), 'a leg that executed here is not a finding');
    });
});

describe('the same shape with the leg green here reports nothing', () => {
    // The B side. Without it, a detector that returned every job would pass every
    // assertion above.
    const fixture = fakeApi({
        headSha: 'bbbb222',
        runs: [
            { id: 600, path: WF, head_sha: 'bbbb222', jobs: { [LINUX_LEG]: 'success', [LEG]: 'success' } },
            ...skippedHistory(3, 599),
        ],
    });

    it('finds no stale leg', async () => {
        const report = await run(fixture);
        assert.deepEqual(report.staleLegs, []);
    });

    it('says so, rather than printing an empty table', async () => {
        const md = renderMarkdown(await run(fixture));
        assert.match(md, /No job resolved to `skipped`/);
    });

    it('never walks the history it does not need', async () => {
        await run(fixture);
        assert.ok(
            !fixture.calls.some((p) => /workflows\/node-gi\.yml\/runs\?/.test(p)),
            'a run with no skipped job must cost no history query',
        );
    });
});

describe('a leg that has not executed inside the window at all', () => {
    const fixture = fakeApi({
        headSha: 'cccc333',
        runs: [
            { id: 700, path: WF, head_sha: 'cccc333', jobs: { [LINUX_LEG]: 'success', [LEG]: 'skipped' } },
            ...skippedHistory(6, 699),
        ],
    });

    it('says how far it looked instead of implying the leg is fine', async () => {
        const report = await run(fixture);
        assert.equal(report.staleLegs.length, 1);
        assert.equal(report.staleLegs[0].sha, null);
        assert.match(renderMarkdown(report), /not in the last \d+ completed run\(s\)/);
    });

    it('is NOT annotated — quiet is not the same as red', async () => {
        // Deliberate, and the reason is `main.yml`'s own `changes` job: it is skipped on
        // `main` by design, so it is absent from every `main` window there will ever be.
        // Annotating "absent" would put a permanent warning on every push, and telling a
        // by-design silence from a real one needs the maintained list this job avoids.
        assert.deepEqual(annotationsFor(await run(fixture), { annotate: true }), []);
    });

    it('emits no annotation when annotation is off', async () => {
        assert.deepEqual(annotationsFor(await run(fixture), { annotate: false }), []);
    });
});

describe('a leg whose last execution was RED', () => {
    const fixture = fakeApi({
        headSha: 'dddd444',
        runs: [
            { id: 800, path: WF, head_sha: 'dddd444', jobs: { [LINUX_LEG]: 'success', [LEG]: 'skipped' } },
            { id: 799, path: WF, head_sha: 'f00f00f00f00f00f00f00f00f00f00f00f00f00f', jobs: { [LEG]: 'failure' } },
        ],
    });

    it('is annotated, because a red baseline is the reader’s problem', async () => {
        const report = await run(fixture);
        assert.equal(report.staleLegs[0].conclusion, 'failure');
        const lines = annotationsFor(report, { annotate: true });
        assert.equal(lines.length, 1);
        assert.match(lines[0], /last failure at f00f00f/);
    });
});

describe('`cancelled` and a pending conclusion did not measure anything', () => {
    // The discrimination this rests on. Reading `cancelled` as an execution would answer
    // "it ran at abc123" about a run that was killed before the step started.
    it('classifies conclusions', () => {
        assert.equal(executed('success'), true);
        assert.equal(executed('failure'), true);
        assert.equal(executed('timed_out'), true);
        assert.equal(executed('skipped'), false);
        assert.equal(executed('cancelled'), false);
        assert.equal(executed(null), false);
        assert.equal(executed(undefined), false);
    });

    it('walks past a cancelled run to the last real one', async () => {
        const fixture = fakeApi({
            headSha: 'eeee555',
            runs: [
                { id: 900, path: WF, head_sha: 'eeee555', jobs: { [LEG]: 'skipped' } },
                {
                    id: 899,
                    path: WF,
                    head_sha: 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
                    jobs: { [LEG]: 'cancelled' },
                },
                {
                    id: 898,
                    path: WF,
                    head_sha: 'ababababababababababababababababababababa',
                    jobs: { [LEG]: 'success' },
                },
            ],
        });
        const report = await run(fixture);
        assert.equal(report.staleLegs[0].sha, 'ababababababababababababababababababababa');
        assert.equal(report.staleLegs[0].runsBack, 2);
    });
});

describe('a skipped MATRIX leg is not named the way it runs', () => {
    // Measured 2026-08-26 on the real `node-gi.yml` history: GitHub reports a skipped
    // matrix job with the template UNEXPANDED, because a job it never planned has no
    // matrix value to substitute. Exact matching therefore said "not in the last 8 runs"
    // about five node-gi legs that had executed ONE run earlier — a false alarm, and this
    // repository's own rule is that a check with false positives gets disabled and then
    // protects nothing.
    const TEMPLATE = 'macOS GTK runtime bundle (build + relocate / darwin-${{ matrix.arch }})';
    const OTHER = 'macOS windowing GTK runtime bundle (build + relocate / darwin-arm64)';

    it('matches the expanded names and refuses a different leg', () => {
        const matcher = legMatcher(TEMPLATE);
        assert.equal(matcher.templated, true);
        assert.equal(matcher.test('macOS GTK runtime bundle (build + relocate / darwin-arm64)'), true);
        assert.equal(matcher.test('macOS GTK runtime bundle (build + relocate / darwin-x64)'), true);
        assert.equal(matcher.test(OTHER), false, 'the first literal fragment is anchored at index 0');
        assert.equal(legMatcher(LEG).templated, false, 'an untemplated name still matches exactly');
    });

    it('resolves the family and says how many legs it stands for', async () => {
        const fixture = fakeApi({
            headSha: 'eeee111',
            runs: [
                { id: 1400, path: WF, head_sha: 'eeee111', jobs: { [TEMPLATE]: 'skipped' } },
                {
                    id: 1399,
                    path: WF,
                    head_sha: '2222222222222222222222222222222222222222',
                    jobs: {
                        'macOS GTK runtime bundle (build + relocate / darwin-arm64)': 'success',
                        'macOS GTK runtime bundle (build + relocate / darwin-x64)': 'success',
                        [OTHER]: 'success',
                    },
                },
            ],
        });
        const report = await run(fixture);
        assert.equal(report.staleLegs.length, 1);
        assert.equal(report.staleLegs[0].sha, '2222222222222222222222222222222222222222');
        assert.equal(report.staleLegs[0].members, 2, 'the unrelated leg must not join the family');
        assert.match(renderMarkdown(report), /2 matrix leg\(s\)/);
    });

    it('does not let a green sibling hide a red one', async () => {
        const fixture = fakeApi({
            headSha: 'eeee222',
            runs: [
                { id: 1500, path: WF, head_sha: 'eeee222', jobs: { [TEMPLATE]: 'skipped' } },
                {
                    id: 1499,
                    path: WF,
                    head_sha: '3333333333333333333333333333333333333333',
                    jobs: {
                        'macOS GTK runtime bundle (build + relocate / darwin-arm64)': 'success',
                        'macOS GTK runtime bundle (build + relocate / darwin-x64)': 'failure',
                    },
                },
            ],
        });
        const report = await run(fixture);
        assert.equal(report.staleLegs[0].conclusion, 'failure');
        assert.equal(annotationsFor(report, { annotate: true }).length, 1, 'a red family is annotated');
    });
});

describe('the workflow-level half it inherited from `ci-summary`’s inline bash', () => {
    it('names an active workflow with no run at this commit, and what it last said', async () => {
        const fixture = fakeApi({
            headSha: 'ffff666',
            workflows: [
                { path: WF, name: 'node-gi', state: 'active' },
                { path: '.github/workflows/release.yml', name: 'Release', state: 'active' },
                { path: '.github/workflows/retired.yml', name: 'Retired', state: 'disabled_manually' },
            ],
            runs: [
                { id: 1000, path: WF, head_sha: 'ffff666', jobs: { [LINUX_LEG]: 'success' } },
                {
                    id: 999,
                    path: '.github/workflows/release.yml',
                    name: 'Release',
                    head_sha: '1111111111111111111111111111111111111111',
                    conclusion: 'failure',
                    jobs: {},
                },
            ],
        });
        const report = await run(fixture);
        assert.equal(report.missingWorkflows.length, 1, 'a disabled workflow is not a finding');
        assert.equal(report.missingWorkflows[0].name, 'Release');
        assert.equal(report.missingWorkflows[0].conclusion, 'failure');
        assert.equal(annotationsFor(report, { annotate: true }).length, 1);
    });

    it('distinguishes "never completed" from "completed and was red"', async () => {
        const fixture = fakeApi({
            headSha: 'aaaa777',
            workflows: [
                { path: WF, name: 'node-gi', state: 'active' },
                { path: '.github/workflows/brand-new.yml', name: 'Brand new', state: 'active' },
            ],
            runs: [{ id: 1100, path: WF, head_sha: 'aaaa777', jobs: { [LINUX_LEG]: 'success' } }],
        });
        const report = await run(fixture);
        assert.equal(report.missingWorkflows[0].conclusion, null);
        assert.match(renderMarkdown(report), /never completed on `main`/);
    });
});

describe('a reporter that read nothing must not look like a clean bill of health', () => {
    it('prints how much it actually read', async () => {
        const fixture = fakeApi({
            headSha: 'bbbb888',
            runs: [{ id: 1200, path: WF, head_sha: 'bbbb888', jobs: { [LINUX_LEG]: 'success' } }],
        });
        const md = renderMarkdown(await run(fixture));
        assert.match(md, /Read \d+ run record\(s\) and \d+ job record\(s\) in \d+ API call\(s\)/);
    });

    it('says the answer is a lower bound when the API budget runs out', async () => {
        const fixture = fakeApi({
            headSha: 'cccc999',
            runs: [{ id: 1300, path: WF, head_sha: 'cccc999', jobs: { [LEG]: 'skipped' } }, ...skippedHistory(5, 1299)],
        });
        const report = await run(fixture, { budget: 4 });
        assert.equal(report.stats.budgetExhausted, true);
        assert.match(renderMarkdown(report), /LOWER BOUND/);
    });

    it('surfaces an unreachable API as an error rather than as an empty report', async () => {
        await assert.rejects(
            () =>
                gateHistoryReport({
                    api: async () => {
                        throw new Error('HTTP 403: Resource not accessible by integration');
                    },
                    repo: REPO,
                    shas: ['dddd000'],
                }),
            /403/,
        );
    });
});

describe('the reporter is wired into a job that runs, with what it needs', () => {
    const mainYml = readFileSync(join(MONOREPO_ROOT, '.github', 'workflows', 'main.yml'), 'utf8');
    const ciSummary = mainYml.slice(mainYml.indexOf('\n  ci-summary:'), mainYml.indexOf('\n  gate:'));

    it('is invoked from `ci-summary`', () => {
        assert.match(ciSummary, /node scripts\/report-gate-history\.mjs/);
    });

    it('has the `actions: read` its own query needs', () => {
        assert.match(ciSummary, /actions:\s*read/);
    });

    it('checks the repository out, or the script is not on disk to run', () => {
        assert.match(ciSummary, /uses: actions\/checkout@/);
    });

    it('runs on `always()`, so a red build does not hide the coverage report', () => {
        assert.match(ciSummary, /if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    });
});
