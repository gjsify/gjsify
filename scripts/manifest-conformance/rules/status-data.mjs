/**
 * Rule `status-data` — REPO-SCOPED.
 *
 * The project status snapshot lives as DATA under `status/`: the per-package
 * status claim + prose a human must judge, the per-suite integration notes,
 * the open TODOs, the upstream patch-candidate table and a fixed set of
 * free-form sections. Everything DERIVABLE (package lists, tiers, runtime
 * slots, platforms, GNOME-namespace usage, every count) is computed from the
 * manifests + the tree by `scripts/generate-status.mjs` and is never authored.
 *
 * This rule holds the authored half to the manifests:
 *
 *   - `status/status.json` entries use only `status`/`note`/`working`/`missing`,
 *     so a derivable fact (`tier`, `runtimes`, a test count) CANNOT be restated
 *     by hand and therefore cannot contradict the manifest;
 *   - `partial` entries must say WHAT is missing (the gap is the whole point);
 *   - entry coverage runs in BOTH directions — every published package under
 *     `packages/` has an entry, and every entry names a package that exists
 *     (an orphan entry for a deleted package is exactly the drift the data
 *     model exists to prevent);
 *   - an authored `native` status requires a real `gjsify.prebuilds` declaration;
 *   - `## <dir>` headings in `status/integration-coverage.md` are a bijection
 *     onto `tests/integration/*`;
 *   - `status/sections/` holds exactly the fixed section set the generator
 *     renders (an unknown file would silently never appear);
 *   - open-TODO headings are not struck-through / ✓ / "Completed" corpses —
 *     the delete-on-resolve rule, machine-checked rather than remembered.
 *
 * WHY THERE IS NO "STATUS.md REPRODUCES" CHECK (removed 2026-07-31)
 *
 * The rule originally also regenerated STATUS.md and byte-compared it against
 * the committed copy, mirroring `verify-committed-bundles.mjs`. That posture
 * is right for the committed GJS bundles and wrong here, for two reasons that
 * only became visible once it ran:
 *
 *   1. STATUS.md derives from EVERY package manifest, so ANY merge invalidates
 *      every open PR's copy. PR A touches package X, PR B touches package Y;
 *      each regenerated correctly against its own base. A merges, and B is
 *      stale through no fault of its own — the check serialises unrelated work
 *      and blames the wrong PR. The bundles pay that cost because rebuilding
 *      them takes ~20 minutes and a human must decide; there is no comparable
 *      justification for a one-second render.
 *   2. The derived numbers are read off the DISK, not off git (directory
 *      listings under `examples/`, `showcases/`, `tests/`), so two CORRECT
 *      checkouts legitimately disagree. Measured on the very commit that
 *      introduced the check: it baked `68` examples from a tree carrying
 *      untracked scratch directories, against the `63` a clean checkout
 *      counts, and CI could never have agreed with it.
 *
 * The fix was not to tolerate the drift but to remove what drifts: STATUS.md
 * is no longer committed (gitignored; `npm run status:generate` renders it on
 * demand). With no tracked artifact there is nothing to keep in sync, and the
 * half that HAS a right answer — the authored data above — stays hard.
 * Do not reintroduce a freshness comparison against a file that is not in git.
 *
 * Why repo-scoped: it knows this repository's layout (`status/`,
 * `tests/integration/*`, the pillar directories) and its documentation
 * conventions. In a consumer's tree it would find nothing to check.
 *
 * Why `fields: []`: like `curated-alias-routing`, it governs no
 * `package.json#gjsify.*` declaration — its inputs are the `status/` data
 * files. Declared explicitly empty so the registry's "say what you govern"
 * contract is met rather than silently skipped.
 *
 * Cheap by design (plain fs scans, no install, no build) so it can run in the
 * `audit-runtimes.yml` job on every PR.
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
