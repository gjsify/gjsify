#!/usr/bin/env node
// Whether this commitlint run's verdict is about the pull request AS IT IS NOW — the last
// step of `.github/workflows/commitlint.yml`, and the reason an edited-away body state no
// longer leaves a red on the commit.
//
// THE MEASUREMENT (2026-09-19). `commitlint.yml` triggers on `edited`, so every edit of a
// PR description starts another run ON THE SAME COMMIT. #1704 ended with four runs on
// 4db0edf92e, all four created inside fifteen seconds: three FAILURE from body states that
// no longer existed and one SUCCESS from the current one. #1703 did the same an hour
// earlier, and the second one cost a diagnosis of a failure that was already gone.
//
// WHY THE OLD ONES DO NOT AGE OUT. A check run is attached to the SHA, and the rollup takes
// the WORST entry per context rather than the latest — measured on fc14d85a99, where
// `Lint commit messages` has two SUCCESS and one FAILURE and `statusCheckRollup.state` is
// FAILURE. That context is one of the three that block a merge here (AGENTS.md), so the PR
// stays BLOCKED on a verdict about a string nobody can read any more, and the only exit was
// re-running the stale runs by hand.
//
// WHY NOT CANCEL THE OLDER RUN — the cure that is not one. Measured on 934319ead0: a commit
// whose only `Lint commit messages` entries are CANCELLED rolls up FAILURE just the same.
// Cancelling trades one non-success conclusion for another, so neither a `concurrency` group
// on this workflow nor an `edited` window in `cancel-pr-runs.yml` removes the red; it renames
// it. What is needed is a conclusion the rollup ACCEPTS, which means the superseded run has to
// end green and say why.
//
// SO: THE VERDICT IS A FUNCTION OF THE CURRENT TEXT, NOT OF THE PAYLOAD THIS RUN WOKE UP WITH.
// Every check step runs under `continue-on-error`, and this step decides the job. It re-reads
// the PR's title and body from the API and compares them with what the steps examined:
//
//   they are the same    → this run examined the current state; its verdict stands
//   they have moved      → this run examined a state that no longer exists. Exit 0 and name
//                          the run that will decide instead of leaving a red behind
//
// That also answers "which run wins a race", which is the question a supersede by cancellation
// gets wrong: the winner is not the newest to START, it is the one whose examined text still
// equals the current text — and if two runs both satisfy that, they examined the same strings
// and must agree.
//
// FAIL CLOSED. The dangerous direction here is not a stale red, it is a check that voids
// itself on every run and reports green having read nothing. So: a `pull_request` run with no
// readable current state THROWS rather than voiding, an outcome word this file does not know
// counts as a failure, and the only normalisation applied is CRLF → LF (GitHub stores what the
// web editor posts, and the same body can reach a run through two fields with different line
// endings; anything more aggressive would start voiding real differences).
//
// Usage (the workflow's shape, and the way to reproduce a decision by hand):
//   COMMITLINT_EVENT=pull_request COMMITLINT_CURRENT_PR=pr-now.json \
//   COMMITLINT_EXAMINED_TITLE=… COMMITLINT_EXAMINED_BODY=… \
//   COMMITLINT_OUTCOMES='{"commits":"success",…}' node scripts/decide-commitlint-verdict.mjs

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Step outcomes that are not a finding.
 *
 * Enumerated rather than `!== 'failure'`: a step that was `cancelled` examined nothing, and
 * an outcome word GitHub adds later would otherwise be read as a pass by default. The one
 * silent failure this file must never produce is a green verdict over an unread check.
 */
const PASSING_OUTCOMES = new Set(['success', 'skipped']);

/** Text as the comparison sees it: absent is empty, and CRLF is LF. */
function normalise(value) {
    return String(value ?? '').replaceAll('\r\n', '\n');
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
 * This run's state: whether its verdict describes the PR as it is now, and what it found.
 *
 * `current` is required on a `pull_request` — see FAIL CLOSED in the header. On a `push` there
 * is no pull request to have moved, so the outcomes alone decide.
 *
 * @param {{
 *   event: string,
 *   examined: { title?: unknown, body?: unknown },
 *   current: { title?: unknown, body?: unknown } | null,
 *   outcomes: Record<string, string>,
 * }} input
 * @returns {{ state: 'current-pass' | 'current-fail' | 'superseded', failed: string[], moved: string | null }}
 */
export function decideCommitlintVerdict({ event, examined, current, outcomes }) {
    const failed = Object.entries(outcomes ?? {})
        .filter(([, outcome]) => !PASSING_OUTCOMES.has(outcome))
        .map(([step]) => step)
        .sort();

    if (event !== 'pull_request') {
        return { state: failed.length > 0 ? 'current-fail' : 'current-pass', failed, moved: null };
    }

    if (current === null || current === undefined || typeof current.title !== 'string') {
        throw new Error(
            'decide-commitlint-verdict: the pull request as it is NOW could not be read, so nothing here can ' +
                'tell a stale verdict from a live one. Failing rather than passing a check that read nothing.',
        );
    }

    const moved = whatMoved(examined, current);
    if (moved !== null) return { state: 'superseded', failed, moved };
    return { state: failed.length > 0 ? 'current-fail' : 'current-pass', failed, moved: null };
}

function required(value, what) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`decide-commitlint-verdict: no ${what}, so no verdict can be decided.`);
    }
    return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const event = required(process.env.COMMITLINT_EVENT, 'event name');
    const currentPath = process.env.COMMITLINT_CURRENT_PR;
    const current = currentPath ? JSON.parse(readFileSync(currentPath, 'utf8')) : null;

    const { state, failed, moved } = decideCommitlintVerdict({
        event,
        examined: {
            title: process.env.COMMITLINT_EXAMINED_TITLE,
            body: process.env.COMMITLINT_EXAMINED_BODY,
        },
        current,
        outcomes: JSON.parse(required(process.env.COMMITLINT_OUTCOMES, 'step outcomes')),
    });

    // The second job reads this to decide whether there is a live green verdict worth
    // clearing stale runs against. A state nobody can read is a repair that never runs.
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);

    if (state === 'superseded') {
        // WHAT WAS FOUND IS STILL PRINTED. A voided run that says only "superseded" hides
        // whether the text it examined was also broken, which is the sentence somebody reads
        // when the successor is red for what looks like a different reason.
        const found = failed.length > 0 ? `It had found: ${failed.join(', ')}. ` : 'It had found nothing. ';
        console.log(
            `::notice::This run examined a PR ${moved} that has since been edited, so its verdict describes a ` +
                `state that no longer exists. ${found}The run started by that edit decides this commit.`,
        );
        process.exit(0);
    }

    if (state === 'current-fail') {
        console.log(`::error::${failed.join(', ')} failed against the PR as it is now.`);
        process.exit(1);
    }

    console.log('::notice::Checked the PR as it is now, and it passes.');
}
