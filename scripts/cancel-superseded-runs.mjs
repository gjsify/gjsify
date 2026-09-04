#!/usr/bin/env node
// Stopping the runs `select-superseded-runs.mjs` selected — and checking that they
// stopped.
//
// WHY THIS IS A SECOND FILE. The selection was lifted out of `cancel-pr-runs.yml`
// because it decides what to cancel. This is lifted out for the opposite half of the
// same sentence: the workflow's `run:` block posted a cancel, counted its own POSTs
// and called them cancellations. Both halves now sit under
// `tests/e2e/ci-cancel-superseded-runs`, where "the cancel was posted" and "the run
// stopped" can be told apart — which is exactly the distinction that was invisible
// when it mattered.
//
// THE MEASUREMENT (#1548, 2026-09-04). Five PRs open, the runner pool saturated.
//
//   run 33857585236  GJS  fix/overlay-on-absolute-animated       created 09:17:14Z
//   run 33857738939  GJS  fix/one-header-bar-per-routed-window   created 09:19:07Z
//
// Both were correctly selected and both cancel jobs said so — cancel run 33857795159
// finished 09:20:29Z, cancel run 33858431251 finished 09:27:47Z, each naming its runs
// and emitting `::notice::cancelled N run(s)`. At 09:35 the API still reported both
// `status=queued conclusion=null`. A human then ran `gh run cancel` on both — the
// documented escape hatch, and the SAME endpoint — accepted, and both stayed queued.
// `POST /actions/runs/{id}/force-cancel` ended both: their run records now read
// `completed/cancelled` with `updated_at` 09:36:53Z and 09:36:52Z, i.e. 16m24s and
// 9m05s after a cancel had been posted and reported as done.
//
// WHY `queued` IS THE DISCRIMINATOR AND NOT A CLOCK. A graceful cancel marks intent
// and waits for the job to acknowledge it. A run whose jobs have never been assigned
// a runner has nothing to deliver that intent TO, so it never acknowledges and keeps
// its concurrency group — which is precisely the saturated-queue deadlock this
// workflow exists to break, and the only case it is for. So:
//
//   completed after the settle  → the ordinary cancel worked; nothing more to do
//   queued after the settle     → no job ever started, so nothing can acknowledge and
//                                 nothing is unwinding: force-cancel it
//   in_progress after settle    → it HAS a runner, so it received the cancel and is
//                                 running its `always()` cleanup. Force-cancel bypasses
//                                 conditions and that cleanup, so this reports it and
//                                 leaves it alone
//
// Not claimed as GitHub's documented contract — only as what was measured twice here,
// and as the reading that keeps the ordinary cancel's promise for every run that can
// keep it.
//
// Usage (the workflow's shape, and the way to reproduce a run by hand):
//   GH_TOKEN=… REPO=owner/repo GITHUB_EVENT_PATH=event.json \
//     node scripts/cancel-superseded-runs.mjs <<<"$ids"
// Reads one run id per line from stdin.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * How long the ordinary cancel is given before a still-queued run is force-cancelled.
 *
 * Short on purpose. This job's whole value is freeing a runner NOW — the run it is
 * unblocking cannot start until the stale one lets go of the concurrency group — so
 * waiting is a cost paid against the thing being bought. It is not zero because a
 * queued run that CAN be cancelled gracefully should be: the settle is what keeps the
 * two endpoints' promises distinct rather than replacing one with the other.
 */
const SETTLE_MS = 20_000;
const POLL_MS = 4_000;

/** A run id's terminal state — the only one that releases its concurrency group. */
const COMPLETED = 'completed';

/**
 * Post the cancels, wait a bounded moment, force-cancel whatever never started, and
 * report what actually STOPPED.
 *
 * @param {{
 *   ids: (string|number)[],
 *   api: (method: string, path: string) => Promise<{ status: number, body: unknown }>,
 *   log?: (line: string) => void,
 *   settleMs?: number,
 *   pollMs?: number,
 *   sleep?: (ms: number) => Promise<unknown>,
 * }} input
 * @returns {Promise<{ selected: number, posted: number, refused: number, stopped: number, forced: number, running: number[] }>}
 */
export async function cancelSupersededRuns({
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

    for (const id of selected) {
        // A run that finished between the listing and this POST answers 409, and a
        // read-only token on a fork PR answers 403. Neither is a reason to fail the
        // job — but neither is a cancellation, so they are counted apart.
        const { status } = await api('POST', `actions/runs/${id}/cancel`);
        if (status >= 200 && status < 300) {
            posted += 1;
            log(`run ${id}: cancel posted`);
        } else {
            refused += 1;
            log(`run ${id}: cancel refused with ${status} (already finishing, or a read-only token on a fork PR)`);
        }
    }

    /** @type {Map<string, string>} id → the last status this script read for it */
    const state = new Map(selected.map((id) => [id, 'unknown']));

    const readAll = async () => {
        for (const id of selected) {
            if (state.get(id) === COMPLETED) continue;
            const { status, body } = await api('GET', `actions/runs/${id}`);
            // An unreadable run is not a stopped run. Leaving it `unknown` keeps it out
            // of the stopped count and out of the force-cancel set, which is the safe
            // direction in both: the notice under-claims rather than inventing a
            // cancellation, and nothing is force-cancelled on a status nobody read.
            if (status < 200 || status >= 300) continue;
            const runStatus = /** @type {{ status?: unknown }} */ (body)?.status;
            if (typeof runStatus === 'string') state.set(id, runStatus);
        }
    };

    for (let waited = 0; ; waited += pollMs) {
        await readAll();
        if (selected.every((id) => state.get(id) === COMPLETED)) break;
        if (waited >= settleMs) break;
        await sleep(pollMs);
    }

    // FORCE-CANCELLED ONLY WHERE NOTHING CAN ACKNOWLEDGE — see the header. An
    // `in_progress` run has a runner and is unwinding; taking that away is a
    // different promise than the one this workflow makes.
    let forced = 0;
    for (const id of selected) {
        if (state.get(id) !== 'queued') continue;
        const { status } = await api('POST', `actions/runs/${id}/force-cancel`);
        if (status >= 200 && status < 300) {
            forced += 1;
            log(
                `run ${id}: still queued ${settleMs / 1000}s after the cancel — force-cancelled. No job was ever ` +
                    'assigned a runner, so there was nothing to deliver the cancellation to.',
            );
        } else {
            log(`run ${id}: force-cancel refused with ${status}`);
        }
    }
    if (forced > 0) await readAll();

    const stopped = selected.filter((id) => state.get(id) === COMPLETED);
    const running = selected.filter((id) => state.get(id) !== COMPLETED);
    for (const id of running) log(`run ${id}: still ${state.get(id)} — the cancel was accepted and has not taken yet`);

    return { selected: selected.length, posted, refused, stopped: stopped.length, forced, running };
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
        // Read the body only where a body is the point. A cancel POST answers 202 with
        // an empty object; a failed one answers JSON nobody here reads.
        const body = method === 'GET' ? await response.json().catch(() => undefined) : undefined;
        return { status: response.status, body };
    };
}

function required(value, what) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`cancel-superseded-runs: no ${what}, so nothing can be cancelled.`);
    }
    return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const ids = readFileSync(0, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');

    // The event is read here rather than interpolated into the shell for the same
    // reason the branch name is: `${{ … }}` substitution puts PR-controlled text into
    // program source, and this line only ever needed the action and the number.
    const event = JSON.parse(readFileSync(required(process.env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH'), 'utf8'));
    const where = `${event.action ?? 'this event'} on PR #${event.pull_request?.number ?? '?'}`;

    if (ids.length === 0) {
        console.log(`No superseded runs for ${where} — nothing to cancel.`);
        process.exit(0);
    }

    const result = await cancelSupersededRuns({
        ids,
        api: githubApi(required(process.env.REPO, 'REPO'), required(process.env.GH_TOKEN, 'GH_TOKEN')),
    });

    // THE COUNT IS OF RUNS THAT STOPPED, not of requests that were accepted. The old
    // notice said `cancelled 4 run(s)` about four POSTs while four runs kept their
    // concurrency groups — accurate about the requests and wrong about the world, and
    // counting the right thing is what would have surfaced #1548 the first time.
    const forced = result.forced > 0 ? `, ${result.forced} of them by force-cancel` : '';
    const left =
        result.running.length > 0 ? `; ${result.running.length} did not stop: ${result.running.join(', ')}` : '';
    console.log(
        `::notice::${result.stopped} of ${result.selected} run(s) superseded by ${where} stopped${forced}${left}.`,
    );
}
