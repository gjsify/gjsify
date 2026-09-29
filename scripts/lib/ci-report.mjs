// Shared GitHub Actions failure reporting for repo-root `scripts/*.mjs`.
//
// WHY THIS EXISTS. `ci-why` (the werkstatt tool CI failures are read through,
// docs/ci-selective.md's companion) reads check-run ANNOTATIONS first and only
// falls back to a log-tail extraction when a job left none. Before this module,
// each script that wanted a CI-visible failure hand-rolled its own
// `` `::error::${msg}` `` (scripts/verify-committed-bundles.mjs) or nothing at all —
// so most of the highest-traffic failure points (the node-gi consumer harness, the
// e2e shard runner, the whole-tree `check-*.mjs` scripts) left `ci-why` nothing to
// read but a log tail, and a hand-rolled emitter never escaped `:`/`,` in a
// property value, which silently truncates or drops the field it sits in.
//
// Two functions, both NO-OPS unless `GITHUB_ACTIONS=true` — so every caller stays
// silent and side-effect-free in a local run, in a unit test, and under `node:test`
// custom reporters (which run in-process and would otherwise spam a developer's
// terminal with workflow-command syntax on every local `test:e2e`).
//
//   reportFailure({ title, file, line, message })
//     Emits one `::error …::…` workflow command — a GitHub Actions check-run
//     annotation. `file`/`line` are optional; omitting both still produces a valid
//     annotation with no source-location link.
//
//   summary(markdown)
//     Appends to `$GITHUB_STEP_SUMMARY` (the job's rendered summary page). A
//     missing/unset destination is silently skipped — the same "no such file"
//     shape a local run always has, not a distinct error to report.
//
// ESCAPING — the two workflow-command charsets are different, and confusing them
// is exactly how a title containing `,` or `:` silently drops or splits a field
// (https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions):
//   - `escapeData` (the `::error …::MESSAGE` body): `%` `\r` `\n`.
//   - `escapeProperty` (a `key=value` in the comma-joined property list, e.g.
//     `file=…` or `title=…`): the same three, PLUS `:` and `,` — both are the
//     property list's own separators, so an unescaped one in, say, a test name
//     ("describe: nested, case") corrupts every property after it.
//
// CAP — Actions renders at most ten annotations per step; `@gjsify/unit`'s own
// `formatFailureAnnotations` (packages/gjs/unit/src/index.ts) measured the same
// limit and states it when it truncates, so past the count more `reportFailure`
// calls are silently dropped rather than spending the whole page on one caller —
// each process gets its own budget, since the cap is module state and every
// `node scripts/*.mjs` invocation (and every `node --test` custom-reporter run) is
// its own process.

import { appendFileSync } from 'node:fs';

const MAX_ANNOTATIONS = 10;

let emitted = 0;

function inActions() {
    return process.env.GITHUB_ACTIONS === 'true';
}

function escapeData(value) {
    return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
    return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * One `::error …::…` annotation. No-op off `GITHUB_ACTIONS` and past the
 * per-process cap (a truncation line is printed once, at the cap, so the
 * silence never reads as "that was all of them").
 *
 * @param {{ title?: string, file?: string, line?: number|string, message: string }} params
 */
export function reportFailure({ title, file, line, message }) {
    if (!inActions()) return;
    if (emitted >= MAX_ANNOTATIONS) return;
    emitted++;

    const props = [];
    if (file) props.push(`file=${escapeProperty(file)}`);
    if (line !== undefined && line !== null && line !== '') props.push(`line=${escapeProperty(String(line))}`);
    if (title) props.push(`title=${escapeProperty(title)}`);
    const head = props.length ? ` ${props.join(',')}` : '';

    console.log(`::error${head}::${escapeData(message ?? '')}`);

    if (emitted === MAX_ANNOTATIONS) {
        console.log(
            '::error title=ci-report: annotations truncated::' +
                'further failures were suppressed after the 10-per-step cap Actions renders — see the full job log.',
        );
    }
}

/**
 * Append Markdown to the job's step summary. No-op off `GITHUB_ACTIONS`, and
 * off a run where `GITHUB_STEP_SUMMARY` is unset for any other reason (a local
 * `act` invocation, a step that does not carry it) — silently, the same shape
 * a plain local run already has, never an error a caller has to guard against.
 *
 * @param {string} markdown
 */
export function summary(markdown) {
    if (!inActions()) return;
    const path = process.env.GITHUB_STEP_SUMMARY;
    if (!path) return;
    try {
        appendFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    } catch (error) {
        // The append failing (permissions, a step that unset the var mid-job) must
        // not fail the CALLER's own check — that would turn a reporting nicety
        // into a second way to red the build. Surfaced as a warning, not silence.
        console.log(`::warning::ci-report: could not append to the step summary: ${error?.message ?? error}`);
    }
}

/**
 * Test-only: resets the per-process annotation cap between cases. Never called
 * from shipping code — the cap is deliberately GLOBAL per process, and a real
 * caller runs once per `node scripts/*.mjs` invocation or `node --test` reporter,
 * which already starts the counter at zero.
 */
export function _resetAnnotationCountForTests() {
    emitted = 0;
}
