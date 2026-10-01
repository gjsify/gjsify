#!/usr/bin/env node
// Which runs a `pull_request` event has SUPERSEDED — the selection that
// `.github/workflows/cancel-pr-runs.yml` acts on, lifted out of its `run:` block so a
// test can put the decision under fixtures.
//
// WHY IT IS A FILE AND NOT A `--jq` FILTER
//
// This selection ends in `POST /actions/runs/{id}/cancel`. Cancelling a run that was
// NOT superseded is worse than the backlog the workflow exists to drain: the run
// disappears while somebody is waiting on its verdict, and `cancelled` reads as noise
// rather than as a gap (`main.yml`'s concurrency header records that exact
// misreading). A filter embedded in a workflow can only be reviewed by reading it —
// nothing runs it until it runs for real, on other people's runs.
//
// THE WINDOW — one selection, two events
//
// Both events cancel "the non-completed runs of this PR's head branch that existed at
// time T". They differ only in T and in what is EXEMPT from it:
//
//   closed      → T = closed_at,  exempt: nothing (no verdict from this branch is
//                                 wanted any more)
//   synchronize → T = updated_at, exempt: the SHA that is now the head
//
// Matched by head BRANCH, not by head SHA: a force-pushed PR has runs under several
// SHAs and every one of them is moot, while a SHA match would leave the older ones
// running — which is half the backlog the workflow exists to drain.
//
// A branch name alone does not identify a PR, so the head REPOSITORY is matched too.
// `head_branch` on a fork's run is the name in the FORK, and the two namespaces
// collide on exactly the names people reach for by default — `main`, `patch-1` (what
// the GitHub web editor calls its branch, on either side). Without the repository
// match, a push to an internal `patch-1` cancels a FORK PR's in-flight matrix: a
// different PR, superseded by nothing, which is the one outcome this file is
// organised around avoiding. Measured against fixtures before the match existed;
// `tests/e2e/ci-cancel-superseded-runs` holds the case.
//
// T IS LOAD-BEARING, in two different ways.
//
// Branch names in this repository ARE reused OVER TIME (the agent worktrees and the
// release tooling both do it), so without the bound, closing an old PR would cancel a
// fresh run belonging to whatever reopened that name. Concurrent reuse across
// namespaces is the repository match above, not this bound — the clock cannot see it,
// because a fork's run is not older than the push that would cancel it.
//
// On `synchronize` it additionally carries the ORDERING case, which is the one that
// costs a valid measurement. Two pushes land in quick succession; the first push's
// cancel job gets a runner only after the second push. Its `keepSha` is the FIRST
// head, so every other rule agrees that the second push's runs — the current ones —
// are cancellable. The bound is the only thing that saves them: they were created
// after the event that this job is acting on.
//
// The bound's RESOLUTION is one second, because that is what these timestamps carry.
// Two pushes inside a single clock second truncate to the same value, and `<=` then
// admits the second push's runs into the first push's window. Left as is: a second
// `git push` to the same branch cannot complete inside the first one's second, and the
// alternative — a strict `<` — would exclude the head run by the CLOCK, which is
// precisely how the head-exemption test was green for the wrong reason on the first
// draft.
//
// Usage (the workflow's shape, and the way to reproduce a decision by hand):
//   GITHUB_EVENT_PATH=event.json GITHUB_RUN_ID=<id> \
//     node scripts/select-superseded-runs.mjs < runs.json
// Reads the `pull_request` payload from `$GITHUB_EVENT_PATH` and a
// `GET /actions/runs` response (or a bare array of runs) from stdin; prints one run id
// per line.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** For the fields GitHub always sends, where an absent one is a defect rather than a case. */
function required(value, what) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`select-superseded-runs: the event carries no ${what}, so no window can be derived.`);
    }
    return value;
}

/**
 * A timestamp as epoch milliseconds.
 *
 * Parsed rather than compared as text: the two sides come from different fields of the
 * same API and only agree on being ISO-8601. An unparseable one THROWS — comparing
 * against `NaN` is false for every run, which would report "nothing to cancel" and
 * leave the deadlock in place with a green job over it.
 */
function instant(value, what) {
    const ms = Date.parse(required(value, what));
    if (Number.isNaN(ms)) throw new Error(`select-superseded-runs: ${what} is not a timestamp: ${value}`);
    return ms;
}

/**
 * The window one event opens: the head repository and branch, the moment T, and the SHA
 * that survives it.
 *
 * `head.repo` is the one field here that GitHub legitimately sends as `null` — a PR
 * whose fork has been deleted. That is not a reason to fall back to matching on the
 * branch name alone: the name is shared across namespaces, so the fallback would cancel
 * whatever else currently answers to it. Refusing loudly costs a red job on a PR nobody
 * is waiting for; guessing costs somebody else's measurement.
 *
 * @param {{ action?: string, pull_request?: Record<string, any> }} event
 * @returns {{ headRepo: string, headRef: string, cutoff: number, keepSha: string | null }}
 */
export function cancellationWindow(event) {
    const pr = required(event?.pull_request, 'pull_request');
    const headRepo = pr.head?.repo?.full_name;
    if (!headRepo) {
        throw new Error(
            'select-superseded-runs: the event carries no head repository (a deleted fork), so no run can be attributed to this PR.',
        );
    }
    const headRef = required(pr.head?.ref, 'head branch');
    switch (event.action) {
        case 'closed':
            return { headRepo, headRef, cutoff: instant(pr.closed_at, 'closed_at'), keepSha: null };
        case 'synchronize':
            return {
                headRepo,
                headRef,
                cutoff: instant(pr.updated_at, 'updated_at'),
                keepSha: required(pr.head?.sha, 'head sha'),
            };
        default:
            // A `types:` entry added to the workflow without a window here would
            // otherwise fall through to some default and cancel by whichever rules it
            // happened to inherit.
            throw new Error(
                `select-superseded-runs: no cancellation window is defined for pull_request action "${event?.action}".`,
            );
    }
}

/**
 * The run ids this event superseded.
 *
 * @param {{ event: object, runs: Array<Record<string, any>>, selfRunId: string | number }} input
 * @returns {number[]}
 */
export function supersededRunIds({ event, runs, selfRunId }) {
    const { headRepo, headRef, cutoff, keepSha } = cancellationWindow(event);
    // Not a guard against a missing field but against cancelling THIS job: an empty
    // `SELF_RUN_ID` matches no run, the cancel loop kills the job running it, and the
    // rest of the list stays alive with nothing saying so.
    const self = Number(required(selfRunId, 'own run id'));
    if (!Number.isInteger(self)) throw new Error(`select-superseded-runs: own run id is not a number: ${selfRunId}`);

    return runs
        .filter(
            (run) =>
                // Read off the RUN rather than trusted from the query: a run whose
                // `head_repository` is absent stays unmatched, which is the safe
                // direction — an unattributable run is left running.
                run.head_repository?.full_name === headRepo &&
                run.head_branch === headRef &&
                run.status !== 'completed' &&
                (keepSha === null || run.head_sha !== keepSha) &&
                instant(run.created_at, `run ${run.id}'s created_at`) <= cutoff &&
                Number(run.id) !== self,
        )
        .map((run) => run.id);
}

/** Where the merge queue puts the branch it builds one entry on. */
const QUEUE_BRANCH_PREFIX = 'gh-readonly-queue/';

/**
 * The `merge_group` runs whose queue entry no longer exists.
 *
 * A THIRD KIND of moot run, and the one neither window above can reach. The queue
 * builds every entry on its own branch `gh-readonly-queue/main/pr-<N>-<sha>`; when an
 * entry is dropped, or a new group forms behind a dequeued one, that branch is
 * DELETED — and the run built on it keeps going. Nothing supersedes it: a
 * `merge_group` run has no PR head to push to and no `closed` to wait for.
 *
 * MEASURED, 2026-10-01: five `GJS` merge_group runs sat `queued` for queue branches
 * that `git ls-remote origin 'refs/heads/gh-readonly-queue/*'` no longer listed, and
 * were cancelled by hand — each one a full matrix holding slots on a saturated pool.
 *
 * THE BRANCH IS THE ONLY DISCRIMINATOR, and it is a good one: a live entry's branch
 * exists for as long as the queue wants its verdict, so "branch gone" is exactly "nobody
 * will read this". No clock, no head SHA — and no PR number, because the sweep also
 * runs from a `merge_group` event that has none.
 *
 * ORDER OF THE TWO READS IS LOAD-BEARING. The caller must list the RUNS first and the
 * branches second. A run is only ever created after its branch, so every listed run's
 * branch existed when it was listed; read the other way round, a group that formed
 * between the two calls has a run and no branch in the stale list, and the sweep
 * would cancel the live entry it was triggered by.
 *
 * What is NOT selected: a completed run, this job's own run, a run outside the queue
 * namespace (`head_branch` is free text on other events), and a run whose head
 * repository is not `repo` — the queue branch lives in the base repository.
 *
 * @param {{ runs: Array<Record<string, any>>, liveRefs: string[], repo: string, selfRunId: string | number }} input
 * @returns {number[]}
 */
export function deadQueueRunIds({ runs, liveRefs, repo, selfRunId }) {
    const self = Number(required(selfRunId, 'own run id'));
    if (!Number.isInteger(self)) throw new Error(`select-superseded-runs: own run id is not a number: ${selfRunId}`);
    required(repo, 'repository');
    const live = new Set(liveRefs.map((ref) => ref.trim().replace(/^refs\/heads\//, '')).filter((ref) => ref !== ''));

    return runs
        .filter(
            (run) =>
                run.event === 'merge_group' &&
                run.status !== 'completed' &&
                run.head_repository?.full_name === repo &&
                typeof run.head_branch === 'string' &&
                run.head_branch.startsWith(QUEUE_BRANCH_PREFIX) &&
                !live.has(run.head_branch) &&
                Number(run.id) !== self,
        )
        .map((run) => run.id);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv[2] === '--dead-queue') {
    // Usage: GITHUB_RUN_ID=<id> REPO=owner/repo \
    //   node scripts/select-superseded-runs.mjs --dead-queue <live-refs.txt> < runs.json
    // `<live-refs.txt>` holds one remote queue branch per line (`refs/heads/…` or bare).
    const liveRefs = readFileSync(required(process.argv[3], 'live refs file'), 'utf8').split('\n');
    const listed = JSON.parse(readFileSync(0, 'utf8'));
    const runs = Array.isArray(listed) ? listed : (listed.workflow_runs ?? []);
    const ids = deadQueueRunIds({ runs, liveRefs, repo: process.env.REPO, selfRunId: process.env.GITHUB_RUN_ID });
    if (ids.length > 0) console.log(ids.join('\n'));
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const event = JSON.parse(readFileSync(required(process.env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH'), 'utf8'));
    const listed = JSON.parse(readFileSync(0, 'utf8'));
    const runs = Array.isArray(listed) ? listed : (listed.workflow_runs ?? []);
    const ids = supersededRunIds({ event, runs, selfRunId: process.env.GITHUB_RUN_ID });
    if (ids.length > 0) console.log(ids.join('\n'));
}
