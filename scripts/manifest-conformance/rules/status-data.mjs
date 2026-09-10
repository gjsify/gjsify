/**
 * Rule `status-data` — REPO-SCOPED. The status snapshot is AUTHORED DATA under
 * `status/` and everything derivable is rendered by `scripts/generate-status.mjs`
 * (ADR 0016, docs/status-changelog.md). This rule holds the authored half to the
 * manifests:
 *
 *   - `status/status.json` entries carry only `status`/`note`/`working`/`missing`, so
 *     a derivable fact (`tier`, `runtimes`, a test count) cannot be restated by hand
 *     and therefore cannot contradict the manifest;
 *   - `partial` entries must say WHAT is missing;
 *   - entry coverage runs BOTH directions — every published package under `packages/`
 *     has an entry, and every entry names a package that still exists;
 *   - an authored `native` status requires a real `gjsify.prebuilds` declaration;
 *   - `## <dir>` headings in `status/integration-coverage.md` are a bijection onto
 *     `tests/integration/*`;
 *   - `status/sections/` holds exactly the fixed section set the generator renders (an
 *     unknown file would silently never appear);
 *   - open-TODO headings are not struck-through / ✓ / "Completed" corpses.
 *   - the RENDER is not in the git index (below).
 *
 * NEVER gate on regenerating STATUS.md. A byte-comparison against a committed copy
 * was tried and removed: STATUS.md derives from every manifest, so ANY merge staled
 * every open PR's copy and the check blamed the wrong PR; and its counts are read off
 * the DISK rather than git (`examples/`, `showcases/`, `tests/` listings), so two
 * CORRECT checkouts legitimately disagree — the introducing commit baked `68` examples
 * from a tree with untracked scratch directories against a clean checkout's `63`.
 *
 * THE OPPOSITE CLAIM NEEDED A CHECK TOO (#1631)
 *
 * This header used to end "STATUS.md is gitignored now, so there is no tracked
 * artifact to keep in sync", and that sentence was false for as long as it stood: the
 * blob sat in the index the whole time, beside the `.gitignore` line. Nothing
 * contradicted the two, because an ignore rule suppresses UNTRACKED files only — so
 * git kept handing the render out while every tool reading `.gitignore` called the
 * path ignored, and a file nothing ever showed as dirty is a file nobody regenerates.
 * The staleness that argument predicts arrived in full, just invisibly.
 *
 * So the index is the thing to assert, and `.gitignore` is not the assertion: it is a
 * suppression, and here it suppressed the evidence. One membership test, on the
 * generator's own `RENDER_PATH`, using the reader this registry already has.
 *
 * WHY THE PATH IS NAMED AND THE RULE IS NOT "NOTHING IGNORED IS TRACKED"
 *
 * The general form was measured and is not available. `git ls-files -i -c
 * --exclude-standard` reports `refs/gtk` beside the render — tracked, and excluded
 * only by a line in `.git/info/exclude`, which no commit carries. A rule over that set would answer a question about the checkout it
 * runs in rather than about the commit under review, i.e. it would differ between a
 * developer's tree and CI by construction. Restricting it to the TRACKED `.gitignore`
 * files instead means implementing gitignore matching — negations, directory
 * patterns, nested files — a mechanism written to watch a one-line policy, which is
 * the smell the root AGENTS.md names under `simplicity`.
 *
 * Repo-scoped because it knows this repo's layout and doc conventions; `fields: []`
 * because it governs no `package.json#gjsify.*` key — declared explicitly so the
 * registry's "say what you govern" contract is met rather than silently skipped.
 * Plain fs scans, no install, no build, so it runs on every PR.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { RENDER_PATH, collectPackageFacts, loadStatusData } from '../../generate-status.mjs';
import { readIndexPaths } from '../git-index.mjs';

/**
 * The render as a staged path, or `null` when it is not staged.
 *
 * Reads the index as a FILE — `windows-suites.yml` runs this same `--check` with no
 * `git` binary on PATH, and a rule that shelled out died there reporting nothing. No
 * tolerance for an absent `.git`: `audit-runtimes.mjs` takes its root from its own
 * module URL, so this rule only ever runs against this checkout, and a root with no
 * index is a broken one rather than a synthetic one.
 *
 * @param {string} root
 * @returns {string | null}
 */
function stagedRender(root) {
    return readIndexPaths(root).has(RENDER_PATH) ? RENDER_PATH : null;
}

export const statusDataRule = defineRule({
    id: 'status-data',
    scope: 'repo',
    fields: [],
    description: 'the authored status data under status/ validates against the package manifests',
    run(ctx) {
        const facts = collectPackageFacts(ctx.root);
        const { failures } = loadStatusData(ctx.root, facts);
        const published = facts.filter((f) => !f.private).length;
        const tracked = stagedRender(ctx.root);
        if (tracked !== null) {
            failures.push(
                `${tracked} is staged in the git index. It is the GENERATED render of the authored data under ` +
                    'status/ (ADR 0016 amendment) and .gitignore already names it — but an ignore rule suppresses ' +
                    'UNTRACKED files only, so a tracked copy never shows up dirty, never gets regenerated, and is ' +
                    `handed to every clone by \`git checkout\` anyway. Run \`git rm --cached ${tracked}\`: the file ` +
                    'stays on disk and `npm run status:generate` rewrites it whenever you want the tables.',
            );
        }
        return {
            failures,
            stats: { packages: facts.length, published, renderTracked: tracked !== null },
            // The index half of the summary reports what was MEASURED. A fixed
            // "…is not in the index" would have been a sentence this rule prints
            // while its own finding says otherwise — the shape it exists to catch.
            summary:
                `status-data: ${failures.length === 0 ? 'OK' : 'FAILED'}. status/ validates against ${published} ` +
                `published package(s); ${RENDER_PATH} is ${tracked === null ? 'not ' : ''}in the index.`,
        };
    },
});
