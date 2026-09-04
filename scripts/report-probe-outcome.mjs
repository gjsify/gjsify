#!/usr/bin/env node
// Say what a `continue-on-error` step actually did.
//
// THE GAP (#1552). A `continue-on-error` step's CONCLUSION is not its RESULT.
// GitHub forces the conclusion to `success`, so the REST API, the GraphQL checks,
// `gh pr checks` and the PR page all read green while the step exited 1. Only
// `steps.<id>.outcome` records what happened, and only the log carries the
// numbers. Before this script nothing in the repository read either.
//
// THE INCIDENT. #1541, first push, run 33851595137 (`GTK OS suites`): the PR
// reported green on every gate while three probes were red — `6 of 2042` on both
// darwin legs and `8 of 2038` on win32. Six of those were the PR's own and were
// fixed; TWO of the win32 eight were not the PR's at all and had been failing
// with nobody counting them (#1556). The author found it by reading a log they
// had no reason to open.
//
// WHAT THIS DOES, and deliberately no more: it reports. The probes it reports on
// are `continue-on-error` because something below them is knowably broken and has
// a written retirement condition; turning their outcome into a job failure would
// red the branch for a defect the step already documents. So the outcome goes
// where a person actually looks — the job summary, plus a `::warning::`
// annotation, which appears on the run and the PR without changing any status.
//
// Usage: node scripts/report-probe-outcome.mjs
//   PROBE_LABEL   what ran, in a person's words
//   PROBE_OUTCOME the step's `outcome` — success | failure | cancelled | skipped
//
// Both from `env:`, never from argv: the call sites are Windows runners as often
// as POSIX ones, and an env var needs no quoting the shell can disagree about.

import { appendFileSync } from 'node:fs';

const rawLabel = process.env.PROBE_LABEL ?? '';
const outcome = (process.env.PROBE_OUTCOME ?? '').trim();

/**
 * The label, made safe to print into two formats that both read control text.
 *
 * A workflow-command line is `::name key=value::text`, and a step summary is
 * Markdown — so a label carrying a newline plus `::error …` emits a REAL
 * annotation of someone else's making, and one carrying a backtick closes the
 * code span it was meant to sit inside. Measured against this script: a
 * two-line label produced a standalone `::error title=Injected::…` on stdout.
 * The label comes from a workflow's `env:` block rather than from a stranger,
 * so this is hygiene rather than a security boundary — but a reporter that can
 * be made to report something else is not one.
 *
 * Whitespace is collapsed (a command is one line by construction), backticks and
 * colons that could open a command are escaped, and the whole thing is bounded:
 * a 4 KB label in a summary row is not a label, it is the row.
 */
const label = rawLabel
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- the point is to remove them
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/::/g, '∷')
    .replace(/`/g, "'")
    .trim()
    .slice(0, 200);

if (label === '' || outcome === '') {
    console.error(
        'report-probe-outcome: PROBE_LABEL and PROBE_OUTCOME are both required.\n' +
            '    A call site that forgets one reports nothing and exits 0, which is the shape it exists to end.\n' +
            `    Got PROBE_LABEL="${rawLabel}", PROBE_OUTCOME="${outcome}".`,
    );
    process.exit(1);
}

/** GitHub's own vocabulary for a step outcome, with what each means for a reader. */
const VERDICTS = {
    success: { icon: '✅', note: 'the probe passed' },
    failure: { icon: '❌', note: 'the probe FAILED — the job is green only because the step is continue-on-error' },
    cancelled: { icon: '⏹', note: 'the probe was cancelled' },
    skipped: { icon: '⏭', note: 'the probe did not run' },
};

const verdict = VERDICTS[outcome] ?? { icon: '❔', note: `unrecognised outcome "${outcome}"` };
const line = `${verdict.icon} **probe** \`${label}\` — ${verdict.note}`;

// The annotation is the half that travels: a job summary is one click away from
// the PR, an annotation is on it. Only for the outcome worth interrupting for —
// a warning on every green probe is how annotations stop being read.
if (outcome === 'failure') {
    console.log(`::warning title=Probe failed (not gating)::${label} exited non-zero; read the job log for the counts`);
}
console.log(line);

const summary = process.env.GITHUB_STEP_SUMMARY;
// Absent off Actions, which is where this script is also run by its own e2e.
if (summary) {
    try {
        appendFileSync(summary, `${line}\n`);
    } catch (error) {
        // NEVER FATAL. This step exists to report a result that GitHub already
        // throws away, and a reporter that fails the job it is reporting on turns
        // a probe's note into the probe's verdict — measured: an unwritable
        // `GITHUB_STEP_SUMMARY` exited 1 with a stack trace. The line is on stdout
        // either way, which is where the log reader looks.
        console.log(`::warning::could not append to the step summary: ${error?.message ?? error}`);
    }
}
