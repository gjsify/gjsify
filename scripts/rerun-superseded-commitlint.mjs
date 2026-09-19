#!/usr/bin/env node
// Clearing the commitlint reds an edit left on THIS commit — the second half of the fix
// `scripts/decide-commitlint-verdict.mjs` carries, and the half that reaches a run which has
// already concluded.
//
// WHY A SECOND MECHANISM IS NEEDED. The verdict step voids a run that is still IN FLIGHT when
// the text moves under it. That covers the burst — #1704's four runs were created inside
// fifteen seconds — but not the ordinary repair loop, where the check reports a real red, a
// human reads it and edits the body two minutes later. Measured over the last 300 commitlint
// runs (2026-09-19): 20 of 208 commits carried both a non-success and a success commitlint
// run, and of the 22 stale non-successes, 7 overlapped their successor and 15 did not. The
// in-flight void alone would leave two thirds of them on the commit.
//
// WHAT CLEARS A CONCLUDED RUN. Not a cancel: measured on 934319ead0, a commit whose only
// `Lint commit messages` entries are CANCELLED rolls up FAILURE exactly as a failure does, and
// that context blocks a merge here. A re-run does clear it — a new attempt REPLACES the run's
// entry in the rollup rather than adding one, which is why re-running the three stale runs by
// hand is what unblocked #1704. This automates that hand repair, and nothing more.
//
// THE RE-RUN COSTS NOTHING TWICE. A re-run replays the same event payload, so the replayed run
// re-reads the PR, finds the text has moved, and ends green as superseded — by the rule in
// `decide-commitlint-verdict.mjs`, not by being told to pass.
//
// THE BOUNDS, each one a way this could go wrong:
//
//   · only runs on THIS head SHA, because a run on another commit is not on the rollup this
//     job is repairing
//   · only runs OLDER than this one. A newer red may be the live verdict — ours is only known
//     current as of our own read — and re-running it would discard a finding nobody has seen
//   · only `run_attempt === 1`. A run this job already retried once and that is red again is
//     red for a reason that is not staleness, and retrying it forever is how a repair becomes
//     a loop
//   · only `failure`, `cancelled`, `timed_out`. `action_required` is parked on a human decision
//     (the same line `cancel-superseded-runs.mjs` draws), and `startup_failure` names a run
//     that never started, which a re-run does not repair
//   · at most {@link MAX_RERUNS}, so a commit that somehow accumulated dozens cannot turn one
//     green verdict into a runner stampede
//
// AND THE COUNT IS OF RUNS THAT ACTUALLY RESTARTED, not of POSTs that were accepted — #1548 is
// the incident where a job counted its own requests and called them outcomes.
//
// Usage (the workflow's shape, and the way to reproduce a run by hand):
//   GH_TOKEN=… REPO=owner/repo HEAD_SHA=… GITHUB_RUN_ID=… \
//     node scripts/rerun-superseded-commitlint.mjs < runs.json
// Reads a `GET /actions/workflows/commitlint.yml/runs` response (or a bare array) from stdin.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Conclusions that keep a required context from being satisfied and that a re-run can move. */
const STALE_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out']);

/**
 * The most runs one green verdict may restart.
 *
 * Not a guess at a reasonable number of edits — a ceiling on the blast radius. A selection bug
 * that matched everything would otherwise spend a runner per row of the listing.
 */
const MAX_RERUNS = 10;

function instant(value, what) {
    const ms = Date.parse(String(value ?? ''));
    if (Number.isNaN(ms)) throw new Error(`rerun-superseded-commitlint: ${what} is not a timestamp: ${value}`);
    return ms;
}

/**
 * The commitlint runs on this commit that a live green verdict supersedes.
 *
 * Returns `null` — not an empty list — when this job's own run is absent from the listing.
 * Without it there is no ordering, and "re-run everything red on this commit" is a different
 * and much less defensible act than the one this file is for.
 *
 * @param {{ runs: Array<Record<string, any>>, headSha: string, selfRunId: string | number }} input
 * @returns {number[] | null}
 */
export function supersededCommitlintRuns({ runs, headSha, selfRunId }) {
    const self = Number(selfRunId);
    if (!Number.isInteger(self))
        throw new Error(`rerun-superseded-commitlint: own run id is not a number: ${selfRunId}`);

    const me = runs.find((run) => Number(run.id) === self);
    if (me === undefined) return null;
    const mine = instant(me.created_at, "this run's created_at");

    return runs
        .filter(
            (run) =>
                run.head_sha === headSha &&
                Number(run.id) !== self &&
                run.status === 'completed' &&
                STALE_CONCLUSIONS.has(run.conclusion) &&
                Number(run.run_attempt) === 1 &&
                instant(run.created_at, `run ${run.id}'s created_at`) < mine,
        )
        .sort((a, b) => instant(a.created_at, 'created_at') - instant(b.created_at, 'created_at'))
        .slice(0, MAX_RERUNS)
        .map((run) => run.id);
}

/**
 * Restart the selected runs and report the ones that actually restarted.
 *
 * A run is counted only once it has been READ BACK on a later attempt: a 403 from a fork PR's
 * read-only token and a 409 from a run GitHub declines to restart both answer the POST without
 * moving anything, and both used to be indistinguishable from a repair in the log.
 *
 * @param {{
 *   ids: (string|number)[],
 *   api: (method: string, path: string) => Promise<{ status: number, body: unknown }>,
 *   log?: (line: string) => void,
 * }} input
 * @returns {Promise<{ selected: number, posted: number, refused: number, restarted: number, stuck: string[] }>}
 */
export async function rerunSupersededCommitlint({ ids, api, log = console.log }) {
    const selected = ids.map((id) => String(id));
    let posted = 0;
    let refused = 0;

    // A THROW IS NOT A VERDICT — the same reasoning as `cancel-superseded-runs.mjs`. This is a
    // repair job; a DNS blip must not put a red X on a PR whose own checks are green.
    const call = async (method, path) => {
        try {
            return await api(method, path);
        } catch (error) {
            log(`${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
            return { status: 0, body: undefined };
        }
    };

    const accepted = [];
    for (const id of selected) {
        const { status } = await call('POST', `actions/runs/${id}/rerun`);
        if (status >= 200 && status < 300) {
            posted += 1;
            accepted.push(id);
            log(`run ${id}: re-run requested`);
        } else {
            refused += 1;
            log(
                `run ${id}: re-run refused with ${status} (a read-only token on a fork PR, or a run GitHub declines to restart)`,
            );
        }
    }

    let restarted = 0;
    const stuck = [];
    for (const id of accepted) {
        const { status, body } = await call('GET', `actions/runs/${id}`);
        const attempt = Number(/** @type {{ run_attempt?: unknown }} */ (body)?.run_attempt);
        if (status >= 200 && status < 300 && attempt > 1) {
            restarted += 1;
            log(`run ${id}: now on attempt ${attempt} — its stale conclusion is off this commit`);
        } else {
            stuck.push(id);
            log(`run ${id}: the re-run was accepted and the run is still on attempt ${attempt || '?'}`);
        }
    }

    return { selected: selected.length, posted, refused, restarted, stuck };
}

/** `Bearer`-authenticated GitHub API calls against one repository. */
function githubApi(repo, token) {
    return async (method, path) => {
        const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
            method,
            headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${token}`,
                'x-github-api-version': '2022-11-28',
            },
        });
        const body = method === 'GET' ? await response.json().catch(() => undefined) : undefined;
        return { status: response.status, body };
    };
}

function required(value, what) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`rerun-superseded-commitlint: no ${what}, so nothing can be cleared.`);
    }
    return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const listed = JSON.parse(readFileSync(0, 'utf8'));
    const runs = Array.isArray(listed) ? listed : (listed.workflow_runs ?? []);
    const headSha = required(process.env.HEAD_SHA, 'head sha');
    const ids = supersededCommitlintRuns({
        runs,
        headSha,
        selfRunId: required(process.env.GITHUB_RUN_ID, 'own run id'),
    });

    if (ids === null) {
        console.log(
            `::warning::This job's own run is not in the listing for ${headSha.slice(0, 10)}, so the runs it ` +
                'supersedes cannot be ordered. Nothing cleared.',
        );
        process.exit(0);
    }
    if (ids.length === 0) {
        console.log(`No superseded commitlint runs on ${headSha.slice(0, 10)} — nothing to clear.`);
        process.exit(0);
    }

    const result = await rerunSupersededCommitlint({
        ids,
        api: githubApi(required(process.env.REPO, 'REPO'), required(process.env.GH_TOKEN, 'GH_TOKEN')),
    });

    // A SURVIVOR IS A WARNING. The whole point of this job is that a stale red on the commit is
    // invisible as staleness, so one this job failed to clear has to reach the checks list
    // rather than the log. Gated on `posted`, because a fork PR's read-only token refuses every
    // POST and annotating that on every fork contribution trains the annotation out of meaning.
    const left = result.stuck.length > 0 ? `; ${result.stuck.length} did not restart: ${result.stuck.join(', ')}` : '';
    const level = result.stuck.length > 0 && result.posted > 0 ? 'warning' : 'notice';
    console.log(
        `::${level}::${result.restarted} of ${result.selected} superseded commitlint run(s) on ` +
            `${headSha.slice(0, 10)} restarted${left}.`,
    );
}
