#!/usr/bin/env node
// Clearing the commitlint reds an edit left on THIS commit — the second half of the fix
// `scripts/decide-commitlint-verdict.mjs` carries, and the half that reaches a run which has
// already concluded.
//
// WHY A SECOND MECHANISM IS NEEDED. The verdict step governs a run that is still EXECUTING: it
// re-reads the description before concluding. A run that has already concluded cannot re-read
// anything, and the rollup keeps the LATEST check run per context — so a stale conclusion that
// happens to be the newest entry owns that context until something moves it.
//
// THAT IS WHERE #1704 SITS, and the part worth keeping is what did NOT fix it. Its
// `Lint commit messages` entries are SUCCESS at 06:49 and then FAILURE at 07:13, 07:14 and
// 07:22: three hand re-runs, each replaying the same superseded payload under the OLD workflow
// and therefore failing again. Re-running by hand is what put that PR where it is.
//
// WHICH IS THE WHOLE POINT OF THE PAIRING. A re-run replays the same event payload, so under
// `decide-commitlint-verdict.mjs` the replayed run re-reads the PR, finds the text has moved,
// and ends green as SUPERSEDED — green because it says why, not because it was told to pass.
// Without that step this script reproduces #1704; with it, it is the repair. Proven end to end
// on the probe PR #1708, whose red run was restarted by this job and came back green.
//
// SIZING, measured over the last 300 commitlint runs (2026-09-19): 20 of 208 commits carried
// both a non-success and a success commitlint run, and of the 22 stale non-successes 7
// overlapped their successor and 15 did not. The 15 are the ones no in-flight rule can reach.
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
// A RESTART IS NOT INSTANT, AND THE FIRST VERSION OF THIS FILE DID NOT KNOW THAT. Measured on
// the probe PR #1708, 2026-09-19 08:52:22: the POST was accepted, the read-back 312 ms later
// still said `run_attempt: 1`, and this script annotated `0 of 1 … restarted; 1 did not
// restart` — while the run was on attempt 2 moments afterwards. A false negative on a warning
// that exists to be rare is how the warning stops meaning anything, so the read-back settles
// for a bounded moment first, the same shape `cancel-superseded-runs.mjs` needed for the
// mirror-image case.
//
// NOTHING HERE MAY REDDEN A PR. This job repairs a commit whose own checks are green and is not
// a required context, so a malformed listing, a missing field or a refused POST is reported and
// the job exits 0. The exported selection still THROWS on those — that is where a defect should
// be visible — and the entry point below is the one place that turns a throw into a notice.
//
// Usage (the workflow's shape, and the way to reproduce a run by hand):
//   GH_TOKEN=… REPO=owner/repo HEAD_SHA=… GITHUB_RUN_ID=… \
//     node scripts/rerun-superseded-commitlint.mjs < runs.json
// Reads a `GET /actions/workflows/commitlint.yml/runs` response (or a bare array) from stdin.

import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
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

/**
 * How long a posted re-run is given to show up as a new attempt before it is called stuck.
 *
 * Bounded because this job holds a runner while it waits, and short because what is being
 * waited for is a field flip, not work. See A RESTART IS NOT INSTANT in the header.
 */
const SETTLE_MS = 20_000;
const POLL_MS = 4_000;

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
 *   settleMs?: number,
 *   pollMs?: number,
 *   sleep?: (ms: number) => Promise<unknown>,
 * }} input
 * @returns {Promise<{ selected: number, posted: number, refused: number, restarted: number, stuck: string[] }>}
 */
export async function rerunSupersededCommitlint({
    ids,
    api,
    log = console.log,
    settleMs = SETTLE_MS,
    pollMs = POLL_MS,
    sleep = delay,
}) {
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

    /** id → the highest attempt number this script has read back for it. */
    const attempts = new Map(accepted.map((id) => [id, 0]));
    const restartedYet = (id) => (attempts.get(id) ?? 0) > 1;

    for (let waited = 0; ; waited += pollMs) {
        for (const id of accepted) {
            if (restartedYet(id)) continue;
            const { status, body } = await call('GET', `actions/runs/${id}`);
            // An unreadable run is not a restarted run, and leaving its attempt where it is
            // keeps it out of the count rather than inventing one.
            if (status < 200 || status >= 300) continue;
            const attempt = Number(/** @type {{ run_attempt?: unknown }} */ (body)?.run_attempt);
            if (Number.isFinite(attempt)) attempts.set(id, attempt);
        }
        if (accepted.every(restartedYet)) break;
        if (waited >= settleMs) break;
        await sleep(pollMs);
    }

    let restarted = 0;
    const stuck = [];
    for (const id of accepted) {
        if (restartedYet(id)) {
            restarted += 1;
            log(`run ${id}: now on attempt ${attempts.get(id)} — its stale conclusion is off this commit`);
        } else {
            stuck.push(id);
            log(
                `run ${id}: the re-run was accepted and the run is still on attempt ` +
                    `${attempts.get(id) || '?'} ${settleMs / 1000}s later`,
            );
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
    // See NOTHING HERE MAY REDDEN A PR. Every throw under this point is a real path —
    // `required`, `instant` and the run-id check each throw on input this script does not
    // understand — and the right answer to input it does not understand is to clear nothing,
    // not to put a red X on a pull request whose own checks passed.
    let headSha = String(process.env.HEAD_SHA ?? '');
    let ids;
    try {
        const listed = JSON.parse(readFileSync(0, 'utf8'));
        const runs = Array.isArray(listed) ? listed : (listed.workflow_runs ?? []);
        headSha = required(process.env.HEAD_SHA, 'head sha');
        ids = supersededCommitlintRuns({
            runs,
            headSha,
            selfRunId: required(process.env.GITHUB_RUN_ID, 'own run id'),
        });
    } catch (error) {
        console.log(`::warning::Nothing cleared: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(0);
    }

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
