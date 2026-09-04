// E2E test for `scripts/select-superseded-runs.mjs` — the selection
// `.github/workflows/cancel-pr-runs.yml` acts on.
//
// The workflow ends in `POST /actions/runs/{id}/cancel`, so the only cheap way to be
// wrong here is expensive: a run that was NOT superseded disappears while somebody
// waits on its verdict, and `cancelled` reads as noise rather than as a gap. Nothing
// about a workflow can be exercised before it runs for real, on real runs — which is
// why the decision is a function and this file is the place it is wrong.
//
// The fixtures are the incident the `synchronize` trigger was added for: branch
// `fix/prebuilds-musl-leg`, run 32937220245 on the superseded commit 1fc2ebbdc,
// 2026-08-26. Every case below is one way that push could have picked the wrong runs.
//
// The last describe is the WIRING half, and it is not decoration: a green suite over a
// script no workflow invokes is the failure class this repository pays for most.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-cancel-superseded-runs/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'select-superseded-runs.mjs');
const CANCEL_SCRIPT = join(MONOREPO_ROOT, 'scripts', 'cancel-superseded-runs.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'cancel-pr-runs.yml');

const { cancellationWindow, supersededRunIds } = await import(`file://${SCRIPT}`);
const { cancelSupersededRuns } = await import(`file://${CANCEL_SCRIPT}`);

const REPO = 'gjsify/gjsify';
/** A fork. Its branch NAMESPACE is its own, so a name here says nothing about this repo. */
const FORK = 'contrib/gjsify';
const BRANCH = 'fix/prebuilds-musl-leg';
/** The commit the stale run was on. */
const STALE_SHA = '1fc2ebbdc';
/** The commit the force-push made the head. */
const HEAD_SHA = 'e4d5c6b7a';
/** The moment the push landed — both the PR's `updated_at` and, later, its `closed_at`. */
const EVENT_AT = '2026-08-26T10:00:00Z';
const SELF_RUN_ID = 32938000000;

/** One row of `GET /actions/runs`, with only the fields the selection reads. */
function run({
    id,
    sha = STALE_SHA,
    branch = BRANCH,
    repo = REPO,
    status = 'queued',
    created = '2026-08-26T08:30:00Z',
}) {
    return {
        id,
        head_branch: branch,
        head_sha: sha,
        head_repository: repo === null ? null : { full_name: repo },
        status,
        created_at: created,
    };
}

const prHead = (repo) => ({ ref: BRANCH, sha: HEAD_SHA, repo: repo === null ? null : { full_name: repo } });

const synchronizeEvent = (updatedAt = EVENT_AT, repo = REPO) => ({
    action: 'synchronize',
    pull_request: { number: 1331, head: prHead(repo), updated_at: updatedAt },
});

const closedEvent = (closedAt = EVENT_AT, repo = REPO) => ({
    action: 'closed',
    pull_request: { number: 1331, head: prHead(repo), closed_at: closedAt, updated_at: closedAt },
});

const idsFor = (event, runs) => supersededRunIds({ event, runs, selfRunId: SELF_RUN_ID });

describe('the window a push opens', () => {
    it('never cancels the commit that is now the head', () => {
        // The whole point of the trigger is to let the NEW run start. Cancelling it
        // would turn a cost control into an outage, and it is the one run whose
        // verdict somebody is definitely waiting for.
        //
        // The new run is created by the same push that set `updated_at`, so it sits ON
        // the bound rather than past it — which is what makes the exemption, and not
        // the clock, the thing under test here.
        const runs = [run({ id: 32937220245 }), run({ id: 32938100000, sha: HEAD_SHA, created: EVENT_AT })];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), [32937220245]);
    });

    it('cancels a run on an older commit of the same branch', () => {
        // Matched by BRANCH, so a PR force-pushed twice does not leave the
        // next-but-one commit's matrix alive — that was half the measured backlog.
        const runs = [
            run({ id: 32937220245 }),
            run({ id: 32937300000, sha: 'b0b0b0b0b', created: '2026-08-26T09:10:00Z' }),
        ];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), [32937220245, 32937300000]);
    });

    it('leaves a run that did not exist when this push happened', () => {
        // Two ways into this row and the bound answers both. The branch name may have
        // been REUSED (the agent worktrees and the release tooling both do it); or a
        // second push landed while this job was still queued, in which case its runs
        // are the current ones and every other rule here calls them stale.
        const runs = [run({ id: 32939000000, sha: 'f00df00d0', created: '2026-08-26T10:07:00Z' })];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), []);
    });

    it('does not touch a run that has already completed', () => {
        // Cancelling a finished run is a 409 the workflow tolerates, but a selection
        // that includes them spends an API call per stale run in the list and reports
        // a cancel count nobody can trust.
        const runs = [run({ id: 32930000000, status: 'completed' }), run({ id: 32937220245 })];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), [32937220245]);
    });

    it('does not reach a run on another branch', () => {
        // Four other PRs were saturating the pool on the measured day. None of them is
        // superseded by a push to this one.
        const runs = [run({ id: 32937400000, branch: 'feat/gtk-host-react' }), run({ id: 32937220245 })];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), [32937220245]);
    });

    it('does not reach a fork PR that happens to use the same branch name', () => {
        // `head_branch` on a fork's run is the name in the FORK, and the clock cannot
        // separate the two: the fork's run is not OLDER than the push that would cancel
        // it, so every time-based rule here calls it stale. Only the repository does.
        // The names that collide are the ones nobody chooses on purpose — `main`, or
        // `patch-1` on whichever side used the GitHub web editor.
        const runs = [
            run({
                id: 32937500000,
                repo: FORK,
                sha: 'f00df00d0',
                status: 'in_progress',
                created: '2026-08-26T09:55:00Z',
            }),
            run({ id: 32937220245 }),
        ];
        assert.deepEqual(idsFor(synchronizeEvent(), runs), [32937220245]);
    });

    it('leaves a run it cannot attribute to any repository', () => {
        // An absent `head_repository` stays unmatched rather than falling back to the
        // branch name — the safe direction is a run left running, never a run cancelled
        // on a guess.
        assert.deepEqual(idsFor(synchronizeEvent(), [run({ id: 32937600000, repo: null })]), []);
    });
});

describe('the window a close opens', () => {
    it('cancels the head run too, because no verdict from this branch is wanted', () => {
        // The one asymmetry between the two events: `synchronize` exempts the head,
        // `closed` exempts nothing.
        const runs = [run({ id: 32937220245 }), run({ id: 32938100000, sha: HEAD_SHA })];
        assert.deepEqual(idsFor(closedEvent(), runs), [32937220245, 32938100000]);
    });

    it('still stops at the moment the PR closed', () => {
        const runs = [run({ id: 32939000000, created: '2026-08-26T10:07:00Z' })];
        assert.deepEqual(idsFor(closedEvent(), runs), []);
    });

    it('does not cancel the job doing the cancelling', () => {
        // Belongs to THIS window and not to the push one: on `synchronize` this job's
        // own run carries the new head SHA, so the exemption above already covers it
        // and a test there would pass without the id check existing. On `closed`
        // nothing is exempt, and the run is created by the very event it is draining —
        // same branch, same second — so the id is the only thing between this job and
        // cancelling itself halfway through the list.
        const runs = [run({ id: SELF_RUN_ID, sha: HEAD_SHA, created: EVENT_AT }), run({ id: 32937220245 })];
        assert.deepEqual(idsFor(closedEvent(), runs), [32937220245]);
    });
});

describe('the windows themselves', () => {
    it('reads the close bound from closed_at and the push bound from updated_at', () => {
        assert.deepEqual(cancellationWindow(closedEvent()), {
            headRepo: REPO,
            headRef: BRANCH,
            cutoff: Date.parse(EVENT_AT),
            keepSha: null,
        });
        assert.deepEqual(cancellationWindow(synchronizeEvent()), {
            headRepo: REPO,
            headRef: BRANCH,
            cutoff: Date.parse(EVENT_AT),
            keepSha: HEAD_SHA,
        });
    });
});

describe('the inputs it refuses to guess at', () => {
    it('refuses an action it has no window for', () => {
        // Adding a `types:` entry to the workflow without deciding its window would
        // otherwise cancel by whichever rules the new event happened to inherit.
        assert.throws(() => idsFor({ ...synchronizeEvent(), action: 'reopened' }, []), /no cancellation window/);
    });

    it('refuses to run without its own run id', () => {
        // An empty `SELF_RUN_ID` matches no run: the loop cancels this very job, the
        // rest of the list stays alive, and nothing says so.
        assert.throws(() => supersededRunIds({ event: synchronizeEvent(), runs: [], selfRunId: '' }), /no own run id/);
    });

    it('refuses a PR whose head repository is gone', () => {
        // GitHub sends `head.repo: null` once a fork is deleted. Matching on the branch
        // name alone would then cancel whatever else currently answers to that name, so
        // this throws instead — a red job on a PR nobody waits for, against somebody
        // else's measurement.
        assert.throws(() => idsFor(closedEvent(EVENT_AT, null), []), /no head repository/);
    });

    it('refuses a bound it cannot parse instead of selecting nothing', () => {
        // `NaN` compares false against every run, so the quiet reading of an
        // unparseable timestamp is "nothing to cancel" — a green job over the
        // deadlock it exists to break.
        assert.throws(() => idsFor(synchronizeEvent('the other day'), []), /not a timestamp/);
        assert.throws(() => idsFor(synchronizeEvent(), [run({ id: 1, created: 'shortly before' })]), /not a timestamp/);
    });
});

describe('the command line the workflow uses', () => {
    it('takes the event from the environment and the runs from stdin', () => {
        // The seam the exported function cannot cover: the workflow pipes a whole
        // `GET /actions/runs` RESPONSE, not the array inside it, and passes the event
        // by the path the runner exports rather than as an argument.
        const dir = mkdtempSync(join(tmpdir(), 'select-superseded-runs-'));
        try {
            const eventPath = join(dir, 'event.json');
            writeFileSync(eventPath, JSON.stringify(synchronizeEvent()));
            const result = spawnSync(process.execPath, [SCRIPT], {
                cwd: MONOREPO_ROOT,
                encoding: 'utf8',
                env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: String(SELF_RUN_ID) },
                input: JSON.stringify({
                    total_count: 2,
                    workflow_runs: [run({ id: 32937220245 }), run({ id: 32938100000, sha: HEAD_SHA })],
                }),
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), '32937220245');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('the workflow that runs it', () => {
    it('triggers on both events and invokes this selection for them', () => {
        // A selection no workflow calls passes every test above and drains nothing.
        const yaml = readFileSync(WORKFLOW, 'utf8');
        assert.match(yaml, /types:\s*\[closed,\s*synchronize\]/);
        assert.match(yaml, /node scripts\/select-superseded-runs\.mjs/);
    });

    it('checks the selection out from the BASE, not the head', () => {
        // TWO failures ride on this one line, and the first one already happened.
        //
        // A branch created BEFORE this script landed does not contain it, so a head
        // checkout gives `Cannot find module` and `set -euo pipefail` fails the job —
        // measured on #1340, whose branch predated #1334 by hours and which therefore
        // went red on a job about its own obsolete runs. That is not a transition cost:
        // every branch cut before a later change to this script has the same shape.
        //
        // And the job holds `actions: write`, which AGENTS.md forbids pairing with head
        // code. The base SHA is the only spelling that satisfies both.
        const yaml = readFileSync(WORKFLOW, 'utf8');
        const ref = /^\s*ref:\s*(\S.*)$/m.exec(yaml);
        assert.ok(ref, 'the checkout must pin an explicit ref, not fall back to the merge ref');
        assert.match(ref[1], /pull_request\.base\.sha/);
        assert.doesNotMatch(ref[1], /head\.sha/);
    });
});

// ── the second half: what the cancel actually DID ────────────────────────────
//
// The selection above answers "which runs". This answers "did they stop", which is
// the question the `run:` block never asked: it counted its own POSTs. On 2026-09-04
// one cancel job reported `cancelled 4 run(s)` and TWO runs — 33857585236 and
// 33857738939, the only two measured — kept their concurrency groups for another
// 16m24s and 9m05s (#1548). The 4 was a POST count and the 2 is a run count, which is
// the confusion this whole file is about: do not let it back in here. Every fixture
// below is one way that gap can open.

/**
 * A GitHub Actions API that answers about a fixed set of runs.
 *
 * @param {Record<string, {state: string, stopsOnCancel?: boolean, cancel?: number,
 *   forceCancel?: number, completesAfterReads?: number}>} spec
 */
function fakeApi(spec) {
    const calls = [];
    const state = new Map(Object.entries(spec).map(([id, run]) => [id, run.state]));
    const reads = new Map(Object.keys(spec).map((id) => [id, 0]));
    const api = async (method, path) => {
        calls.push(`${method} ${path}`);
        const match = /^actions\/runs\/(\d+)(?:\/(cancel|force-cancel))?$/.exec(path);
        if (!match) throw new Error(`unexpected path ${path}`);
        const [, id, action] = match;
        const run = spec[id];
        if (action === 'cancel') {
            const status = run.cancel ?? 202;
            if (status < 300 && run.stopsOnCancel) state.set(id, 'completed');
            return { status };
        }
        if (action === 'force-cancel') {
            const status = run.forceCancel ?? 202;
            if (status < 300) state.set(id, 'completed');
            return { status };
        }
        reads.set(id, reads.get(id) + 1);
        if (run.completesAfterReads !== undefined && reads.get(id) >= run.completesAfterReads) {
            state.set(id, 'completed');
        }
        return { status: 200, body: { status: state.get(id) } };
    };
    return { api, calls };
}

/** One settle round, no real waiting — the timing is not what these fixtures are about. */
const cancel = (ids, spec, options = {}) => {
    const { api, calls } = fakeApi(spec);
    return cancelSupersededRuns({
        ids,
        api,
        log: () => {},
        settleMs: 0,
        pollMs: 1,
        sleep: async () => {},
        ...options,
    }).then((result) => ({ result, calls }));
};

describe('what the cancel did, not what it posted', () => {
    it('leaves a run that stopped on the ordinary cancel alone', async () => {
        // Force-cancel bypasses conditions and `always()` cleanup, so a run that
        // responds must never meet it — the two endpoints promise different things and
        // this is where the difference is kept.
        const { result, calls } = await cancel(['1'], { 1: { state: 'queued', stopsOnCancel: true } });
        assert.equal(result.stopped, 1);
        assert.equal(result.forced, 0);
        assert.ok(!calls.some((call) => call.includes('force-cancel')));
    });

    it('force-cancels the run that has nobody to acknowledge it', async () => {
        // THE MEASURED CASE. `status=queued` means no job was ever assigned a runner,
        // so the graceful cancel has nothing to deliver its intent to — and the run
        // keeps the concurrency group that is holding its successor out of the queue.
        const { result, calls } = await cancel(['33857738939'], { 33857738939: { state: 'queued' } });
        assert.deepEqual(calls, [
            'POST actions/runs/33857738939/cancel',
            'GET actions/runs/33857738939',
            'POST actions/runs/33857738939/force-cancel',
            'GET actions/runs/33857738939',
        ]);
        assert.equal(result.forced, 1);
        assert.equal(result.stopped, 1);
    });

    it('lets an unwinding run unwind', async () => {
        // `in_progress` means it HAS a runner, so it received the cancel and is running
        // its `always()` steps. Force-cancelling here would discard exactly the cleanup
        // the graceful cancel exists to preserve, so it is reported instead.
        const { result, calls } = await cancel(['2'], { 2: { state: 'in_progress' } });
        assert.ok(!calls.some((call) => call.includes('force-cancel')));
        assert.deepEqual(result.running, ['2']);
        assert.equal(result.stopped, 0);
    });

    it('gives the ordinary cancel the settle before deciding', async () => {
        // A queued run that DOES answer, one poll later. Without the settle every such
        // run would be force-cancelled, which is the unconditional shape #1548 argues
        // against.
        const { result, calls } = await cancel(
            ['3'],
            { 3: { state: 'queued', completesAfterReads: 2 } },
            { settleMs: 10, pollMs: 5 },
        );
        assert.ok(!calls.some((call) => call.includes('force-cancel')));
        assert.equal(result.stopped, 1);
    });

    it('counts the runs that stopped, not the requests that were accepted', async () => {
        // The assertion that was TRUE on 2026-09-04 while the outcome was false: two
        // cancels accepted, two runs still holding their concurrency groups. The old
        // `run:` block would have counted its two accepted POSTs; the real notice that
        // day said `cancelled 4 run(s)` because that job had posted four.
        const { result } = await cancel(['1', '2'], {
            1: { state: 'queued', forceCancel: 409 },
            2: { state: 'queued', forceCancel: 409 },
        });
        assert.equal(result.posted, 2);
        assert.equal(result.stopped, 0);
        assert.deepEqual(result.running, ['1', '2']);
    });

    it('reports rather than fails when the token cannot cancel', async () => {
        // A fork PR gets a read-only token by design (see the workflow header), so every
        // cancel POST comes back 403. That is a documented no-op, not a broken job.
        const { result } = await cancel(['1'], { 1: { state: 'queued', cancel: 403, forceCancel: 403 } });
        assert.equal(result.posted, 0);
        assert.equal(result.refused, 1);
        assert.equal(result.stopped, 0);
    });

    it('force-cancels a `pending` run, not only a literal `queued` one', async () => {
        // `select-superseded-runs.mjs` selects on `status !== 'completed'`, and the
        // API's non-terminal vocabulary is wider than one word. Sampling this
        // repository's last 300 runs on 2026-09-04: 263 completed, 25 queued, 9
        // in_progress, 3 PENDING — so keying the force-cancel on the literal `queued`
        // reported three live runs and force-cancelled none of them, which is the
        // deadlock this job exists to break, reported rather than broken.
        for (const state of ['pending', 'waiting', 'requested']) {
            const { result, calls } = await cancel(['4'], { 4: { state } });
            assert.equal(result.forced, 1, `a ${state} run has no runner either`);
            assert.ok(calls.some((call) => call.includes('force-cancel')));
        }
    });

    it('reports a status it has never seen rather than force-cancelling it', async () => {
        // The arm is ENUMERATED, not `!== 'in_progress'`. A status this file does not
        // know is not evidence that nothing is executing, and force-cancel is the one
        // action here that cannot be taken back.
        const { result, calls } = await cancel(['5'], { 5: { state: 'some_future_status' } });
        assert.equal(result.forced, 0);
        assert.deepEqual(result.running, ['5']);
        assert.ok(!calls.some((call) => call.includes('force-cancel')));
    });

    it('survives a transient network failure instead of failing the job', async () => {
        // The `run:` block this replaced was `gh api … || true` per run, so a DNS blip
        // could not fail the step. A bare `await fetch()` can — and this is a
        // cost-control job, where a red X for a transient is worse than the run it was
        // trying to cancel.
        const { api } = fakeApi({ 6: { state: 'queued' } });
        let first = true;
        const result = await cancelSupersededRuns({
            ids: ['6'],
            api: async (method, path) => {
                if (first) {
                    first = false;
                    throw new TypeError('fetch failed');
                }
                return api(method, path);
            },
            log: () => {},
            settleMs: 0,
            pollMs: 1,
            sleep: async () => {},
        });
        assert.equal(result.posted, 0, 'a throw is not an accepted cancel');
        assert.equal(result.refused, 1);
    });

    it('the settle it ships with is not zero', async () => {
        // The docstring argues at length why the wait is bounded AND non-zero; nothing
        // held either number, so `SETTLE_MS = 0` and a deleted `await sleep()` were
        // both green. Every other fixture here injects both, which is what makes the
        // production constants invisible to all of them.
        let slept = 0;
        await cancelSupersededRuns({
            ids: ['7'],
            api: fakeApi({ 7: { state: 'queued' } }).api,
            log: () => {},
            sleep: async (ms) => {
                slept += ms;
            },
        });
        assert.ok(slept >= 20_000, `the shipped settle waited ${slept}ms in total`);
    });

    it('never force-cancels on a status it could not read', async () => {
        // An unreadable run is not a stopped run and not a queued one. Both counts have
        // to under-claim rather than guess: inventing `queued` would force-cancel a run
        // on no evidence at all.
        const { api, calls } = fakeApi({ 9: { state: 'queued' } });
        const result = await cancelSupersededRuns({
            ids: ['9'],
            api: async (method, path) => (method === 'GET' ? { status: 404, body: undefined } : api(method, path)),
            log: () => {},
            settleMs: 0,
            pollMs: 1,
            sleep: async () => {},
        });
        assert.equal(result.stopped, 0);
        assert.deepEqual(result.running, ['9']);
        assert.ok(!calls.some((call) => call.includes('force-cancel')));
    });
});

// ── the line a human actually reads ──────────────────────────────────────────
//
// Everything above drives the exported function. The `::notice::` / `::warning::` is
// emitted from the CLI entry block, which nothing executed — so the incident's own
// wrong sentence could have been pasted back in and the suite would have stayed
// green. Measured: putting `::notice::cancelled ${result.posted} run(s) …` back left
// 27/27 passing, while a sibling assertion forbids that exact string in the YAML it
// moved OUT of. The artefact #1548 is about is the artefact, wherever it lives.

/**
 * Run the script the way the workflow does, with `fetch` replaced.
 *
 * A SUBPROCESS, not an import: the entry block is `if (import.meta.url === …argv[1])`,
 * so it is unreachable from this file's own `await import`. `--import` is how the stub
 * gets in front of it without the script growing an injection seam it does not
 * otherwise need.
 *
 * @param {string[]} ids run ids on stdin
 * @param {Record<string, string[]>} statuses id → the status each successive GET answers
 */
function runCli(ids, statuses, { cancel = 202, forceCancel = 202 } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-cancel-cli-'));
    try {
        const eventPath = join(dir, 'event.json');
        writeFileSync(eventPath, JSON.stringify({ action: 'synchronize', pull_request: { number: 1568 } }));
        const stub = join(dir, 'stub.mjs');
        writeFileSync(
            stub,
            `const statuses = ${JSON.stringify(statuses)};\n` +
                `globalThis.fetch = async (url, init) => {\n` +
                `    const path = new URL(url).pathname;\n` +
                `    const id = /runs\\/(\\d+)/.exec(path)[1];\n` +
                `    if (path.endsWith('/force-cancel')) return { status: ${forceCancel}, json: async () => ({}) };\n` +
                `    if (path.endsWith('/cancel')) return { status: ${cancel}, json: async () => ({}) };\n` +
                `    const seq = statuses[id];\n` +
                `    return { status: 200, json: async () => ({ status: seq.length > 1 ? seq.shift() : seq[0] }) };\n` +
                `};\n`,
        );
        return spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, CANCEL_SCRIPT], {
            cwd: MONOREPO_ROOT,
            encoding: 'utf8',
            env: { ...process.env, GITHUB_EVENT_PATH: eventPath, REPO, GH_TOKEN: 'x' },
            input: ids.join('\n'),
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('the annotation the workflow leaves behind', () => {
    it('says nothing at all when there was nothing to cancel', () => {
        const result = runCli([], {});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /No superseded runs for synchronize on PR #1568 — nothing to cancel\./);
        assert.doesNotMatch(result.stdout, /::(notice|warning)::/);
    });

    it('counts the runs that STOPPED, in the string a human reads', () => {
        // Two accepted POSTs, two runs that stop. `2 of 2`, and never the POST count
        // under a different name.
        const result = runCli(['33857585236', '33857738939'], {
            33857585236: ['completed'],
            33857738939: ['completed'],
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /::notice::2 of 2 run\(s\) superseded by synchronize on PR #1568 stopped\./);
        assert.doesNotMatch(result.stdout, /cancelled \d+ run/);
    });

    it('a run that outlived an ACCEPTED cancel is a warning, not a notice', () => {
        // #1548's whole shape was that nothing in the log looked wrong. A `::notice::`
        // does not reach the checks list; the deadlock this job exists to break has to.
        // ~20s: the SHIPPED settle runs for real here, because the point of this case
        // is the entry block exactly as CI executes it.
        const result = runCli(['33857585236', '33857738939'], {
            33857585236: ['completed'],
            33857738939: ['in_progress'],
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /::warning::1 of 2 run\(s\) .* stopped; 1 did not stop: 33857738939\./);
    });

    it('a fork PR, where nothing was accepted, stays a notice', () => {
        // Every POST 403s on a read-only token. Annotating that on every fork
        // contribution would train the annotation out of meaning anything.
        const result = runCli(['33857585236'], { 33857585236: ['queued'] }, { cancel: 403, forceCancel: 403 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /::notice::0 of 1 run\(s\)/);
        assert.doesNotMatch(result.stdout, /::warning::/);
    });
});

describe('the workflow that runs the cancel', () => {
    it('invokes the cancel script and checks it out', () => {
        // A cancel that no workflow calls leaves the deadlock exactly where it was, and
        // a script the sparse checkout omits fails the job on `Cannot find module` —
        // the shape #1340 already paid for once.
        //
        // BOUNDED TO THE CHECKOUT BLOCK. `sparse-checkout:[\s\S]*?<name>` spans the
        // whole file, so it matched from the `sparse-checkout:` key down to the `node
        // scripts/cancel-superseded-runs.mjs` INVOCATION forty lines later: deleting
        // the entry left this green over exactly the regression it names. Measured.
        const yaml = readFileSync(WORKFLOW, 'utf8');
        assert.match(yaml, /node scripts\/cancel-superseded-runs\.mjs/);
        const block = /^ *sparse-checkout: \|\n((?: {2,}\S.*\n)+)/m.exec(yaml);
        assert.ok(block, 'the checkout must list its scripts in a block scalar this test can bound');
        for (const script of ['select-superseded-runs.mjs', 'cancel-superseded-runs.mjs']) {
            assert.ok(
                block[1].includes(`scripts/${script}`),
                `the sparse checkout does not fetch scripts/${script}, so the step dies on Cannot find module`,
            );
        }
    });

    it('no-ops instead of failing when the PR base predates the cancel script', () => {
        // THE MIRROR OF #1340. The scripts come from `pull_request.base.sha`; the YAML
        // comes from the merge ref. So the FIRST event on any PR based before this file
        // merged runs the new invocation against a `scripts/` that has only the
        // selection — `Cannot find module`, exit 1 under `set -euo pipefail`, a red X on
        // the cancel job of every open PR, permanently on any PR stacked on a feature
        // branch (whose `base.sha` never advances with main). Reproduced against
        // `git ls-tree 0498711fe -- scripts/`, which holds the selection alone.
        const yaml = readFileSync(WORKFLOW, 'utf8');
        const guard = yaml.indexOf('[ ! -f scripts/cancel-superseded-runs.mjs ]');
        assert.notEqual(guard, -1, 'the invocation must be guarded on the script existing in the base checkout');
        assert.ok(
            guard < yaml.indexOf('node scripts/cancel-superseded-runs.mjs'),
            'the guard must come BEFORE the invocation it protects',
        );
        assert.match(yaml.slice(guard, guard + 400), /exit 0/);
    });

    it('no longer counts its own POSTs as cancellations', () => {
        // The literal string the incident's notice came from. Its return would mean the
        // shell had taken the decision back.
        const yaml = readFileSync(WORKFLOW, 'utf8');
        assert.doesNotMatch(yaml, /::notice::cancelled/);
    });
});
