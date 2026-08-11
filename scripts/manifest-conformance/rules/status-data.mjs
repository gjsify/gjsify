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
 *
 * NEVER gate on regenerating STATUS.md. A byte-comparison against a committed copy
 * was tried and removed: STATUS.md derives from every manifest, so ANY merge staled
 * every open PR's copy and the check blamed the wrong PR; and its counts are read off
 * the DISK rather than git (`examples/`, `showcases/`, `tests/` listings), so two
 * CORRECT checkouts legitimately disagree — the introducing commit baked `68` examples
 * from a tree with untracked scratch directories against a clean checkout's `63`.
 * STATUS.md is gitignored now, so there is no tracked artifact to keep in sync.
 *
 * Repo-scoped because it knows this repo's layout and doc conventions; `fields: []`
 * because it governs no `package.json#gjsify.*` key — declared explicitly so the
 * registry's "say what you govern" contract is met rather than silently skipped.
 * Plain fs scans, no install, no build, so it runs on every PR.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { collectPackageFacts, loadStatusData } from '../../generate-status.mjs';

export const statusDataRule = defineRule({
    id: 'status-data',
    scope: 'repo',
    fields: [],
    description: 'the authored status data under status/ validates against the package manifests',
    run(ctx) {
        const facts = collectPackageFacts(ctx.root);
        const { failures } = loadStatusData(ctx.root, facts);
        const published = facts.filter((f) => !f.private).length;
        return {
            failures,
            stats: { packages: facts.length, published },
            summary: `status-data: OK. status/ validates against ${published} published package(s).`,
        };
    },
});
