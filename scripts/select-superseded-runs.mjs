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
// T IS LOAD-BEARING, in two different ways.
//
// Branch names in this repository ARE reused (the agent worktrees and the release
// tooling both do it), so without the bound, closing an old PR would cancel a fresh
// run belonging to whatever reopened that name.
//
// On `synchronize` it additionally carries the ORDERING case, which is the one that
// costs a valid measurement. Two pushes land in quick succession; the first push's
// cancel job gets a runner only after the second push. Its `keepSha` is the FIRST
// head, so every other rule agrees that the second push's runs — the current ones —
// are cancellable. The bound is the only thing that saves them: they were created
// after the event that this job is acting on.
//
// Usage (the workflow's shape, and the way to reproduce a decision by hand):
//   GITHUB_EVENT_PATH=event.json GITHUB_RUN_ID=<id> \
//     node scripts/select-superseded-runs.mjs < runs.json
// Reads the `pull_request` payload from `$GITHUB_EVENT_PATH` and a
// `GET /actions/runs` response (or a bare array of runs) from stdin; prints one run id
// per line.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Every field this reads is one GitHub always sends; an absent one is a defect, not a case. */
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
 * The window one event opens: the head branch, the moment T, and the SHA that survives
 * it.
 *
 * @param {{ action?: string, pull_request?: Record<string, any> }} event
 * @returns {{ headRef: string, cutoff: number, keepSha: string | null }}
 */
export function cancellationWindow(event) {
    const pr = required(event?.pull_request, 'pull_request');
    const headRef = required(pr.head?.ref, 'head branch');
    switch (event.action) {
        case 'closed':
            return { headRef, cutoff: instant(pr.closed_at, 'closed_at'), keepSha: null };
        case 'synchronize':
            return {
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
    const { headRef, cutoff, keepSha } = cancellationWindow(event);
    // Not a guard against a missing field but against cancelling THIS job: an empty
    // `SELF_RUN_ID` matches no run, the cancel loop kills the job running it, and the
    // rest of the list stays alive with nothing saying so.
    const self = Number(required(selfRunId, 'own run id'));
    if (!Number.isInteger(self)) throw new Error(`select-superseded-runs: own run id is not a number: ${selfRunId}`);

    return runs
        .filter(
            (run) =>
                run.head_branch === headRef &&
                run.status !== 'completed' &&
                (keepSha === null || run.head_sha !== keepSha) &&
                instant(run.created_at, `run ${run.id}'s created_at`) <= cutoff &&
                Number(run.id) !== self,
        )
        .map((run) => run.id);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const event = JSON.parse(readFileSync(required(process.env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH'), 'utf8'));
    const listed = JSON.parse(readFileSync(0, 'utf8'));
    const runs = Array.isArray(listed) ? listed : (listed.workflow_runs ?? []);
    const ids = supersededRunIds({ event, runs, selfRunId: process.env.GITHUB_RUN_ID });
    if (ids.length > 0) console.log(ids.join('\n'));
}
