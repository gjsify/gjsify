/**
 * Rule `pr-trigger-parity` — a workflow that runs on `push` to `main` must offer the
 * SAME coverage on `pull_request`. What runs after the merge has to be available
 * before it, or "all checks passed" is a claim the PR cannot back.
 *
 * WHY THIS EXISTS
 *
 * `docs/ci-selective.md` § PR coverage parity already states the principle — "a cost
 * control makes a PR cheaper; a job that runs ONLY post-merge makes it DISHONEST" —
 * and three workflows were split PR-side one at a time to honour it (`deploy-docs`
 * after #812 broke the docs on main for eight hours, `build-ci-image`, `prebuilds`).
 * Nothing held the principle afterwards, so the two OS-suite workflows kept a
 * `pull_request` trigger path-filtered onto their own file: a filter satisfiable only
 * by editing the filter. They read as PR-covered in the `on:` block and covered
 * nothing else.
 *
 * The bill for that shape was `@gjsify/cli`'s win32 suite. #1209 changed the CLI's
 * install classifier, showed "all checks passed" — no Windows package suite was among
 * those checks — merged, and left `windows-suites.yml` red across eight further merges
 * until #1217 corrected the classifier's answer for the target platform. Over the life
 * of the two workflows a fifth of their `main` pushes went red, every one of them on a
 * commit that was already in.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Checked: for every workflow triggered by `push` to `main`, a `pull_request` trigger
 * exists and carries the IDENTICAL path filter (both unfiltered, or the same `paths:`
 * / `paths-ignore:` membership). Identity rather than a subset test is on purpose —
 * deciding whether one glob list covers another needs a solver, and every conforming
 * workflow in this repository already spells the two sides the same.
 *
 * NOT checked: whether a filter's globs actually cover what the workflow guards. Two
 * sides that are equally wrong look like parity, and agreeing is all this rule can
 * see. `napi.yml` was the worked example until it went deny-list; the open one is
 * `deploy-docs.yml`, whose `paths:` allow-list omits `scripts/**` while its job runs
 * `gjsify run build:infra` (which runs `node scripts/bootstrap-native-facades.mjs`) and
 * builds a website whose `generate-coverage.mjs` imports
 * `../../scripts/generate-status.mjs` and whose `generate-platform-matrix.mjs` imports
 * `../../scripts/audit-runtimes.mjs`. Closing that one is a separate decision — a
 * deny-list there re-triggers a Pages DEPLOY, not just a check. `types:` narrowing on a
 * `pull_request` (`commitlint.yml` narrows it deliberately, and a types list is not a
 * coverage claim about the tree); and whether the PR run is a REQUIRED check, which is
 * a governance decision documented in `docs/governance.md`, not a conformance fact.
 *
 * A `pull_request_target` does not satisfy the rule. `prebuilds.yml` records why the
 * distinction matters — a write token plus secrets on head code must not exist in a
 * workflow that can push — so accepting it here would offer that as the cheap way out.
 *
 * Repo-scoped: it parses THIS repository's `.github/workflows/`. Structural read, no
 * YAML dependency, for the same reason `platforms-ci` hand-rolls its matrix parser —
 * the gate runs on a host with no install.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** The branch whose post-merge runs this rule is about. */
const GATED_BRANCH = 'main';

const WORKFLOW_DIR = join('.github', 'workflows');

const unquote = (value) => value.replace(/^['"]|['"]$/g, '').trim();

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The `on:` block as raw lines, or `null` when the file does not spell it as a block.
 *
 * `on` is a YAML 1.1 boolean, so the key legitimately appears quoted; all three
 * spellings are accepted. A file this cannot read is reported as a FAILURE rather than
 * skipped — an unparsed workflow is exactly where the gap this rule exists for would
 * sit, and a check that quietly passes what it could not read is the defect it guards.
 */
function onBlockLines(text) {
    const lines = text.split('\n').filter((line) => !/^\s*#/.test(line));
    const start = lines.findIndex((line) => /^(on|'on'|"on"):\s*$/.test(line));
    if (start < 0) return null;
    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        if (indentOf(line) === 0) break;
        out.push(line);
    }
    return out;
}

/**
 * One trigger's own sub-block (`push:`, `pull_request:`) as raw lines.
 *
 * Returns `null` when the key is absent and `[]` when it is present with nothing under
 * it — an unfiltered trigger. Those two are the interesting opposite answers, so they
 * must not collapse into one falsy value.
 */
function triggerBlock(onLines, key) {
    const idx = onLines.findIndex((line) => new RegExp(`^\\s+${key}:\\s*$`).test(line));
    if (idx < 0) return null;
    const indent = indentOf(onLines[idx]);
    const out = [];
    for (let i = idx + 1; i < onLines.length; i++) {
        const line = onLines[i];
        if (!line.trim()) continue;
        if (indentOf(line) <= indent) break;
        out.push(line);
    }
    return out;
}

/**
 * A `key:` list inside a trigger block, in either spelling GitHub accepts — flow
 * (`branches: [main]`) or block (`branches:\n  - main`). `null` when the key is absent,
 * which is what distinguishes "no filter" from "an empty filter".
 */
export function listUnder(blockLines, key) {
    const at = blockLines.findIndex((line) => new RegExp(`^\\s*${key}:`).test(line));
    if (at < 0) return null;
    const [, inline] = /^\s*[\w-]+:\s*(.*)$/.exec(blockLines[at]);
    if (inline.trim()) {
        return inline
            .trim()
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(unquote)
            .filter(Boolean);
    }
    const indent = indentOf(blockLines[at]);
    const items = [];
    for (let i = at + 1; i < blockLines.length; i++) {
        const line = blockLines[i];
        if (!line.trim()) continue;
        if (indentOf(line) <= indent) break;
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (!item) break;
        items.push(unquote(item[1]));
    }
    return items;
}

/** The path filter of one trigger, as the pair of lists GitHub understands. */
export function pathFilter(blockLines) {
    return { paths: listUnder(blockLines, 'paths'), pathsIgnore: listUnder(blockLines, 'paths-ignore') };
}

/** Membership comparison — a filter's meaning does not depend on the order it is written in. */
const sameList = (a, b) =>
    a === null || b === null ? a === b : a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');

export const sameFilter = (a, b) => sameList(a.paths, b.paths) && sameList(a.pathsIgnore, b.pathsIgnore);

/** How a filter reads in a failure message. */
function describeFilter(filter) {
    if (filter.paths) return `\`paths: [${filter.paths.join(', ')}]\``;
    if (filter.pathsIgnore) return `\`paths-ignore: [${filter.pathsIgnore.join(', ')}]\``;
    return 'no path filter';
}

const FIX = [
    'Give the two triggers the same filter — either both unfiltered, or the same `paths:`/`paths-ignore:`',
    'list on both. `node-gi.yml` is the worked example: one `paths-ignore` deny-list, spelled identically on',
    '`push` and `pull_request`. A deny-list, never an allow-list: an allow-list that stops covering an input',
    'fails SILENT, which is how `main` sat red from 2026-08-13 with nothing saying so (#1028, #1149, #1173).',
].join(' ');

/**
 * Every workflow this repository has, paired with the verdict. Exported so the e2e can
 * assert the invariant over the real tree as well as over synthetic shapes.
 *
 * @param {string} root
 */
export function triggerParityRows(root) {
    const dir = join(root, WORKFLOW_DIR);
    const rows = [];
    for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
        const onLines = onBlockLines(readFileSync(join(dir, file), 'utf8'));
        if (onLines === null) {
            rows.push({ file, verdict: 'unreadable' });
            continue;
        }
        const push = triggerBlock(onLines, 'push');
        // Not every `push` is about a branch: `release.yml` fires on tags, and a
        // workflow no merge can trigger has no post-merge coverage to match.
        const branches = push === null ? null : listUnder(push, 'branches');
        if (push === null || !branches?.includes(GATED_BRANCH)) {
            rows.push({ file, verdict: 'not-gated' });
            continue;
        }
        const pr = triggerBlock(onLines, 'pull_request');
        if (pr === null) {
            rows.push({
                file,
                verdict: 'no-pr-trigger',
                target: triggerBlock(onLines, 'pull_request_target') !== null,
            });
            continue;
        }
        const pushFilter = pathFilter(push);
        const prFilter = pathFilter(pr);
        rows.push({
            file,
            verdict: sameFilter(pushFilter, prFilter) ? 'parity' : 'narrower',
            pushFilter,
            prFilter,
        });
    }
    return rows;
}

export const prTriggerParityRule = defineRule({
    id: 'pr-trigger-parity',
    scope: 'repo',
    fields: [],
    description: 'a workflow running on push to main offers the same coverage on pull_request',
    run(ctx) {
        const rows = triggerParityRows(ctx.root);
        const failures = [];
        for (const row of rows) {
            if (row.verdict === 'unreadable') {
                failures.push(
                    `\`${WORKFLOW_DIR}/${row.file}\` has no readable block-form \`on:\` key, so its triggers could not be ` +
                        'compared. This rule fails rather than skips here: an unparsed workflow is where a post-merge-only ' +
                        'job would hide. Spell the trigger as a block (`on:` on its own line), or teach `onBlockLines()` ' +
                        'the shape in the same change.',
                );
            }
            if (row.verdict === 'no-pr-trigger') {
                failures.push(
                    `\`${WORKFLOW_DIR}/${row.file}\` runs on \`push\` to \`${GATED_BRANCH}\` and has no \`pull_request\` ` +
                        `trigger${row.target ? ' (`pull_request_target` does not count — see this rule’s header)' : ''}, so ` +
                        'everything it measures is measured only after the merge. Add a `pull_request:` trigger. ' +
                        FIX,
                );
            }
            if (row.verdict === 'narrower') {
                failures.push(
                    `\`${WORKFLOW_DIR}/${row.file}\` runs on \`push\` to \`${GATED_BRANCH}\` with ` +
                        `${describeFilter(row.pushFilter)}, but its \`pull_request\` trigger has ` +
                        `${describeFilter(row.prFilter)} — a PR gets less than the merge does, and the difference is ` +
                        'invisible in the check list: the job simply is not there, so "all checks passed" excludes it ' +
                        `without saying so. ${FIX}`,
                );
            }
        }
        const gated = rows.filter((r) => r.verdict !== 'not-gated' && r.verdict !== 'unreadable').length;
        return {
            failures,
            stats: { workflows: rows.length, gated },
            summary: `pr-trigger-parity: OK. ${gated} workflow(s) pushing to ${GATED_BRANCH} offer the same coverage on pull_request.`,
        };
    },
});
