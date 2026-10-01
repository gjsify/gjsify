#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Has this push to `main` already been tested, byte for byte, by the merge queue?
 * Answers `proven=true|false` plus a reason, for `main.yml`'s heavy legs.
 *
 * WHY. Measured 2026-10-01 over the last 250 runs (~5 h of wall time): `GJS [merge_group]`
 * is the largest single block of this repository's CI, ~43 % of all job-minutes (3,032 of
 * ~7,000). In 24 h there were 52 `merge_group` runs of `main.yml` against ~10 merges to
 * `main` — so ~10 `push` runs that re-ran, on the same code, what the queue had just
 * finished running. The scarce resource is CONCURRENT SLOTS, not minutes (see *What is
 * scarce* in docs/ci-selective.md: queue = 77 % of job time, the pool pinned at exactly 20
 * for 5h05 of a 22h48 window), so a duplicate run is paid for by every PR waiting behind
 * it.
 *
 * THE CLAIM, AND WHY IT IS ABOUT THE TREE. GitHub's merge queue merges with SQUASH: the
 * queue branch's head IS the commit that lands, so the merge_group run tested the exact
 * content `main` now carries. Measured over the 33 most recent squash merges on `main`
 * (2026-09-29 → 2026-10-01), 33 of 33 had a tree-identical successful merge_group run, and
 * in every one of them the landed SHA was itself that run's `head_sha`.
 *
 * The SHA is nevertheless the wrong thing to require, in two measured ways. A retry puts
 * the same content under a second queue commit — tree `a8b9eb87` was the head of a
 * successful run under both `pr-1907-…` and `pr-1909-…` — and with the queue's HEADGREEN
 * grouping one group validates a batch, so the group head answers for the LAST squash
 * commit of that batch and not for its own PR alone. A tree is what a test run actually
 * observes, so the tree is what the claim is made on; the SHA is used only as the cheap
 * first probe, which is one API call and covers the common case.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE. A `merge_group` run turns the macOS leg OFF by
 * construction (`setup`'s `macos-reason`: a queue entry carries no labels, and the push to
 * main is what runs it), so that leg does not read this verdict. And a merge_group run is
 * SELECTIVE — it classifies against `merge_group.base_sha` — while a push to `main` is a
 * FULL sweep. So what a proven push gives up is not coverage of the change, which the
 * queue measured on this very tree; it is the backstop against the CLASSIFIER itself
 * mis-gating. The nightly schedule and `workflow_dispatch` stay full sweeps and are what
 * carries that backstop now.
 *
 * FAIL OPEN, EVERY WAY OUT. No run found, an unreachable API, a 404 on a queue commit, the
 * call budget exhausted, a crash — every one of them answers `proven=false`, which is the
 * full run this workflow has always done. The verdict may only ever be wrong towards
 * running more.
 *
 * Usage: node scripts/decide-push-scope.mjs --repo <owner/name> --sha <sha> --tree <tree>
 *          [--workflow main.yml] [--max-runs N] [--budget N]
 * Writes `proven=` and `reason=` to $GITHUB_OUTPUT (stdout without it), and a summary line.
 */

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { argv, env, exit, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * How far back the merge_group history is walked. One page, deliberately: the run that
 * proves a push is the one that just merged it, and a tree that is not in the last few
 * dozen queue runs is not a tree the queue validated recently enough to be this run's
 * reason to skip.
 */
export const DEFAULT_MAX_RUNS = 30;

/**
 * Ceiling on API calls. A walk over `--max-runs` costs one call per DISTINCT head commit,
 * so the budget is what keeps a long history from paying per run; when it trips the
 * verdict is `false` and SAYS the walk was cut short, rather than reading as "no such run".
 */
export const DEFAULT_BUDGET = 25;

/**
 * The decision.
 *
 * `api(path)` is injected rather than imported so the whole derivation is testable against
 * fixtures — `tests/e2e/ci-push-scope` drives it with the measured shapes, including the
 * batch and the retry. It must return parsed JSON, or throw.
 *
 * @param {{
 *   api: (path: string) => Promise<any>,
 *   repo: string,
 *   sha: string,
 *   tree: string,
 *   workflowFile?: string,
 *   maxRuns?: number,
 *   budget?: number,
 * }} options
 * @returns {Promise<{ proven: boolean, reason: string, stats: object }>}
 */
export async function pushScopeDecision(options) {
    const {
        api,
        repo,
        sha,
        tree,
        workflowFile = 'main.yml',
        maxRuns = DEFAULT_MAX_RUNS,
        budget = DEFAULT_BUDGET,
    } = options;

    const stats = { calls: 0, headsRead: 0, budgetExhausted: false };
    const suffix = `/${workflowFile}`;

    async function call(path) {
        if (stats.calls >= budget) {
            stats.budgetExhausted = true;
            return null;
        }
        stats.calls++;
        return api(path);
    }

    const isProof = (run) =>
        run.event === 'merge_group' &&
        run.conclusion === 'success' &&
        typeof run.path === 'string' &&
        run.path.endsWith(suffix);

    // ── 1. The same commit, which is what a squash merge normally produces ────
    const here = await call(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
    const direct = (here?.workflow_runs ?? []).find(isProof);
    if (direct) {
        return {
            proven: true,
            reason:
                `run ${direct.id} is a successful \`merge_group\` run of \`${workflowFile}\` on this ` +
                `very commit (${short(sha)}), so the tree it tested is this tree`,
            stats,
        };
    }

    // ── 2. A different commit carrying the same tree ──────────────────────────
    const history = await call(
        `repos/${repo}/actions/workflows/${workflowFile}/runs` +
            `?event=merge_group&status=success&per_page=${maxRuns}`,
    );
    if (history === null) {
        return { proven: false, reason: whyNot(stats, 'the merge_group history was not read'), stats };
    }
    const runs = history.workflow_runs ?? [];
    /** One call per distinct head commit: a retried queue entry lists the same head twice. */
    const seen = new Map();
    for (const run of runs) {
        const head = run.head_sha;
        if (typeof head !== 'string' || seen.has(head)) continue;
        let commit;
        try {
            commit = await call(`repos/${repo}/commits/${head}`);
        } catch {
            // A queue ref is deleted after the merge; the COMMIT stays reachable through
            // the run record, but a 404 here is not this script's business to explain —
            // one unreadable candidate must not end the walk.
            seen.set(head, null);
            continue;
        }
        if (commit === null) break; // budget
        const headTree = commit?.commit?.tree?.sha ?? null;
        seen.set(head, headTree);
        if (headTree !== null) stats.headsRead++;
        if (headTree === tree) {
            return {
                proven: true,
                reason:
                    `run ${run.id} (\`${run.head_branch}\`) succeeded on ${short(head)}, whose tree ` +
                    `${short(tree)} is this commit's tree — the same content, tested in the queue`,
                stats,
            };
        }
    }

    return {
        proven: false,
        reason: whyNot(
            stats,
            `no successful \`merge_group\` run of \`${workflowFile}\` carries tree ${short(tree)} ` +
                `(${seen.size} of the last ${runs.length} queue run(s) compared)`,
        ),
        stats,
    };
}

const short = (value) => (typeof value === 'string' ? value.slice(0, 10) : '<unknown>');

/**
 * A `false` that distinguishes "asked and found nothing" from "stopped asking". Collapsing
 * them is how a lookup starts reporting a budget as a fact about the repository — the same
 * distinction `report-gate-history.mjs` keeps for its own walk.
 */
function whyNot(stats, finding) {
    return stats.budgetExhausted
        ? `${finding}; the ${stats.calls}-call budget stopped the walk, so this is a LOWER bound — running everything`
        : `${finding} — running everything`;
}

/** `gh api` as the transport: the runner has it, and it already holds the token. */
function ghApi(path) {
    const r = spawnSync('gh', ['api', path], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
    return JSON.parse(r.stdout);
}

function flag(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? fallback : argv[i + 1];
}

async function main() {
    const repo = flag('repo');
    const sha = flag('sha');
    const tree = flag('tree');
    if (!repo || !sha || !tree) {
        console.error('usage: decide-push-scope.mjs --repo <owner/name> --sha <sha> --tree <tree>');
        return exit(2);
    }

    let verdict;
    try {
        verdict = await pushScopeDecision({
            api: (path) => ghApi(path),
            repo,
            sha,
            tree,
            workflowFile: flag('workflow', 'main.yml'),
            maxRuns: Number(flag('max-runs', DEFAULT_MAX_RUNS)),
            budget: Number(flag('budget', DEFAULT_BUDGET)),
        });
    } catch (error) {
        // Said out loud: "found no run" and "could not look" are the same verdict here but
        // not the same fact, and the second one means the lookup is unwatched.
        verdict = {
            proven: false,
            reason: `the lookup failed (${error.message}) — running everything`,
            stats: {},
        };
    }

    const reason = verdict.reason.replace(/\n/g, ' ');
    const lines = `proven=${verdict.proven}\nreason=${reason}\n`;
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines);
    else stdout.write(lines);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            env.GITHUB_STEP_SUMMARY,
            `### Merge-queue proof: ${verdict.proven ? 'already tested' : 'not proven'}\n\n${reason}\n`,
        );
    }
    console.log(`[push-scope] ${verdict.proven ? 'PROVEN' : 'FULL RUN'} — ${reason}`);
    return exit(0);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) await main();
