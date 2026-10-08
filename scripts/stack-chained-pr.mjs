#!/usr/bin/env node
// Turns a hand-chained PR — one whose base is another open PR's branch — into a NATIVE
// GitHub stack, so that squash-merging the lower PR rebases this one onto `main` instead
// of leaving it on a branch that no longer exists.
//
// WHY. `main` is squash-only. A hand-chained PR keeps the lower PR's commits in its own
// history; once the lower PR lands as ONE new squash commit, those commits are on no
// branch `main` knows, and the upper PR shows the lower PR's whole diff again and needs a
// manual `rebase --onto`. A native stack does that rebase server-side. AGENTS.md asks for
// `gh stack`; this catches the PR opened without it.
//
// WHAT IT WILL NOT DO, each a decision rather than a repair: stack a fork PR (stacks are
// same-repository only), stack onto the MIDDLE of a stack (that is a branch, which stacks
// do not support), or move a PR that is already in a stack.
//
// Usage (in a pull_request job):
//   GH_TOKEN=… REPO=owner/name PR_NUMBER=… node scripts/stack-chained-pr.mjs

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {{
 *   repo: string,
 *   pr: { number: number, base: { ref: string }, head: { repo: { full_name: string } | null }, stack?: object | null },
 *   lower: { number: number, stack?: { number: number } | null } | null,
 *   lowerStackTop: number | null,
 *   defaultBranch: string,
 * }} input
 * @returns {{ action: 'none', reason: string }
 *   | { action: 'create', pullRequests: number[] }
 *   | { action: 'add', stackNumber: number, pullRequests: number[] }}
 */
export function planStack({ repo, pr, lower, lowerStackTop, defaultBranch }) {
    if (pr.stack) return { action: 'none', reason: `#${pr.number} is already in a stack.` };
    if (pr.base.ref === defaultBranch) return { action: 'none', reason: `#${pr.number} targets ${defaultBranch}.` };
    if (pr.head.repo?.full_name !== repo) return { action: 'none', reason: 'a fork PR cannot be stacked.' };
    if (!lower) return { action: 'none', reason: `no open PR has \`${pr.base.ref}\` as its head.` };
    if (!lower.stack) return { action: 'create', pullRequests: [lower.number, pr.number] };
    if (lowerStackTop !== lower.number) {
        return {
            action: 'none',
            reason: `#${lower.number} is not the top of stack ${lower.stack.number}; stacking onto it would branch the stack.`,
        };
    }
    return { action: 'add', stackNumber: lower.stack.number, pullRequests: [pr.number] };
}

function gh(args, input) {
    return JSON.parse(
        execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] }) || 'null',
    );
}

function main() {
    const { REPO, PR_NUMBER } = process.env;
    if (!REPO || !PR_NUMBER) {
        console.error('::error::REPO and PR_NUMBER are required — this runs in a pull_request job.');
        process.exit(1);
    }
    const [owner] = REPO.split('/');

    const pr = gh(['api', `repos/${REPO}/pulls/${PR_NUMBER}`]);
    const defaultBranch = pr.base.repo.default_branch;
    const candidates = gh([
        'api',
        '-X',
        'GET',
        `repos/${REPO}/pulls`,
        '-f',
        'state=open',
        '-f',
        `head=${owner}:${pr.base.ref}`,
    ]);
    const lowerNumber = candidates[0]?.number;
    // The list endpoint carries no `stack`; the single-PR one does.
    const lower = lowerNumber ? gh(['api', `repos/${REPO}/pulls/${lowerNumber}`]) : null;
    const lowerStackTop = lower?.stack
        ? (gh(['api', `repos/${REPO}/stacks/${lower.stack.number}`]).pull_requests.at(-1)?.number ?? null)
        : null;

    const plan = planStack({ repo: REPO, pr, lower, lowerStackTop, defaultBranch });
    if (plan.action === 'none') {
        console.log(`stack-chained-pr: nothing to do — ${plan.reason}`);
        return;
    }

    const endpoint = plan.action === 'create' ? `repos/${REPO}/stacks` : `repos/${REPO}/stacks/${plan.stackNumber}/add`;
    try {
        gh(['api', '-X', 'POST', endpoint, '--input', '-'], JSON.stringify({ pull_requests: plan.pullRequests }));
    } catch {
        // 422 when the chain is not linear yet; a later push re-runs this.
        console.log(`::notice::GitHub refused to stack #${plan.pullRequests.join(', #')}. Left as it was.`);
        return;
    }
    console.log(`::notice::stacked #${plan.pullRequests.join(' ← #')} (${plan.action}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
