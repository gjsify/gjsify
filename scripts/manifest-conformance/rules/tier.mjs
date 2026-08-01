/**
 * Rule `tier` (ADR 0003 + ADR 0005) — REPO-SCOPED.
 *
 * Why repo-scoped rather than portable: `gjsify.tier` is a governance field of
 * the `@gjsify/*` release train — it says how much stability THIS project
 * promises for a package and which of ITS packages may depend on which. The
 * check hard-codes `@gjsify/node-gi` by name (ADR 0005) and reads only
 * `@gjsify/*` edges. In a consumer's tree it would either find nothing or
 * enforce a policy that is not theirs, so it stays here.
 *
 * Four checks, all hard failures:
 *
 *   1. tier-missing   : a published package lacks `gjsify.tier` ∈ {1,2,3}.
 *   2. tier-direction : a dep edge A→B (deps/optionalDeps, both @gjsify
 *                       workspace packages) where tier(B) > tier(A) — a
 *                       stability-promised package must not inherit a less
 *                       stable package's breakage (ADR 0003 rule 1).
 *                       devDependencies and (optional) peerDependencies are
 *                       exempt by design — they encode exactly this looseness.
 *   3. node-gi-isolation: ADR 0005 names `@gjsify/node-gi` explicitly — no
 *                       Tier-1/2 package may take a hard dependency on it.
 *                       (Subsumed by 2 while node-gi is Tier 3, but asserted
 *                       by name so the invariant survives a tier edit.)
 *   4. artifact-package: ADR 0003 rule 5 — a platform-gated ARTIFACT package
 *                       inherits the tier of the package whose artifacts it
 *                       carries. See {@link auditArtifactPackages}.
 *
 * Check 4 is the only one that RELAXES check 2, and it does so for exactly one
 * edge shape: parent → its own declared artifact package. That relaxation is
 * why check 4 is strict about everything else — the four structural conditions
 * plus tier EQUALITY and version lockstep are what make the exemption
 * unreachable by anything that is not genuinely a carrier of the parent's own
 * binaries. Weakening any of them turns rule 1 into a suggestion.
 */

import { defineRule, packagesUnder, readManifest } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const VALID_TIERS = new Set([1, 2, 3]);

/** Dep blocks an artifact package must leave EMPTY (see condition 3). */
const ARTIFACT_FORBIDDEN_DEP_BLOCKS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Workspace roots that may contain published packages (root package.json
 * `workspaces` globs). templates/examples/tests are all-private today, but
 * walking them is cheap and catches a future accidentally-published one.
 */
export const TIER_AUDIT_ROOTS = ['packages', 'showcases', 'templates', 'examples', 'tests', 'website'];

/**
 * Does the manifest carry an npm platform gate (`os` / `cpu`)? npm accepts both
 * a bare string and an array for each field, so both shapes count — this is the
 * same tolerance `checkList` in the CLI's `platform-check.ts` implements.
 */
function declaresPlatformGate(pkg) {
    for (const field of ['os', 'cpu']) {
        const value = pkg[field];
        if (typeof value === 'string' && value.length > 0) return true;
        if (Array.isArray(value) && value.length > 0) return true;
    }
    return false;
}

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
            for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
                if (dep.startsWith('@gjsify/')) edges.push({ dep, field, range });
            }
        }
        // Every dep name the package declares, across the three blocks an
        // artifact package must leave empty. devDependencies are deliberately
        // NOT counted: they ship nothing to a consumer.
        const ownDeps = [];
        for (const field of ARTIFACT_FORBIDDEN_DEP_BLOCKS) {
            for (const dep of Object.keys(pkg[field] ?? {})) ownDeps.push({ dep, field });
        }
        published.set(pkg.name, {
            path: relative(root, dir),
            tier: pkg.gjsify?.tier,
            edges,
            version: pkg.version,
            artifactOf: pkg.gjsify?.artifactOf,
            platformGated: declaresPlatformGate(pkg),
            ownDeps,
        });
    }
    return published;
}

/**
 * Is `edge` (owned by `owner`) the sanctioned parent → artifact-package edge?
 *
 * BIDIRECTIONAL on purpose: the child names the parent (`gjsify.artifactOf`)
 * AND the parent must be the one declaring the edge. Neither side can grant
 * itself the rule-1 exemption, which is what keeps "declare `artifactOf` and
 * the direction check goes away" from being a way around ADR 0003.
 *
 * Deliberately checks ONLY the relationship, not the other conditions: a
 * malformed artifact package must produce the actionable rule-5 message from
 * {@link auditArtifactPackages}, not a second dependency-direction line about
 * the same cause.
 */
function isDeclaredArtifactEdge(published, owner, edge) {
    const target = published.get(edge.dep);
    return Boolean(target && target.artifactOf === owner);
}

/**
 * Rule 5 (ADR 0003, amended 2026-08-01) — a platform-gated artifact package
 * inherits the tier of the package whose artifacts it carries.
 *
 * A package that declares `gjsify.artifactOf` is claiming to be one, and the
 * claim buys it an exemption from the dependency-direction rule. So every
 * condition the ADR names is checked here; the exemption is granted by the
 * declaration only when all of them hold.
 */
export function auditArtifactPackages(published) {
    const failures = [];
    for (const [name, info] of published) {
        if (info.artifactOf === undefined) continue;
        const adr = 'ADR 0003 rule 5 (docs/adr/0003-package-tiering.md § Amendment)';

        if (typeof info.artifactOf !== 'string' || info.artifactOf.length === 0) {
            failures.push(
                `${name} (${info.path}): \`gjsify.artifactOf\` must be the NAME of the package whose artifacts this package carries — ${adr}.`,
            );
            continue;
        }
        if (info.artifactOf === name) {
            failures.push(
                `${name} (${info.path}): \`gjsify.artifactOf\` names itself — an artifact package has a PARENT (${adr}).`,
            );
            continue;
        }

        const parentName = info.artifactOf;
        const parent = published.get(parentName);
        if (!parent) {
            failures.push(
                `${name} (${info.path}): \`gjsify.artifactOf\` names "${parentName}", which is not a published package in this ` +
                    `repository. An artifact package's tier is DERIVED from its parent's, so an unresolvable parent leaves the ` +
                    `tier unverifiable (${adr}).`,
            );
            continue;
        }

        // Condition 1 — platform-gated. Without `os`/`cpu` there is no reason
        // for a separate npm name, and no resolver behaviour to exploit: the
        // artifacts would simply ship in the parent's own tarball.
        if (!info.platformGated) {
            failures.push(
                `${name} (${info.path}): declares \`gjsify.artifactOf: "${parentName}"\` but no npm \`os\`/\`cpu\` gate. Only a ` +
                    `PLATFORM-GATED artifact package inherits its parent's tier — a resolver can skip a package, not a directory ` +
                    `inside one, and that gating is the only reason the artifacts need a separate name at all. Declare \`os\` ` +
                    `and/or \`cpu\`, or ship the artifacts inside ${parentName} (${adr}).`,
            );
        }

        // Condition 2 — the parent confirms the edge, as an OPTIONAL dep.
        const parentEdge = parent.edges.find((e) => e.dep === name);
        if (!parentEdge) {
            failures.push(
                `${name} (${info.path}): claims to carry ${parentName}'s artifacts, but ${parentName} does not list it in ` +
                    `\`optionalDependencies\`. The claim is bidirectional: without the parent's edge nothing installs this ` +
                    `package (which is the whole point of the amendment), and the tier exemption would be self-granted (${adr}).`,
            );
        } else if (parentEdge.field !== 'optionalDependencies') {
            failures.push(
                `${name} (${info.path}): ${parentName} lists it in \`${parentEdge.field}\`, not \`optionalDependencies\`. A ` +
                    `platform-gated package as a REQUIRED dependency is \`EBADPLATFORM\` on every other platform; only an ` +
                    `optional one is silently skipped, and that silence is the mechanism (${adr}).`,
            );
        }

        // The amendment itself — tier EQUALITY, checked in both directions so a
        // parent demotion cannot leave the artifact advertising more stability
        // than the thing it belongs to, nor less than a direct consumer gets.
        if (VALID_TIERS.has(info.tier) && VALID_TIERS.has(parent.tier) && info.tier !== parent.tier) {
            failures.push(
                `artifact-package tier mismatch: ${name} declares Tier ${info.tier} while its parent ${parentName} is Tier ` +
                    `${parent.tier}. An artifact package INHERITS its parent's tier — its stability is the parent's by ` +
                    `construction, so the two must be equal (${adr}).`,
            );
        }

        // Condition 3 — no dependencies of its own. The checkable form of "no
        // API that could break a consumer's stability contract": a package that
        // imports nothing has nothing whose breakage it could inherit.
        if (info.ownDeps.length > 0) {
            const listed = info.ownDeps.map((d) => `${d.dep} (${d.field})`).join(', ');
            failures.push(
                `${name} (${info.path}): an artifact package must declare NO dependencies of its own, but declares ${listed}. ` +
                    `Inheriting ${parentName}'s tier is justified by having no imports whose breakage it could inherit; a ` +
                    `dependency makes that false and the package needs a tier argued on its own merits (${adr}).`,
            );
        }

        // Condition 4 — the parent is its only in-repo consumer. A second one is
        // exactly rule 2's promotion gate.
        for (const [otherName, other] of published) {
            if (otherName === parentName || otherName === name) continue;
            const edge = other.edges.find((e) => e.dep === name);
            if (!edge) continue;
            failures.push(
                `${name} (${info.path}) is depended on by ${otherName} via ${edge.field} as well as by its parent ` +
                    `${parentName}. A second consumer means this is a shared dependency with its own contract, not a carrier ` +
                    `of ${parentName}'s binaries — which is precisely ADR 0003 rule 2's promotion gate. Give it a tier argued ` +
                    `on its own merits, or drop the second edge (${adr}).`,
            );
        }

        // Exact version lockstep (the esbuild model, per ADR 0017). A range
        // would let a bumped parent resolve a stale artifact, whose only symptom
        // is a payload that loads against the wrong parent on a user's machine.
        if (info.version && parent.version && info.version !== parent.version) {
            failures.push(
                `${name} (${info.path}) is at ${info.version} while its parent ${parentName} is at ${parent.version}. An ` +
                    `artifact package rides its parent's release train (ADR 0008) — the versions must be equal (${adr}).`,
            );
        }
        if (parentEdge && info.version && parentEdge.range !== info.version) {
            failures.push(
                `${parentName} pins ${name} at "${parentEdge.range}" but ${name} is ${info.version}. An artifact package is ` +
                    `pinned at its EXACT version (the esbuild model, ADR 0017): a range lets a bumped parent resolve a stale ` +
                    `payload, and the only symptom is a wrong-ABI load on a consumer's machine. Fix the pin with ` +
                    `\`node scripts/sync-artifact-pins.mjs\`, which a release bump runs from release-it's \`after:bump\` hook — ${adr}.`,
            );
        }
    }
    return failures;
}

/** Run the four tier checks; returns human-readable failure lines (empty = ok). */
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
        for (const edge of info.edges) {
            const { dep, field } = edge;
            const target = published.get(dep);
            // Not a published workspace package (private example or external
            // @gjsify/* pkg) — out of tier-contract scope. A published package
            // depending on a private one is a publish-tooling failure, not a
            // tier failure.
            if (!target || !VALID_TIERS.has(target.tier)) continue;
            if (dep === '@gjsify/node-gi' && info.tier < 3) {
                failures.push(
                    `${name} (Tier ${info.tier}) → @gjsify/node-gi via ${field}: forbidden by ADR 0005 — node-gi is experimental (Tier 3) and dependency-isolated; the sanctioned seams are a devDependency (\`--runtime node\` dev flows) and the conditional \`--app node\` build injection.`,
                );
                continue;
            }
            // ADR 0003 rule 5: this edge IS the artifact relationship, and
            // `auditArtifactPackages` holds it to a strictly stronger contract
            // (tier equality, not merely same-or-lower). Reporting it here too
            // would print two lines for one cause, the second one misleading.
            if (isDeclaredArtifactEdge(published, name, edge)) continue;
            if (target.tier > info.tier) {
                failures.push(
                    `dependency-direction violation: ${name} (Tier ${info.tier}) → ${dep} (Tier ${target.tier}) via ${field} — a package must not hard-depend on a higher (less stable) tier (ADR 0003 rule 1; optional peers / devDeps are the sanctioned seams).`,
                );
            }
        }
    }
    failures.push(...auditArtifactPackages(published));
    return failures;
}

export const tierRule = defineRule({
    id: 'tier',
    scope: 'repo',
    fields: ['gjsify.tier', 'gjsify.artifactOf'],
    description: 'every published package declares a tier, and no package hard-depends on a less stable one',
    run(ctx) {
        const published = collectPublishedPackages(ctx.root);
        const failures = auditTiers(published);
        const artifacts = [...published.values()].filter((p) => p.artifactOf !== undefined);
        return {
            failures,
            stats: { published: published.size, artifactPackages: artifacts.length },
            summary:
                `tier audit: OK. ${published.size} published package(s) declare a tier; ` +
                'dependency-direction + ADR-0005 node-gi isolation hold on every deps/optionalDeps edge; ' +
                `${artifacts.length} platform-gated artifact package(s) inherit their parent's tier (ADR 0003 rule 5).`,
            published,
        };
    },
});
