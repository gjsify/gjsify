// E2E test for `scripts/decide-push-scope.mjs` — may a push to `main` skip the heavy legs
// because the merge queue already tested this tree?
//
// THE ASYMMETRY IS THE POINT, and it points the other way from `ci-suite-scope`'s. There,
// a wrong `skip` leaves a leg red for eight merges. Here the verdict is made AFTER the
// merge, on content the queue measured minutes earlier — so the expensive failure is a
// `proven` claimed on a tree no run actually observed. Every case below therefore pairs a
// shape that must prove with the near-miss that must not: the same tree under a failed
// run, under a `pull_request` run, under another workflow's run.
//
// WHY THE FIXTURES ARE SHAPES RATHER THAN CALLS. The answers live in GitHub's own run
// history, which a test cannot arrange, so the API is injected. The two shapes that are
// not hypothetical are replayed as data and labelled: the RETRY (tree `a8b9eb87` was the
// head of a successful run under both `pr-1907-…` and `pr-1909-…`, 2026-09-30) and the
// BATCH that HEADGREEN grouping produces, where one group head answers for the last squash
// commit of several PRs. Both are why the claim is made on the TREE and not on the SHA; a
// decision that compared SHAs would pass the first block below and fail these two.
//
// The last describe is the WIRING half: a verdict nothing reads decides nothing, and the
// inverse — a leg that must stay full being gated on it — is the one that quietly removes
// coverage. Both are asserted against the real `main.yml`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-push-scope/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'decide-push-scope.mjs');
const MAIN_YML = join(MONOREPO_ROOT, '.github', 'workflows', 'main.yml');

const { pushScopeDecision } = await import(pathToFileURL(SCRIPT).href);

const REPO = 'gjsify/gjsify';
const MAIN_PATH = '.github/workflows/main.yml';

/** The measured retry pair: one tree, two queue commits, both green. */
const RETRY_TREE = 'a8b9eb871df3b5ace2b365cb2c1841d8bbaa582a';
const RETRY_HEAD_A = 'b2ff91cb34c98ffe9eb4ca60868daccf55a892dc';
const RETRY_HEAD_B = '7f43bbdcabade3391d7714bbe23218e1ea9aa995';
/** The commit that landed on `main` carrying that tree. */
const LANDED_SHA = 'b2ff91cb34c98ffe9eb4ca60868daccf55a892dc';

/** One `GET /actions/runs` row, with only the fields the decision reads. */
function run({
    id,
    headSha,
    branch = `gh-readonly-queue/main/pr-1907-${headSha}`,
    event = 'merge_group',
    conclusion = 'success',
    path = MAIN_PATH,
}) {
    return { id, head_sha: headSha, head_branch: branch, event, conclusion, path };
}

/**
 * A fake Actions API over a run table and a commit → tree map.
 *
 * `calls` records every path asked for, so a case can assert what was NOT fetched — the
 * cheap SHA probe is supposed to end the walk before any commit lookup happens.
 */
function fakeApi({ runs, trees, missing = [] }) {
    const calls = [];
    const api = async (path) => {
        calls.push(path);
        const atCommit = /^repos\/.+\/actions\/runs\?head_sha=([^&]+)/.exec(path);
        if (atCommit) return { workflow_runs: runs.filter((r) => r.head_sha === atCommit[1]) };
        const history = /^repos\/.+\/actions\/workflows\/([^/]+)\/runs\?(.*)$/.exec(path);
        if (history) {
            const query = history[2];
            const perPage = Number(/per_page=(\d+)/.exec(query)?.[1] ?? 30);
            return {
                workflow_runs: runs
                    .filter((r) => r.path.endsWith(`/${history[1]}`))
                    .filter((r) => !/event=merge_group/.test(query) || r.event === 'merge_group')
                    .filter((r) => !/status=success/.test(query) || r.conclusion === 'success')
                    .slice(0, perPage),
            };
        }
        const commit = /^repos\/.+\/commits\/(.+)$/.exec(path);
        if (commit) {
            if (missing.includes(commit[1])) throw new Error('HTTP 404: No commit found for SHA');
            return { commit: { tree: { sha: trees[commit[1]] ?? 'unknown-tree' } } };
        }
        throw new Error(`the fixture API was asked for an unexpected path: ${path}`);
    };
    return { api, calls };
}

const decide = (fixture, overrides = {}) =>
    pushScopeDecision({
        api: fixture.api,
        repo: REPO,
        sha: LANDED_SHA,
        tree: RETRY_TREE,
        ...overrides,
    });

describe('decide-push-scope: what a proof must demonstrate', () => {
    it('the landed commit IS a green merge_group head — the common case', async () => {
        const fixture = fakeApi({
            runs: [run({ id: 100, headSha: LANDED_SHA })],
            trees: { [LANDED_SHA]: RETRY_TREE },
        });
        const verdict = await decide(fixture);
        assert.equal(verdict.proven, true, verdict.reason);
        assert.match(verdict.reason, /this very commit/);
        assert.equal(
            fixture.calls.filter((c) => c.includes('/commits/')).length,
            0,
            'the cheap SHA probe must end the walk before any commit lookup',
        );
    });

    it('a RETRY put the same tree under a second queue commit — measured 2026-09-30', async () => {
        const fixture = fakeApi({
            // The landed SHA produced no run of its own; the green run sits on the retry head.
            runs: [run({ id: 200, headSha: RETRY_HEAD_B, branch: 'gh-readonly-queue/main/pr-1909-8218800113' })],
            trees: { [RETRY_HEAD_B]: RETRY_TREE },
        });
        const verdict = await decide(fixture, { sha: 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0' });
        assert.equal(verdict.proven, true, verdict.reason);
        assert.match(verdict.reason, /the same content, tested in the queue/);
    });

    it('a HEADGREEN batch: the group head answers for the LAST squash commit of the batch', async () => {
        // One group validated two PRs; `main` then carries two squash commits, and only the
        // second one's tree equals the group head's. A SHA comparison proves neither.
        const GROUP_HEAD = '9617b4a5d694ee6af8a381b692163e9b0fa15083';
        const fixture = fakeApi({
            runs: [run({ id: 300, headSha: GROUP_HEAD, branch: 'gh-readonly-queue/main/pr-1908-b2ff91cb34' })],
            trees: { [GROUP_HEAD]: 'cc7549af35845d5a70b15ab6918fe0e0a296b06a' },
        });
        const last = await decide(fixture, {
            sha: '7bad1ae04c5b167ea25894422143b4e9e08a9a8b',
            tree: 'cc7549af35845d5a70b15ab6918fe0e0a296b06a',
        });
        assert.equal(last.proven, true, last.reason);

        const middle = await decide(fixture, { sha: 'aaaaaaaaaa', tree: 'a-tree-no-group-head-carries' });
        assert.equal(middle.proven, false, 'a tree no group head carries is not proven');
    });
});

describe('decide-push-scope: the near-misses that must NOT prove', () => {
    const cases = [
        ['a FAILED run on this very commit', { conclusion: 'failure' }],
        ['a run that was cancelled', { conclusion: 'cancelled' }],
        ['a `pull_request` run, which tested the PR head and not the merged tree', { event: 'pull_request' }],
        ['a `push` run — that is the duplicate being removed, not a proof', { event: 'push' }],
        ['another workflow entirely', { path: '.github/workflows/node-gi.yml' }],
    ];
    for (const [name, overrides] of cases) {
        it(`refuses ${name}`, async () => {
            const fixture = fakeApi({
                runs: [run({ id: 400, headSha: LANDED_SHA, ...overrides })],
                trees: { [LANDED_SHA]: RETRY_TREE },
            });
            const verdict = await decide(fixture);
            assert.equal(verdict.proven, false, verdict.reason);
            assert.match(verdict.reason, /running everything/);
        });
    }

    it('refuses a green queue run whose tree is a DIFFERENT one', async () => {
        const fixture = fakeApi({
            runs: [run({ id: 500, headSha: RETRY_HEAD_A })],
            trees: { [RETRY_HEAD_A]: 'some-other-tree' },
        });
        const verdict = await decide(fixture, { sha: 'bbbbbbbbbb' });
        assert.equal(verdict.proven, false, verdict.reason);
        assert.match(verdict.reason, /no successful .*merge_group.* run/);
    });

    it('refuses when there is no queue history at all', async () => {
        const verdict = await decide(fakeApi({ runs: [], trees: {} }));
        assert.equal(verdict.proven, false, verdict.reason);
    });
});

describe('decide-push-scope: every unknown fails OPEN', () => {
    it('a 404 on one candidate does not end the walk — the next one still proves', async () => {
        // A queue ref is deleted after the merge. One unreadable candidate must cost that
        // candidate, not the verdict.
        const fixture = fakeApi({
            runs: [run({ id: 600, headSha: RETRY_HEAD_A }), run({ id: 601, headSha: RETRY_HEAD_B })],
            trees: { [RETRY_HEAD_B]: RETRY_TREE },
            missing: [RETRY_HEAD_A],
        });
        const verdict = await decide(fixture, { sha: 'cccccccccc' });
        assert.equal(verdict.proven, true, verdict.reason);
    });

    it('an exhausted budget says LOWER BOUND rather than "no such run"', async () => {
        const runs = Array.from({ length: 10 }, (_, i) => run({ id: 700 + i, headSha: `head${i}`.padEnd(40, '0') }));
        const fixture = fakeApi({ runs, trees: {} });
        const verdict = await decide(fixture, { sha: 'dddddddddd', budget: 4 });
        assert.equal(verdict.proven, false, verdict.reason);
        assert.match(verdict.reason, /LOWER bound/);
        assert.equal(verdict.stats.budgetExhausted, true);
    });

    it('an API that throws on the first call propagates, so the caller can fail open', async () => {
        await assert.rejects(
            () =>
                pushScopeDecision({
                    api: async () => {
                        throw new Error('bad credentials');
                    },
                    repo: REPO,
                    sha: LANDED_SHA,
                    tree: RETRY_TREE,
                }),
            /bad credentials/,
        );
    });
});

describe('the wiring in main.yml', () => {
    const TEXT = readFileSync(MAIN_YML, 'utf8');
    const LINES = TEXT.split('\n');

    /** A job's body: every line indented deeper than its `  <name>:` key. */
    function jobBody(name) {
        const at = LINES.findIndex((l) => l === `  ${name}:`);
        assert.ok(at >= 0, `main.yml has no \`${name}\` job`);
        const body = [];
        for (const line of LINES.slice(at + 1)) {
            if (/^ {0,2}\S/.test(line)) break;
            body.push(line);
        }
        return body;
    }

    const lineOf = (name, re) => jobBody(name).find((l) => re.test(l));

    it('the lookup job runs only on a push to main, and needs only `actions: read`', () => {
        const body = jobBody('queue-proof');
        const gate = body.find((l) => /^ {4}if: /.test(l));
        assert.match(gate, /github\.event_name == 'push'/);
        assert.match(gate, /github\.ref == 'refs\/heads\/main'/);
        assert.ok(
            body.some((l) => /^ {6}actions: read$/.test(l)),
            'the run-record query needs `actions: read` on GITHUB_TOKEN',
        );
        assert.ok(
            body.some((l) => /uses: actions\/checkout/.test(l)),
            'a job that runs a repo script must check the repo out',
        );
        assert.ok(
            body.some((l) => /node scripts\/decide-push-scope\.mjs/.test(l)),
            'the job must invoke the decision this suite tests',
        );
        assert.ok(
            body.some((l) => /continue-on-error: true/.test(l)),
            'a lookup that crashes must not red a commit that already landed',
        );
    });

    // Every leg the queue genuinely re-measures. Each must WAIT for the verdict and skip
    // only on an explicit `true` — an unset output (PR, merge_group, nightly, dispatch, or
    // a crashed lookup) is the full run this workflow has always done.
    const GATED = [
        'verify-bundles',
        'examples-build',
        'check',
        'test',
        'cross-runtime',
        'e2e',
        'cold-bootstrap',
        'integration',
        'examples',
        'browser',
        'ship-stage',
    ];
    for (const job of GATED) {
        it(`${job} waits for the verdict and skips only on an explicit true`, () => {
            const needs = lineOf(job, /^ {4}needs: \[/);
            assert.match(needs, /\bqueue-proof\b/, `${job} must \`needs: queue-proof\``);
            const gate = lineOf(job, /^ {4}if: /);
            assert.match(
                gate,
                /needs\.queue-proof\.outputs\.proven != 'true'/,
                `${job} must skip only on an explicit \`true\``,
            );
            assert.match(gate, /^ {4}if: \$\{\{ !cancelled\(\)/, 'an always() job survives a run cancel');
        });
    }

    // The other half, and the one that silently removes coverage if it rots. Each of these
    // is full on every push for a reason the job's own header states.
    const MUST_STAY_FULL = {
        build: 'the ONLY writer of the build-output cache, and PR branches see only main-ref caches',
        'tree-checks': 'gated by nothing, deliberately — the #1183 class',
        macos: 'a merge_group run turns the macOS leg OFF, so the queue proved nothing about it',
    };
    for (const [job, why] of Object.entries(MUST_STAY_FULL)) {
        it(`${job} is NOT gated on the verdict — ${why}`, () => {
            const gate = lineOf(job, /^ {4}if: /);
            assert.doesNotMatch(gate ?? '', /queue-proof/, `${job} must run on every push: ${why}`);
        });
    }

    it('the verdict and its reason are reported where a skipped leg is read', () => {
        const summary = jobBody('ci-summary').join('\n');
        assert.match(summary, /needs\.queue-proof\.outputs\.proven/);
        assert.match(summary, /needs\.queue-proof\.outputs\.reason/);
    });

    it('the gate scores the lookup job, so a broken lookup cannot pass unnoticed', () => {
        const gate = jobBody('gate').join('\n');
        assert.match(gate, /queue-proof=\$\{\{ needs\.queue-proof\.result \}\}/);
    });
});
