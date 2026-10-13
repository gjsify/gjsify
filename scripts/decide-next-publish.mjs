#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Is tonight's `next` sweep worth running, and is it safe to run right now?
 * Answers `publish=true|false` plus a reason, for `release.yml`'s `publish-next` job.
 *
 * WHY THERE IS A DECISION AT ALL. The channel used to fire on every green `GJS` run on
 * `main` (`workflow_run`), which made the trigger itself the filter: a merge happened, so
 * something changed, so publish. A nightly `schedule` has no such luck — it fires whether
 * or not anybody merged anything, on a commit whose CI it has not looked at, and at an
 * hour that a release cut can perfectly well also occupy. Those are three separate
 * questions, and this script is the only place they are asked.
 *
 *   1. IS THERE ANYTHING NEW? Skip when `main`'s HEAD is already the commit the live
 *      `next` was built from. The published version document carries it: `--source-sha`
 *      writes `gitHead` into every manifest, `gjsify pack` keeps it, and `gjsify publish`
 *      builds the version document from the tarball's manifest. So the registry answers
 *      "which commit is `next`?" with no second ledger to keep in sync.
 *   2. DID main's CI ACCEPT THAT COMMIT? The `workflow_run` trigger got this for free;
 *      here it is a run-record lookup. `next` carrying code `main.yml` went red on is the
 *      one thing the old trigger structurally could not do, and must stay impossible.
 *   3. IS A RELEASE HAPPENING? `publish-next` lives in `release.yml` and so shares its
 *      Trusted Publishers — but a release sweep and a 218-package `next` sweep hitting
 *      the registry together is a collision nobody needs. A release always wins: `next`
 *      skips and runs tomorrow, which costs a day of channel freshness and nothing else.
 *
 * WHICH WAY EACH UNKNOWN FAILS, and why they do not all fail the same way. Two of these
 * questions are "may I?" and one is "need I?".
 *
 *   · An unreadable RUN HISTORY (2, 3) answers `publish=false`. Not knowing whether CI
 *     passed, or whether a release is in flight, is not permission; and the cost of a
 *     wrong `false` is bounded at one day, because the schedule fires again.
 *   · An unreadable REGISTRY (1) answers `publish=true`. The question it settles is
 *     whether the work is redundant, and a channel that cannot prove it is fresh must
 *     assume it is stale. A wrong `true` costs ~35 min of runner time and a version
 *     number; a wrong `false` here would freeze the channel for the whole outage.
 *
 * `--force` (the `workflow_dispatch` path) answers (1) and (2) by fiat: a human asking for
 * a next build on an unchanged or red tree is the urgent case the nightly cadence exists
 * to be rescued from. It does NOT override (3) — nothing manual is urgent enough to
 * publish into the middle of a release.
 *
 * Usage: node scripts/decide-next-publish.mjs --repo <owner/name> --sha <sha>
 *          [--force] [--run-id <id>] [--package @gjsify/cli] [--ci-workflow main.yml]
 *          [--release-workflow release.yml]
 * `NEXT_FORCE=true` is `--force` by environment, which is how the workflow passes it: an
 * `${{ … && '--force' || '' }}` argument would be an unquoted expansion in the step body,
 * and `check-workflow-inline-scripts.mjs` is right to object to those.
 * Writes `publish=`, `reason=` and `published-sha=` to $GITHUB_OUTPUT (stdout without it).
 */

import { appendFileSync } from 'node:fs';
import { argv, env, exit, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

/** The package whose published `gitHead` stands for the whole sweep's. */
export const DEFAULT_PROBE_PACKAGE = '@gjsify/cli';

/**
 * How many recent `release.yml` runs are examined for an unfinished one. A release sweep
 * is the newest thing in that history by construction — if an in-flight run is not in the
 * last handful of rows, the row ordering is broken, not the release.
 */
export const DEFAULT_RELEASE_RUNS = 20;

/** Run statuses that are not `completed`. GitHub spells "not finished" six ways. */
const UNFINISHED = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending', 'action_required']);

/**
 * Events that mean a run of `release.yml` is doing RELEASE work. A `schedule` run of the
 * same file is this channel itself — the current run is one — and must not be read as a
 * release to stand aside for, or the channel would stand aside for itself forever.
 */
const RELEASE_EVENTS = new Set(['release', 'workflow_dispatch']);

/**
 * The decision.
 *
 * `api(path)` and `packument(name)` are injected rather than imported, so every branch is
 * testable against the shapes GitHub and npm actually return — `tests/e2e/ci-next-publish`
 * drives both. `api` must return parsed JSON or throw; `packument` must return the parsed
 * document or throw.
 *
 * @param {{
 *   api: (path: string) => Promise<any>,
 *   packument: (name: string) => Promise<any>,
 *   repo: string,
 *   sha: string,
 *   force?: boolean,
 *   runId?: string,
 *   probePackage?: string,
 *   ciWorkflow?: string,
 *   releaseWorkflow?: string,
 *   releaseRuns?: number,
 * }} options
 * @returns {Promise<{ publish: boolean, reason: string, publishedSha: string | null }>}
 */
export async function nextPublishDecision(options) {
    const {
        api,
        packument,
        repo,
        sha,
        force = false,
        runId = '',
        probePackage = DEFAULT_PROBE_PACKAGE,
        ciWorkflow = 'main.yml',
        releaseWorkflow = 'release.yml',
        releaseRuns = DEFAULT_RELEASE_RUNS,
    } = options;

    // ── 3 first, because it is the only guard `--force` cannot talk past ──────
    const release = await releaseInFlight({ api, repo, releaseWorkflow, releaseRuns, runId });
    if (release.blocked) {
        return { publish: false, reason: release.reason, publishedSha: null };
    }

    // ── 1. Is main's HEAD already what `next` was built from? ─────────────────
    const live = await livePublishedSha({ packument, probePackage });
    if (!force && live.sha !== null && live.sha === sha) {
        return {
            publish: false,
            reason:
                `dist-tag \`next\` is ${live.version}, built from ${short(sha)} — which is the commit ` +
                `\`main\` is on. Nothing has been merged since; the channel is already current`,
            publishedSha: live.sha,
        };
    }

    // ── 2. Did main's own CI accept this commit? ──────────────────────────────
    if (!force) {
        const ci = await ciVerdict({ api, repo, sha, ciWorkflow });
        if (!ci.green) {
            return { publish: false, reason: ci.reason, publishedSha: live.sha };
        }
        return {
            publish: true,
            reason: `${was(live)}; ${ci.reason}`,
            publishedSha: live.sha,
        };
    }

    return {
        publish: true,
        reason:
            `\`--force\`: a manual dispatch publishes ${short(sha)} whether or not it is new and ` +
            `whether or not \`${ciWorkflow}\` passed on it (${was(live)}). ${release.reason}`,
        publishedSha: live.sha,
    };
}

/** How the live channel reads, for the reason line — including when it could not be read. */
function was(live) {
    if (live.sha === null) return live.reason;
    return `dist-tag \`next\` is ${live.version}, built from ${short(live.sha)}`;
}

/**
 * A release run of `release.yml` that has not finished.
 *
 * THE EVICTION RULE IS WHY THIS IS A SKIP AND NOT A QUEUE. GitHub keeps exactly ONE
 * pending run per concurrency group and cancels the older pending one. `next` therefore
 * has its own group (see the `concurrency:` block) so it can never evict a queued recovery
 * run — but separate groups mean the two sweeps can OVERLAP, and this lookup is what
 * turns that back into "the release goes first".
 */
async function releaseInFlight({ api, repo, releaseWorkflow, releaseRuns, runId }) {
    let runs;
    try {
        const page = await api(
            `repos/${repo}/actions/workflows/${releaseWorkflow}/runs?per_page=${releaseRuns}&exclude_pull_requests=true`,
        );
        runs = page?.workflow_runs ?? [];
    } catch (error) {
        return {
            blocked: true,
            reason:
                `could not read \`${releaseWorkflow}\`'s run history (${first(error)}), so whether a release ` +
                'is in flight is unknown — standing aside. The schedule fires again tomorrow',
        };
    }

    const busy = runs.find(
        (run) =>
            UNFINISHED.has(String(run?.status)) &&
            RELEASE_EVENTS.has(String(run?.event)) &&
            String(run?.id) !== String(runId),
    );
    if (busy) {
        return {
            blocked: true,
            reason:
                `release run ${busy.id} (\`${busy.event}\`) is ${String(busy.status).replace('_', ' ')} — ` +
                'a release always goes first, so the `next` sweep stands aside until tomorrow',
        };
    }
    return { blocked: false, reason: `no release run of \`${releaseWorkflow}\` is in flight` };
}

/**
 * The commit the live `next` was built from, read off the registry.
 *
 * `{ sha: null }` with a reason is an UNKNOWN, and the caller publishes on it — see the
 * header. The read is cache-busted with a query parameter for the reason
 * `check-probe-retirement.mjs`'s `packumentUrl` states: `cache-control: no-cache`,
 * `pragma`, `max-age=0` and `no-store` all answer `cf-cache-status: HIT` against
 * registry.npmjs.org up to the packument's 300 s edge TTL. A 5-minute-stale document
 * would make a sweep that just ran look absent and publish a second time.
 */
async function livePublishedSha({ packument, probePackage }) {
    let doc;
    try {
        doc = await packument(probePackage);
    } catch (error) {
        return {
            sha: null,
            version: null,
            reason: `the registry did not answer for ${probePackage} (${first(error)}), so the live \`next\` is unknown`,
        };
    }
    const version = doc?.['dist-tags']?.next ?? null;
    if (!version) {
        return {
            sha: null,
            version: null,
            reason: `${probePackage} has no \`next\` dist-tag yet, so this is the channel's first sweep`,
        };
    }
    const gitHead = doc?.versions?.[version]?.gitHead ?? null;
    if (typeof gitHead !== 'string' || !/^[0-9a-f]{40}$/.test(gitHead)) {
        // A `next` published before `--source-sha` existed, or by a sweep that lost it.
        // Unknown, not "different": the only honest answer is to publish and record one.
        return {
            sha: null,
            version,
            reason: `${probePackage}@${version} carries no usable \`gitHead\`, so which commit \`next\` holds is unknown`,
        };
    }
    return { sha: gitHead, version, reason: '' };
}

/**
 * Did `ciWorkflow` conclude `success` on this exact commit?
 *
 * The LATEST completed run decides, not any of them: a red run that was re-run green must
 * read as green, and a green run followed by a red re-run must read as red. Runs come back
 * newest-first, which is the order this relies on.
 */
async function ciVerdict({ api, repo, sha, ciWorkflow }) {
    let runs;
    try {
        const page = await api(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
        runs = page?.workflow_runs ?? [];
    } catch (error) {
        return {
            green: false,
            reason:
                `could not read the run history for ${short(sha)} (${first(error)}), so whether ` +
                `\`${ciWorkflow}\` accepted it is unknown — not publishing on an unverified commit`,
        };
    }

    const suffix = `/${ciWorkflow}`;
    const mine = runs.filter((run) => typeof run?.path === 'string' && run.path.endsWith(suffix));
    const completed = mine.filter((run) => run?.status === 'completed');
    if (completed.length === 0) {
        const pending = mine.length > 0;
        return {
            green: false,
            reason: pending
                ? `\`${ciWorkflow}\` is still running on ${short(sha)} — not publishing a commit whose CI has not finished`
                : `no \`${ciWorkflow}\` run exists for ${short(sha)}, so nothing has tested the commit \`main\` is on`,
        };
    }
    const latest = completed[0];
    if (latest.conclusion !== 'success') {
        return {
            green: false,
            reason:
                `the latest \`${ciWorkflow}\` run on ${short(sha)} (run ${latest.id}) concluded ` +
                `\`${latest.conclusion}\` — \`next\` does not carry code main's CI rejected`,
        };
    }
    return {
        green: true,
        reason: `run ${latest.id} of \`${ciWorkflow}\` succeeded on ${short(sha)}`,
    };
}

const short = (value) => (typeof value === 'string' ? value.slice(0, 10) : '<unknown>');
const first = (error) =>
    String(error?.message ?? error)
        .trim()
        .split('\n')[0];

/**
 * Both transports are `fetch`, not `gh` and not `curl`, and that is a deliberate
 * departure from `decide-push-scope.mjs`/`check-probe-retirement.mjs`. Those two run on a
 * bare `ubuntu-latest`, where the GitHub-hosted image ships both binaries. This script's
 * job runs in `ghcr.io/gjsify/ci-fedora:44`, whose package list is not this file's to
 * promise — and a missing `gh` would read as "the run history is unreadable", which is a
 * SKIP. The channel would go quiet and the reason would name the wrong cause.
 * `scripts/cancel-superseded-runs.mjs` (API) and `scripts/verify-published-closure.mjs`
 * (cache-busted packument) are the in-repo precedents for both halves.
 */
async function githubApi(path, token) {
    const response = await fetch(`https://api.github.com/${path}`, {
        headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GET ${path} answered ${response.status} ${response.statusText}`);
    return response.json();
}

/**
 * The packument, cache-busted with a QUERY PARAMETER rather than a header, for the reason
 * `check-probe-retirement.mjs`'s `packumentUrl` records: `cache-control: no-cache`,
 * `pragma`, `max-age=0` and `no-store` all answer `cf-cache-status: HIT` against
 * registry.npmjs.org, up to the packument's own 300 s edge TTL. A 5-minute-stale document
 * would make a sweep that just ran look absent and publish a second time.
 *
 * The FULL document, not the `install-v1` abbreviation: `gitHead` is the field being read
 * and the abbreviated packument drops it.
 */
async function fetchPackument(name) {
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}?__gjsify_next_publish=${nonce}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    // 404 is a FACT about the package, not weather: it has never been published, so there
    // is no `next` to be current. Any other non-2xx is somebody else's outage.
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`the registry answered ${response.status}`);
    return response.json();
}

function flag(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? fallback : argv[i + 1];
}

async function main() {
    const repo = flag('repo');
    const sha = flag('sha');
    if (!repo || !sha) {
        console.error('usage: decide-next-publish.mjs --repo <owner/name> --sha <sha> [--force]');
        return exit(2);
    }

    let verdict;
    try {
        verdict = await nextPublishDecision({
            // The token is read here rather than inside the transport so the injected
            // seam in `tests/e2e/ci-next-publish` stays a one-argument function.
            api: (path) => githubApi(path, env.GH_TOKEN ?? env.GITHUB_TOKEN ?? ''),
            packument: (name) => fetchPackument(name),
            repo,
            sha,
            force: argv.includes('--force') || env.NEXT_FORCE === 'true',
            runId: flag('run-id', env.GITHUB_RUN_ID ?? ''),
            probePackage: flag('package', DEFAULT_PROBE_PACKAGE),
            ciWorkflow: flag('ci-workflow', 'main.yml'),
            releaseWorkflow: flag('release-workflow', 'release.yml'),
            releaseRuns: Number(flag('release-runs', DEFAULT_RELEASE_RUNS)),
        });
    } catch (error) {
        // A crash is not permission. Unlike `decide-push-scope.mjs`, whose fail-open answer
        // is "run everything", the expensive wrong answer here is a sweep nobody vetted.
        verdict = {
            publish: false,
            reason: `the decision itself failed (${first(error)}) — not publishing; the schedule fires again tomorrow`,
            publishedSha: null,
        };
    }

    const reason = verdict.reason.replace(/\n/g, ' ');
    const lines = `publish=${verdict.publish}\nreason=${reason}\npublished-sha=${verdict.publishedSha ?? ''}\n`;
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines);
    else stdout.write(lines);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            env.GITHUB_STEP_SUMMARY,
            `### next channel: ${verdict.publish ? 'publishing' : 'skipped'}\n\n${reason}\n`,
        );
    }
    console.log(`[next-publish] ${verdict.publish ? 'PUBLISH' : 'SKIP'} — ${reason}`);
    return exit(0);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) await main();
