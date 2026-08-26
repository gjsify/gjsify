#!/usr/bin/env node
// When did each gate last actually MEASURE something?
//
// THE INCIDENT. A `node:test` file-level failure on `node-gi.yml`'s Windows
// batteries-included leg was chased against `main` as the baseline. `main` was green.
// The leg had not RUN on any recent `main` push: `node-gi.yml`'s `scope` job gates the
// OS legs on `packages/node-gi/**`, so on a consumer-only change they resolve to
// `skipped`, and the last run that executed that leg was two PRs earlier. A green tick
// on `main` said nothing about it, and the investigation nearly blamed the change that
// happened to be on top. `status/open-todos.md`: "a `skipped` leg is indistinguishable
// from a green one in the checks UI".
//
// WHAT THIS ANSWERS, at the two granularities that hide the same thing.
//
//   1. WORKFLOW — this commit produced no run for it at all. Already reported before
//      this script existed, as ~55 lines of inline bash in `main.yml`'s `ci-summary`.
//   2. LEG — the workflow DID run here and this job inside it resolved to `skipped`.
//      This is the half that was missing, and it is where the incident lived.
//
// One script for both because it is one question with one data source and one
// annotation policy; two readers of `repos/*/actions/runs` would be two copies of the
// same derivation, and the second copy is what drifts.
//
// NOTHING HERE IS A MAINTAINED LIST. The workflow set is the repo's own active-workflow
// list; the skipped legs are the jobs GitHub itself resolved to `skipped` in this run;
// the history is that workflow's own completed runs on the gated branch. A leg added,
// renamed or newly gated shows up the day it lands, which is the property a hand-kept
// "what we skip" table cannot have — see `ci-summary`'s header for why this repository
// refuses to keep one.
//
// IT DOES NOT GATE, deliberately. A leg being skipped is usually a cost control working
// as designed: `node-gi.yml` skips fourteen legs on a consumer-only change ON PURPOSE.
// A threshold over that would be a number nobody can justify, and the trap was never
// that the leg skipped — it was that the checks UI showed no difference. So the table
// prints unconditionally and carries the SHA, which is what the ledger asked for; the
// `::warning::` annotations follow `ci-summary`'s existing policy exactly (main pushes
// only, and only where the last thing the gate said was not `success`) because a warning
// on every skipped leg is how #906 taught people to read a red check as noise.
//
// A REPORTER THAT READS NOTHING IS THE FAILURE MODE, so the run counts are printed with
// the tables and the API budget says when it stopped early. An empty table then reads as
// "12 runs and 143 jobs examined, none stale" instead of as silence — the distinction the
// inline bash could not make, and could not be tested for either.
//
// Usage: node scripts/report-gate-history.mjs --repo <owner/name> --sha <sha> [--sha <sha>]
//                [--branch main] [--annotate] [--max-runs-back N] [--budget N]
//                [--summary-file <path>]
// Markdown goes to `--summary-file` / `$GITHUB_STEP_SUMMARY` (stderr with neither);
// annotations go to STDOUT, where GitHub reads workflow commands. Exits non-zero only on
// a usage error or an unreachable API — never on a finding.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** The branch whose history answers "when did this last run for real?". */
const DEFAULT_BRANCH = 'main';

/** How far back a leg's own history is walked before the answer becomes "not in N runs". */
const DEFAULT_MAX_RUNS_BACK = 12;

/**
 * Ceiling on API calls. A loud stop beats an unbounded walk: this runs in every
 * `ci-summary`, and a workflow with many skipped legs would otherwise pay per leg per
 * run. When it trips, the report SAYS so and the answers it did compute still stand.
 */
const DEFAULT_BUDGET = 90;

/**
 * A conclusion that means the job EXECUTED. `skipped` did not run; `cancelled` stopped
 * before it could measure; a null conclusion is a job still in flight. Everything else —
 * `success`, `failure`, `timed_out`, `neutral`, `action_required` — reached the code.
 */
const DID_NOT_EXECUTE = new Set(['skipped', 'cancelled', null, undefined]);

export const executed = (conclusion) => !DID_NOT_EXECUTE.has(conclusion);

/** `owner/name` → the workflow file's basename, which is what the runs endpoint keys on. */
const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

/**
 * A SKIPPED matrix leg does not carry the name it runs under.
 *
 * Measured 2026-08-26 against `node-gi.yml` on `main`: a skipped leg is reported as
 * `macOS build + conformance (Node+Bun+Deno / darwin-${{ matrix.arch }})` — the template
 * UNEXPANDED, because a job GitHub never planned has no matrix value to substitute —
 * while the run that executed it reports `darwin-arm64` and `darwin-x64`. Exact matching
 * therefore answered "not in the last 8 runs" about five node-gi legs that had run ONE
 * run earlier. That answer is worse than no answer: this repository's own rule is that a
 * check with false positives gets disabled and then protects nothing.
 *
 * So a templated name matches on its LITERAL fragments, anchored at both ends, which
 * cannot confuse `macOS GTK runtime bundle (…)` with `macOS windowing GTK runtime
 * bundle (…)`: the first fragment must start at index 0.
 *
 * A name with NO literal fragment at either end anchors nothing, and fuzzy is the wrong
 * failure here: `name: ${{ matrix.name }}` — one of the commonest job-name idioms there is —
 * splits into two empty fragments, and matching on what is left accepts EVERY job (measured
 * against this matcher: `legMatcher('${{ matrix.name }}').test('Lint commit messages')` was
 * true). The row would then carry whichever job the older run listed first as this leg's
 * history, SHA and conclusion included, and annotate a red one under the wrong leg's name.
 * A middle fragment is no substitute — `${{ a }}-${{ b }}` would claim every name holding a
 * dash — so such a leg is reported as not matchable, the one answer that is true.
 */
export function legMatcher(name) {
    const fragments = name.split(/\$\{\{[^}]*\}\}/);
    if (fragments.length === 1) return { templated: false, anchorable: true, test: (candidate) => candidate === name };
    if (fragments[0] === '' && fragments[fragments.length - 1] === '')
        return { templated: true, anchorable: false, test: () => false };
    return {
        templated: true,
        anchorable: true,
        test(candidate) {
            let at = 0;
            for (const [i, fragment] of fragments.entries()) {
                if (fragment === '') continue;
                const found = candidate.indexOf(fragment, at);
                if (found === -1) return false;
                if (i === 0 && found !== 0) return false;
                at = found + fragment.length;
            }
            const tail = fragments[fragments.length - 1];
            return tail === '' || candidate.endsWith(tail);
        },
    };
}

/**
 * The job a matrix FAMILY's row speaks for. A green sibling must not hide a red one — the
 * reader is asking what this gate last SAID, and "success" when one arch failed is the
 * wrong answer to that. The LINK comes from the same job as the conclusion for that reason:
 * pointing the reader at whichever member the API listed first sent them to a green log
 * under a row that says `failure`.
 */
const representative = (jobs) => jobs.find((job) => job.conclusion !== 'success') ?? jobs[0];

const shortSha = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : '<unknown>');

const dayOf = (stamp) => (typeof stamp === 'string' ? stamp.split('T')[0] : '<undated>');

/**
 * Build the report.
 *
 * `api(path)` is injected rather than imported so the whole derivation is testable
 * against fixtures — `tests/e2e/ci-gate-history` drives it with a fake API holding the
 * exact shape of the incident. It must return parsed JSON, or throw.
 *
 * @param {{
 *   api: (path: string) => Promise<any>,
 *   repo: string,
 *   shas: string[],
 *   branch?: string,
 *   maxRunsBack?: number,
 *   budget?: number,
 * }} options
 */
export async function gateHistoryReport(options) {
    const {
        api,
        repo,
        shas,
        branch = DEFAULT_BRANCH,
        maxRunsBack = DEFAULT_MAX_RUNS_BACK,
        budget = DEFAULT_BUDGET,
    } = options;

    const stats = { calls: 0, runsRead: 0, jobsRead: 0, budgetExhausted: false };
    /** Job lists are asked for repeatedly while walking back — ask the API once. */
    const jobCache = new Map();

    async function call(path) {
        if (stats.calls >= budget) {
            stats.budgetExhausted = true;
            return null;
        }
        stats.calls++;
        return api(path);
    }

    async function jobsOf(runId) {
        if (jobCache.has(runId)) return jobCache.get(runId);
        const body = await call(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
        const jobs = body?.jobs ?? null;
        jobCache.set(runId, jobs);
        if (jobs) stats.jobsRead += jobs.length;
        return jobs;
    }

    /** Completed runs of one workflow on the gated branch, newest first. */
    async function historyOf(workflowFile) {
        const body = await call(
            `repos/${repo}/actions/workflows/${workflowFile}/runs` +
                `?branch=${branch}&status=completed&per_page=${maxRunsBack}`,
        );
        const runs = body?.workflow_runs ?? [];
        stats.runsRead += runs.length;
        return runs;
    }

    const workflowsBody = await call(`repos/${repo}/actions/workflows?per_page=100`);
    if (!workflowsBody) throw new Error('could not list the repository’s workflows');
    const active = (workflowsBody.workflows ?? [])
        .filter((w) => w.state === 'active')
        .map((w) => ({ path: w.path, name: w.name }))
        .sort((a, b) => a.path.localeCompare(b.path));

    // Runs at this commit. `pull_request` records head_sha as either the merge commit or
    // the PR head depending on the triggering event, so both are queried and unioned.
    /** @type {Map<string, any>} */
    const runsHere = new Map();
    for (const sha of shas) {
        if (!sha) continue;
        const body = await call(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
        for (const run of body?.workflow_runs ?? []) {
            const previous = runsHere.get(run.path);
            if (!previous || run.id > previous.id) runsHere.set(run.path, run);
        }
    }

    // ── 1. Workflows with no run here ────────────────────────────────────────
    const missingWorkflows = [];
    for (const workflow of active) {
        if (runsHere.has(workflow.path)) continue;
        const [last] = await historyOf(basename(workflow.path));
        missingWorkflows.push(
            last
                ? {
                      ...workflow,
                      conclusion: last.conclusion,
                      day: dayOf(last.updated_at),
                      url: last.html_url,
                  }
                : { ...workflow, conclusion: null },
        );
    }

    // ── 2. Legs skipped here, and when they last executed ────────────────────
    const staleLegs = [];
    for (const [path, run] of [...runsHere.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const jobs = await jobsOf(run.id);
        if (!jobs) continue;
        const unresolved = new Map();
        for (const job of jobs) {
            if (job.conclusion === 'skipped') unresolved.set(job.name, legMatcher(job.name));
        }
        if (unresolved.size === 0) continue;

        const history = await historyOf(basename(path));
        let walked = 0;
        for (const older of history) {
            if (unresolved.size === 0) break;
            // The run in hand is not evidence about itself; on a `main` push it is still
            // in flight and the completed-runs query excludes it anyway.
            if (older.id === run.id) continue;
            walked++;
            const olderJobs = await jobsOf(older.id);
            if (!olderJobs) continue;
            // Deleting the CURRENT entry of a Map mid-iteration is well defined, so no snapshot.
            for (const [leg, matcher] of unresolved) {
                const members = olderJobs.filter((job) => matcher.test(job.name) && executed(job.conclusion));
                if (members.length === 0) continue;
                unresolved.delete(leg);
                const speaksFor = representative(members);
                staleLegs.push({
                    workflow: run.name ?? path,
                    path,
                    leg,
                    conclusion: speaksFor.conclusion,
                    members: members.length,
                    sha: older.head_sha,
                    day: dayOf(older.updated_at),
                    runsBack: walked,
                    url: speaksFor.html_url ?? older.html_url,
                });
            }
        }
        for (const [leg, matcher] of [...unresolved].sort((a, b) => a[0].localeCompare(b[0]))) {
            staleLegs.push({
                workflow: run.name ?? path,
                path,
                leg,
                conclusion: null,
                sha: null,
                members: 0,
                runsBack: walked,
                matchable: matcher.anchorable,
            });
        }
    }

    return { missingWorkflows, staleLegs, stats, branch, maxRunsBack };
}

/** The step-summary markdown. Both tables always print, empty or not — see the header. */
export function renderMarkdown(report) {
    const { missingWorkflows, staleLegs, stats, branch, maxRunsBack } = report;
    const out = [];

    out.push(`### Workflows with no run for this commit`, '');
    if (missingWorkflows.length === 0) {
        out.push(`_Every active workflow produced a run here._`, '');
    } else {
        out.push(`| Workflow | File | Last completed run on \`${branch}\` |`, '| --- | --- | --- |');
        for (const w of missingWorkflows) {
            const last = w.conclusion ? `[${w.conclusion}](${w.url}) · ${w.day}` : `never completed on \`${branch}\``;
            out.push(`| ${w.name} | \`${w.path}\` | ${last} |`);
        }
        out.push('');
    }

    out.push(`### Legs that were \`skipped\` here — and when they last executed`, '');
    if (staleLegs.length === 0) {
        out.push('_No job resolved to `skipped` in any run at this commit._', '');
    } else {
        out.push(`| Workflow | Leg | Last actually executed on \`${branch}\` |`, '| --- | --- | --- |');
        for (const leg of staleLegs) {
            const family = leg.members > 1 ? ` · ${leg.members} matrix leg(s)` : '';
            const last = leg.sha
                ? `[${leg.conclusion}](${leg.url}) · \`${shortSha(leg.sha)}\` · ${leg.day} · ` +
                  `${leg.runsBack} run(s) back${family}`
                : leg.matchable === false
                  ? '**its name is an unexpanded template with no literal fragment to anchor on — ' + 'not matchable**'
                  : leg.runsBack === 0
                    ? `**no completed run on \`${branch}\` to compare against**`
                    : `**not in the last ${leg.runsBack} completed run(s) on \`${branch}\`**`;
            out.push(`| ${leg.workflow} | ${leg.leg} | ${last} |`);
        }
        out.push('');
    }

    out.push(
        `_Derived from GitHub's own trigger and \`if:\` evaluation — no maintained list. ` +
            `Read ${stats.runsRead} run record(s) and ${stats.jobsRead} job record(s) in ` +
            `${stats.calls} API call(s), walking back at most ${maxRunsBack} completed runs per ` +
            `workflow. A \`skipped\` leg is usually a cost control firing on purpose; what it must ` +
            `not be is indistinguishable from a leg that passed._`,
    );
    if (stats.budgetExhausted) {
        out.push(
            '',
            `> **The API budget of ${stats.calls} call(s) was exhausted, so the tables above are a ` +
                'LOWER BOUND** — some legs were not walked back. Raise `--budget` or lower ' +
                '`--max-runs-back`.',
        );
    }
    out.push('');
    return out.join('\n');
}

/**
 * The annotations, under exactly the policy `ci-summary` already had: a RED baseline is
 * the reader's problem, quiet is not. A gate whose last EXECUTION was not `success` gets
 * a warning; one that is merely absent — no run here, or none inside the window — is a
 * table row and nothing more.
 *
 * Both halves are load-bearing. Warning on every skipped leg would put fourteen on every
 * `main` push from `node-gi.yml` alone, which is how #906 taught people to read a red
 * check as noise. And "absent from the window" is not automatically wrong: `main.yml`'s
 * `changes` job is deliberately skipped on `main`, so it is absent from every `main`
 * window there will ever be. Telling that apart from a gate that SHOULD have run needs a
 * maintained list of intended silences — the one artefact this job exists to do without.
 */
export function annotationsFor(report, { annotate }) {
    if (!annotate) return [];
    const lines = [];
    for (const w of report.missingWorkflows) {
        if (!w.conclusion || w.conclusion === 'success') continue;
        lines.push(
            `::warning title=${w.name} has no run here and last ${w.conclusion} on ${report.branch}::${w.url ?? ''}`,
        );
    }
    for (const leg of report.staleLegs) {
        if (!leg.conclusion || leg.conclusion === 'success') continue;
        lines.push(
            `::warning title=${leg.workflow} leg "${leg.leg}" was skipped here::` +
                `last ${leg.conclusion} at ${shortSha(leg.sha)}. ${leg.url ?? ''}`,
        );
    }
    return lines;
}

/** `gh api` as the transport: the runner has it, and it already holds the token. */
function ghApi(path) {
    const r = spawnSync('gh', ['api', path], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
    return JSON.parse(r.stdout);
}

function flag(args, name, fallback) {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
}

async function main() {
    const args = process.argv.slice(2);
    const repo = flag(args, 'repo');
    if (!repo) {
        console.error('report-gate-history: --repo <owner/name> is required.');
        return process.exit(2);
    }
    const shas = args.reduce((acc, arg, i) => (arg === '--sha' && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
    if (shas.length === 0) {
        console.error('report-gate-history: at least one --sha <sha> is required.');
        return process.exit(2);
    }

    // Annotations are workflow COMMANDS: GitHub reads them off stdout, so the markdown
    // cannot share it. Same split the inline bash this replaced had to make.
    const summaryFile = flag(args, 'summary-file', process.env.GITHUB_STEP_SUMMARY);
    const emitMarkdown = (text) => (summaryFile ? appendFileSync(summaryFile, text) : process.stderr.write(text));

    let report;
    try {
        report = await gateHistoryReport({
            api: (path) => ghApi(path),
            repo,
            shas,
            branch: flag(args, 'branch', DEFAULT_BRANCH),
            maxRunsBack: Number(flag(args, 'max-runs-back', DEFAULT_MAX_RUNS_BACK)),
            budget: Number(flag(args, 'budget', DEFAULT_BUDGET)),
        });
    } catch (error) {
        // Said out loud, because "no tables" and "no permission to read them" look
        // identical in a step summary — and the second one means the gate is unwatched.
        emitMarkdown(
            `> Gate history unavailable: ${error.message}. ` +
                'Is `actions: read` granted to this job? — no coverage reported.\n',
        );
        return process.exit(1);
    }

    emitMarkdown(renderMarkdown(report));
    for (const line of annotationsFor(report, { annotate: args.includes('--annotate') })) {
        console.log(line);
    }
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('report-gate-history.mjs')) await main();
