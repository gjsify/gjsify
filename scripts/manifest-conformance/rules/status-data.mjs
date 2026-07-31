/**
 * Rule `status-data` — REPO-SCOPED.
 *
 * STATUS.md is GENERATED (`scripts/generate-status.mjs`) from authored data in
 * `status/` plus derived facts from the package manifests. That split only
 * stays honest if something fails when the two drift, which is this rule:
 *
 *   1. The authored data is structurally valid — `status/status.json` entries
 *      use only `status`/`note`/`working`/`missing` (so a derivable fact like
 *      `tier` or `runtimes` CANNOT be restated by hand), every published
 *      package under `packages/` has an entry, every entry names a package
 *      that exists, an authored `native` status has a `gjsify.prebuilds`
 *      declaration behind it, integration-coverage headings map 1:1 onto
 *      `tests/integration/*` directories, open-TODO headings are not
 *      struck-through corpses, and `status/sections/` holds exactly the fixed
 *      section set the generator renders.
 *   2. The committed STATUS.md byte-matches a fresh regeneration — a hand
 *      edit of the generated file (or a data edit without regenerating) is a
 *      red run with the regenerate command in the message. Same posture as
 *      `verify-committed-bundles.mjs`: the artifact must reproduce from its
 *      sources.
 *
 * Why repo-scoped: it knows this repository's layout (`status/`,
 * `tests/integration/*`, the pillar directories) and its documentation
 * conventions. In a consumer's tree it would find nothing to check.
 *
 * Why `fields: []`: like `curated-alias-routing`, it governs no
 * `package.json#gjsify.*` declaration — its inputs are the `status/` data
 * files and STATUS.md itself. Declared explicitly empty so the registry's
 * "say what you govern" contract is met rather than silently skipped.
 *
 * Cheap by design (plain fs scans, no install, no build) so it can run in the
 * `audit-runtimes.yml` job on every PR.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { collectPackageFacts, generateStatus, loadStatusData } from '../../generate-status.mjs';

export const statusDataRule = defineRule({
    id: 'status-data',
    scope: 'repo',
    fields: [],
    description: 'the authored status data validates, and STATUS.md reproduces from it byte-for-byte',
    run(ctx) {
        const facts = collectPackageFacts(ctx.root);
        const { failures } = loadStatusData(ctx.root, facts);
        let stale = false;
        if (failures.length === 0) {
            const { content } = generateStatus(ctx.root);
            const statusPath = join(ctx.root, 'STATUS.md');
            const current = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : '';
            if (content !== current) {
                stale = true;
                failures.push(
                    'STATUS.md does not match what status/ + the package manifests generate. STATUS.md is a ' +
                        'GENERATED file — edit the authored data under status/ (or the manifests) and run ' +
                        '`node scripts/generate-status.mjs`, then commit both.',
                );
            }
        }
        return {
            failures,
            stats: { packages: facts.length, stale },
            summary:
                `status-data: OK. status/ validates against ${facts.filter((f) => !f.private).length} published ` +
                'package(s) and STATUS.md reproduces from it byte-for-byte.',
        };
    },
});
