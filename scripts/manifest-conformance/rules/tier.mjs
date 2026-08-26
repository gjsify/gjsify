/**
 * Rule `tier` (ADR 0003 + ADR 0005) — REPO-SCOPED, because `gjsify.tier` is a
 * governance field of the `@gjsify/*` release train: how much stability THIS project
 * promises, and which of ITS packages may depend on which. The check hard-codes
 * `@gjsify/node-gi` by name (ADR 0005) and reads only `@gjsify/*` edges, so in a
 * consumer's tree it would either find nothing or enforce a policy that is not theirs.
 *
 * Three hard failures:
 *   1. a published package lacks `gjsify.tier` ∈ {1,2,3};
 *   2. a deps/optionalDeps edge A→B between workspace packages with tier(B) > tier(A)
 *      (ADR 0003 rule 1) — devDeps and optional peerDeps encode exactly this
 *      looseness and are exempt by design;
 *   3. no Tier-1/2 package hard-depends on `@gjsify/node-gi`. Subsumed by 2 while
 *      node-gi is Tier 3, but asserted by name so it survives a tier edit.
 *   4. no published package hard-depends on `@ts-for-gir/*` or `@gi.ts/*` (ADR 0019
 *      Decision 1). Same by-name shape as 3, and for the same reason: those packages
 *      are deliberately build-step-free, so the edge is not a tier question at all.
 */

import { defineRule, packagesUnder, readManifest } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const VALID_TIERS = new Set([1, 2, 3]);

/**
 * The scopes ts-for-gir publishes, which ADR 0019 Decision 1 keeps build-step-free:
 * every one of them resolves `exports["."]` to `./src/index.ts`, verified on the
 * registry rather than assumed. A `dependencies` edge on one therefore ships raw
 * TypeScript to everyone who installs the depending package from npm.
 *
 * Checked by NAME, like the node-gi rule above, because it is not a tier question —
 * these are external packages with no `gjsify.tier` at all, which is exactly why the
 * tier walk below used to skip them and this boundary went unenforced.
 */
const isBuildStepFree = (dep) => dep.startsWith('@ts-for-gir/') || dep.startsWith('@gi.ts/');

/**
 * Workspace roots that may contain published packages (root package.json
 * `workspaces` globs). templates/examples/tests are all-private today, but
 * walking them is cheap and catches a future accidentally-published one.
 */
export const TIER_AUDIT_ROOTS = ['packages', 'showcases', 'templates', 'examples', 'tests', 'website'];

/** Collect every PUBLISHED workspace package with its tier + @gjsify/* edges. */
export function collectPublishedPackages(root) {
    const dirs = [];
    for (const sub of TIER_AUDIT_ROOTS) {
        const abs = resolve(root, sub);
        if (existsSync(abs)) packagesUnder(abs, dirs);
    }
    const published = new Map();
    for (const dir of dirs) {
        const pkg = readManifest(dir);
        if (!pkg || pkg.private || !pkg.name) continue;
        const edges = [];
        for (const field of ['dependencies', 'optionalDependencies']) {
            for (const dep of Object.keys(pkg[field] ?? {})) {
                if (dep.startsWith('@gjsify/') || isBuildStepFree(dep)) edges.push({ dep, field });
            }
        }
        published.set(pkg.name, { path: relative(root, dir), tier: pkg.gjsify?.tier, edges });
    }
    return published;
}

/** Run the three tier checks; returns human-readable failure lines (empty = ok). */
export function auditTiers(published) {
    const failures = [];
    for (const [name, info] of published) {
        if (!VALID_TIERS.has(info.tier)) {
            failures.push(
                `${name} (${info.path}): missing or invalid \`gjsify.tier\` — every published package must declare a tier ∈ {1,2,3} (ADR 0003).`,
            );
        }
    }
    for (const [name, info] of published) {
        if (!VALID_TIERS.has(info.tier)) continue; // already reported above
        for (const { dep, field } of info.edges) {
            if (isBuildStepFree(dep)) {
                failures.push(
                    `${name} (${info.path}) → ${dep} via ${field}: forbidden by ADR 0019 Decision 1 — ${dep} exports \`./src/index.ts\`, so a hard edge publishes raw TypeScript to every consumer of ${name}. The sanctioned seam is a devDependency that gjsify BUNDLES (\`gjsify build --app node\`), which is what all existing edges in this repo are.`,
                );
                continue;
            }
            const target = published.get(dep);
            // Not a published workspace package (private example, or an external
            // `@gjsify/*`) — out of tier-contract scope. A published package depending
            // on a private one is a publish-tooling failure, not a tier failure.
            if (!target || !VALID_TIERS.has(target.tier)) continue;
            if (dep === '@gjsify/node-gi' && info.tier < 3) {
                failures.push(
                    `${name} (Tier ${info.tier}) → @gjsify/node-gi via ${field}: forbidden by ADR 0005 — node-gi is experimental (Tier 3) and dependency-isolated; the sanctioned seams are a devDependency (\`--runtime node\` dev flows) and the conditional \`--app node\` build injection.`,
                );
                continue;
            }
            if (target.tier > info.tier) {
                failures.push(
                    `dependency-direction violation: ${name} (Tier ${info.tier}) → ${dep} (Tier ${target.tier}) via ${field} — a package must not hard-depend on a higher (less stable) tier (ADR 0003 rule 1; optional peers / devDeps are the sanctioned seams).`,
                );
            }
        }
    }
    return failures;
}

export const tierRule = defineRule({
    id: 'tier',
    scope: 'repo',
    fields: ['gjsify.tier'],
    description: 'every published package declares a tier, and no package hard-depends on a less stable one',
    run(ctx) {
        const published = collectPublishedPackages(ctx.root);
        const failures = auditTiers(published);
        return {
            failures,
            stats: { published: published.size },
            summary:
                `tier audit: OK. ${published.size} published package(s) declare a tier; ` +
                'dependency-direction, ADR-0005 node-gi isolation and the ADR-0019 build-step-free ' +
                'boundary hold on every deps/optionalDeps edge.',
            published,
        };
    },
});
