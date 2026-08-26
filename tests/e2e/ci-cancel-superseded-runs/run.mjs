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
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-cancel-superseded-runs/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'select-superseded-runs.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'cancel-pr-runs.yml');

const { cancellationWindow, supersededRunIds } = await import(`file://${SCRIPT}`);

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
