#!/usr/bin/env node
// Whether this commitlint run's verdict is about the pull request AS IT IS NOW — the last
// step of `.github/workflows/commitlint.yml`, and the reason an edited-away body state no
// longer owns the commit's required context.
//
// THE MECHANISM, measured 2026-09-19 and not what it first looked like. `commitlint.yml`
// triggers on `edited`, so every edit of a PR description starts another run ON THE SAME
// COMMIT, each carrying the description as its own event delivered it. The rollup then keeps
// the LATEST check run per context — not the worst:
//
//   acca841ff1  Lint commit messages = FAILURE, FAILURE, SUCCESS, SUCCESS; no other context
//               non-success; rollup SUCCESS. Two older failures of a REQUIRED context do not
//               poison it.
//   c0629ff7    FAILURE then SUCCESS, and #1667 MERGED on it. Latest-wins governs merging,
//               not only the display.
//
// So the defect is not that a stale red lingers, it is that WHICH run reports last is decided
// by when a runner picked the job up, and that has nothing to do with which edit is current:
//
//   fc14d85a99  three runs created 06:02:32 / :38 / :46; their check runs STARTED 06:05:19,
//               06:06:54, 06:06:56. The run created SECOND started LAST, so a superseded body
//               state is the newest entry and the commit is red.
//   4db0edf92e  (#1704) SUCCESS at 06:49, then three FAILURE at 07:13, 07:14 and 07:22 — the
//               hand re-runs, which replay the same superseded payload and therefore fail
//               again. That PR is BLOCKED as this is written. Re-running by hand does not
//               repair this; it reproduces it.
//
// SO THE VERDICT IS A FUNCTION OF THE CURRENT TEXT, NOT OF THE PAYLOAD THIS RUN WOKE UP WITH.
// Every check step runs under `continue-on-error` and this step decides the job. It re-reads
// the PR's title and body from the API and compares them with what the steps examined:
//
//   they are the same    → this run examined the current state; its verdict stands
//   they have moved      → this run examined a state that no longer exists. Exit 0 naming the
//                          run that will decide instead
//
// That makes report ORDER irrelevant, which is the property no supersede-by-cancellation can
// buy: whichever run reports last, every run that reports at all judged the same strings.
//
// AND THE VOID REQUIRES A WITNESS. "The run started by that edit decides this commit" is an
// assumption until something checks it, and it is false for an edit that starts no run — one
// authored with `GITHUB_TOKEN`. No workflow here holds `pull-requests: write` today, so it is
// latent; it is also SILENT, because the commit would go green with the current description
// judged by nobody. {@link successorExists} is the check: without a later run on this commit
// the void is refused, this run's own findings stand, and the job says so at warning level
// rather than passing quietly.
//
// FAIL CLOSED, twice over. The dangerous direction is not a stale red, it is a check that
// reports green having judged nothing. So: a `pull_request` run with no readable current state
// or no readable run list THROWS rather than voiding; an outcome word this file does not know
// counts as a finding; a step that was SKIPPED where the event says it should have RUN counts
// as a finding (a failed checkout skips every check below it, and "skipped" must not read as
// "fine"); and the only normalisation is CRLF → LF, because anything more aggressive would
// start voiding real differences.
//
// Usage (the workflow's shape, and the way to reproduce a decision by hand):
//   COMMITLINT_EVENT=pull_request COMMITLINT_CURRENT_PR=pr-now.json COMMITLINT_RUNS=runs.json \
//   HEAD_SHA=… GITHUB_RUN_ID=… COMMITLINT_EXAMINED_TITLE=… COMMITLINT_EXAMINED_BODY=… \
//   COMMITLINT_OUTCOMES='{"commits":"success",…}' node scripts/decide-commitlint-verdict.mjs

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Steps that exist only on a `pull_request`, where `skipped` is the expected outcome on a
 * `push` and a finding anywhere else.
 *
 * The list is here rather than derived from the workflow because it is the ASSUMPTION being
 * pinned: a step that stops running — because a step above it died, or because someone moved
 * its `if:` — must reach the verdict as a gap, not as a pass.
 */
const PULL_REQUEST_ONLY = new Set(['title-form', 'title-subject', 'body-lines', 'closing-keywords']);

/** Text as the comparison sees it: absent is empty, and CRLF is LF. */
function normalise(value) {
    return String(value ?? '').replaceAll('\r\n', '\n');
}

/**
 * What this run found, counting a check that did not run as something found.
 *
 * `skipped` is a pass ONLY where the event explains it. Treating it as a pass everywhere was
 * safe only because a failed checkout also fails the job — one step restructuring away from a
 * green check over nothing, and nothing pinned it.
 *
 * @param {{ event: string, outcomes: Record<string, string> }} input
 * @returns {string[]}
 */
export function findingsFrom({ event, outcomes }) {
    return Object.entries(outcomes ?? {})
        .flatMap(([step, outcome]) => {
            if (outcome === 'success') return [];
            if (outcome === 'skipped') {
                return event !== 'pull_request' && PULL_REQUEST_ONLY.has(step) ? [] : [`${step} (did not run)`];
            }
            return [step];
        })
        .sort();
}

/**
 * Whether the strings this run examined are still the strings the PR carries.
 *
 * @param {{ title?: unknown, body?: unknown }} examined
 * @param {{ title?: unknown, body?: unknown }} current
 * @returns {null | 'title' | 'body' | 'title and body'}
 */
export function whatMoved(examined, current) {
    const moved = [];
    if (normalise(examined.title) !== normalise(current.title)) moved.push('title');
    if (normalise(examined.body) !== normalise(current.body)) moved.push('body');
    return moved.length === 0 ? null : moved.join(' and ');
}

/**
 * Whether a later commitlint run exists on this commit — the witness the void needs.
 *
 * Returns `null` when this run is not in the listing: without our own position there is no
 * ordering, and the safe reading of "I cannot tell" is "do not void".
 *
 * ORDERED BY `created_at`, WITH THE RUN ID AS THE TIE-BREAK, because these timestamps carry one
 * second and a burst of edits does not. #1704 created four runs inside fifteen seconds, two of
 * them in the same second (06:24:00), and their ids rise in creation order —
 * 35426493454 < 35426493503 < 35426501626 < 35426505343. Without the tie-break the earlier of a
 * pair sees no successor, refuses to void, and the class comes back for exactly the burst this
 * exists for.
 *
 * @param {{ runs: Array<Record<string, any>>, headSha: string, selfRunId: string | number }} input
 * @returns {boolean | null}
 */
export function successorExists({ runs, headSha, selfRunId }) {
    const self = Number(selfRunId);
    if (!Number.isInteger(self)) return null;
    const me = (runs ?? []).find((run) => Number(run.id) === self);
    if (me === undefined) return null;
    const mine = Date.parse(me.created_at);
    if (Number.isNaN(mine)) return null;

    return (runs ?? []).some((run) => {
        if (run.head_sha !== headSha || Number(run.id) === self) return false;
        const theirs = Date.parse(run.created_at);
        if (Number.isNaN(theirs)) return false;
        return theirs > mine || (theirs === mine && Number(run.id) > self);
    });
}

/**
 * This run's state: whether its verdict describes the PR as it is now, and what it found.
 *
 * `current` is required on a `pull_request` — see FAIL CLOSED in the header — and `successor`
 * must be `true` before anything is voided. On a `push` there is no pull request to have
 * moved, so the findings alone decide.
 *
 * @param {{
 *   event: string,
 *   examined: { title?: unknown, body?: unknown },
 *   current: { title?: unknown, body?: unknown } | null,
 *   outcomes: Record<string, string>,
 *   successor?: boolean | null,
 * }} input
 * @returns {{
 *   state: 'current-pass' | 'current-fail' | 'superseded' | 'moved-no-successor',
 *   failed: string[],
 *   moved: string | null,
 * }}
 */
export function decideCommitlintVerdict({ event, examined, current, outcomes, successor = null }) {
    const failed = findingsFrom({ event, outcomes });
    const settled = () => (failed.length > 0 ? 'current-fail' : 'current-pass');

    if (event !== 'pull_request') return { state: settled(), failed, moved: null };

    if (current === null || current === undefined || typeof current.title !== 'string') {
        throw new Error(
            'decide-commitlint-verdict: the pull request as it is NOW could not be read, so nothing here can ' +
                'tell a stale verdict from a live one. Failing rather than passing a check that read nothing.',
        );
    }

    const moved = whatMoved(examined, current);
    if (moved === null) return { state: settled(), failed, moved: null };
    // The text moved, so this run's findings are about a state nobody can read any more — but
    // discarding them is only safe if something else will judge the state that replaced it.
    if (successor !== true) return { state: 'moved-no-successor', failed, moved };
    return { state: 'superseded', failed, moved };
}

function required(value, what) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`decide-commitlint-verdict: no ${what}, so no verdict can be decided.`);
    }
    return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const event = required(process.env.COMMITLINT_EVENT, 'event name');
    const isPr = event === 'pull_request';
    const current = isPr
        ? JSON.parse(readFileSync(required(process.env.COMMITLINT_CURRENT_PR, 'current pull request'), 'utf8'))
        : null;

    let successor = null;
    if (isPr) {
        const listed = JSON.parse(readFileSync(required(process.env.COMMITLINT_RUNS, "this commit's runs"), 'utf8'));
        successor = successorExists({
            runs: Array.isArray(listed) ? listed : (listed.workflow_runs ?? []),
            headSha: required(process.env.HEAD_SHA, 'head sha'),
            selfRunId: required(process.env.GITHUB_RUN_ID, 'own run id'),
        });
    }

    const { state, failed, moved } = decideCommitlintVerdict({
        event,
        examined: {
            title: process.env.COMMITLINT_EXAMINED_TITLE,
            body: process.env.COMMITLINT_EXAMINED_BODY,
        },
        current,
        outcomes: JSON.parse(required(process.env.COMMITLINT_OUTCOMES, 'step outcomes')),
        successor,
    });

    // The repair job reads this to decide whether there is a live green verdict worth clearing
    // stale runs against. A state nobody can read is a repair that never runs.
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);

    // WHAT WAS FOUND IS ALWAYS PRINTED. A voided run that says only "superseded" hides whether
    // the text it examined was also broken, which is the sentence somebody reads when the
    // successor is red for what looks like a different reason.
    const found = failed.length > 0 ? `It had found: ${failed.join(', ')}. ` : 'It had found nothing. ';

    if (state === 'superseded') {
        console.log(
            `::notice::This run examined a PR ${moved} that has since been edited, so its verdict describes a ` +
                `state that no longer exists. ${found}The run started by that edit decides this commit.`,
        );
        process.exit(0);
    }

    if (state === 'moved-no-successor') {
        // NOT SILENT, and not a void. Reaching this means the description changed without
        // starting a run, so nothing is going to judge what it changed to.
        console.log(
            `::warning::The PR ${moved} changed while this run was working, but no later commitlint run exists ` +
                `on this commit — so nothing has judged the description as it now stands. ${found}This run's own ` +
                'verdict stands, over text that is no longer current. Re-run this job, or edit the description ' +
                'again, to get a verdict on what is there now.',
        );
    }

    if (failed.length > 0) {
        console.log(`::error::Against the PR as it is now — ${failed.join(', ')}.`);
        process.exit(1);
    }

    if (state !== 'moved-no-successor') console.log('::notice::Checked the PR as it is now, and it passes.');
}
