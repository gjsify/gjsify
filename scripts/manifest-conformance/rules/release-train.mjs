/**
 * Rule `release-train` (ADR 0008) — REPO-SCOPED.
 *
 * Every `@gjsify/*` package moves as ONE version, and ADR 0008 is explicit that
 * compatibility is guaranteed only WITHIN a release. Workspace members get that
 * for free — they resolve through the workspace. The packages that do NOT are
 * the NativeScript apps under `showcases/`, which are deliberately EXCLUDED from
 * `workspaces` (they carry their own `node_modules` and their own NS toolchain),
 * so their `@gjsify/*` ranges are ordinary npm ranges that nothing keeps current.
 *
 * THE INCIDENT. `showcases/dom/adwaita-storybook-nativescript` asked for
 * `@gjsify/example-gtk-adwaita-storybook: ^0.11.0`. That package's FIRST publish
 * was 0.19.0, so the range was unsatisfiable and `npm install` in that showcase
 * failed with ETARGET — for however long it had been that way. Nothing noticed,
 * because nothing installs those apps in CI: they are excluded from the
 * workspace, so `gjsify upgrade --check` (which holds the TypeScript pin across
 * every workspace member) never sees them either. Two sibling showcases had
 * quietly drifted to `^0.11.0` and `^0.4.36` against a workspace at 0.31.0 —
 * installable, but mixing releases across exactly the boundary ADR 0008 says
 * carries no compatibility promise.
 *
 * WHO KEEPS IT TRUE ACROSS A RELEASE. `@release-it/bumper` globs these same
 * manifests, but it rewrites only their `version` field — never a dependency
 * RANGE. So the moment release-it bumped the workspace to the next version,
 * every range here named the PREVIOUS one and this rule failed inside the
 * `after:bump` hook: unsatisfiable during a cut from the day it was added, and
 * the v0.32.0 attempt was the first cut since, which is where it surfaced (11
 * findings across the three NativeScript apps). The missing half is
 * `scripts/bump-release-train-ranges.mjs`, which runs earlier in that same hook
 * and rewrites the edges `trainEdges()` selects — the SAME selection this rule
 * grades, shared rather than reimplemented, for the reason on that generator.
 * That script is fail-closed on `gjsify pack`'s contract (substitute correctly
 * or refuse; never write a range nothing verified), so a finding here on a
 * bumped tree means the hook did not run, not that it gave up quietly.
 *
 * Why repo-scoped: it compares against THIS repo's own version and reads only
 * `@gjsify/*` edges in paths this repo lays out. In a consumer's tree it would
 * be meaningless.
 *
 * What it deliberately does NOT do: reach the network. An unsatisfiable range is
 * caught here as a side effect of requiring the CURRENT version, without asking
 * npm what exists — a conformance rule that needs a registry is a rule that
 * fails when the registry is down.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/registry.mjs';

/** Dependency blocks whose ranges are load-bearing for an install. */
const DEP_BLOCKS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** Read a package.json, or null when it is absent or unparsable. */
function readManifest(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Every directory under `showcases/` and `examples/` that carries its own
 * `package.json` — the workspace-excluded apps among them are what this rule is
 * for, and including the rest costs nothing because they resolve identically.
 *
 * A manifest that EXISTS but does not parse is returned separately rather than
 * dropped. Dropping it is the failure this rule is about, one level up: an
 * unreadable file has no ranges, so it passes every check by having nothing to
 * check — a manifest that looks authoritative and is not. An ABSENT
 * `package.json` is ordinary (most directories under a pillar are not apps) and
 * is simply skipped.
 *
 * @param {string} root
 * @returns {{apps: Array<{rel: string, manifest: Record<string, unknown>}>, unreadable: string[]}}
 */
export function collectStandaloneApps(root) {
    const apps = [];
    const unreadable = [];
    for (const group of ['showcases', 'examples']) {
        const groupDir = join(root, group);
        if (!existsSync(groupDir)) continue;
        for (const pillar of readdirSync(groupDir, { withFileTypes: true })) {
            if (!pillar.isDirectory()) continue;
            const pillarDir = join(groupDir, pillar.name);
            for (const app of readdirSync(pillarDir, { withFileTypes: true })) {
                if (!app.isDirectory()) continue;
                const rel = `${group}/${pillar.name}/${app.name}`;
                const path = join(pillarDir, app.name, 'package.json');
                if (!existsSync(path)) continue;
                const manifest = readManifest(path);
                if (manifest) apps.push({ rel, manifest });
                else unreadable.push(rel);
            }
        }
    }
    return { apps, unreadable };
}

/** The range every governed edge has to name, for a given workspace version. */
export function trainRange(version) {
    return `^${version}`;
}

/**
 * THE ONE definition of "which dependency edges ride the release train".
 *
 * It is a generator rather than an inlined loop because a SECOND consumer needs
 * exactly this set: `scripts/bump-release-train-ranges.mjs`, the release hook
 * that rewrites these ranges to the version being cut. A rewriter with its own
 * copy of the skip list would "fix" an edge this rule deliberately allows (or
 * miss one it does not), and the two would disagree — inside the few seconds of
 * a bumped tree, where the only symptom is a failed cut.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {Generator<{block: string, name: string, range: string}>}
 */
export function* trainEdges(manifest) {
    for (const block of DEP_BLOCKS) {
        const deps = manifest[block];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, range] of Object.entries(deps)) {
            if (!name.startsWith('@gjsify/')) continue;
            // A workspace protocol or a local path is already pinned to this
            // checkout — it cannot drift, so it is not this rule's business.
            if (typeof range !== 'string') continue;
            if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:')) continue;
            // `*` / `latest` cannot LAG — they always resolve to the newest
            // publish, which is the failure mode this rule exists for. They
            // are loose about the future rather than stale about the past,
            // and `examples/*` uses that deliberately for dev-only tooling.
            if (range === '*' || range === 'latest') continue;
            yield { block, name, range };
        }
    }
}

/**
 * @param {Array<{rel: string, manifest: Record<string, unknown>}>} apps
 * @param {string} version the workspace version every range must name
 * @returns {{failures: string[], checked: number, ranges: number}}
 */
export function auditReleaseTrain(apps, version) {
    const failures = [];
    const wanted = trainRange(version);
    let ranges = 0;

    for (const { rel, manifest } of apps) {
        for (const { block, name, range } of trainEdges(manifest)) {
            ranges++;
            if (range === wanted) continue;
            failures.push(
                `${rel}/package.json: \`${block}.${name}\` is \`${range}\`, not \`${wanted}\`. ` +
                    `\`@gjsify/*\` ships as one release train (ADR 0008) and guarantees compatibility only ` +
                    `WITHIN a release, so an app that is not a workspace member has to name the current one. ` +
                    `This is how ${'`'}adwaita-storybook-nativescript${'`'} came to request a version that was ` +
                    `never published, failing every install there with ETARGET and nothing to notice it.`,
            );
        }
    }
    return { failures, checked: apps.length, ranges };
}

export const releaseTrainRule = defineRule({
    id: 'release-train',
    scope: 'repo',
    fields: [],
    description: 'standalone showcase/example apps name the current workspace version for every `@gjsify/*` range',
    run(ctx) {
        const version = readManifest(join(ctx.root, 'package.json'))?.version;
        if (typeof version !== 'string') {
            return { failures: ['root package.json has no `version`, so the release train has no value to check.'] };
        }
        const { apps, unreadable } = collectStandaloneApps(ctx.root);
        const { failures, checked, ranges } = auditReleaseTrain(apps, version);
        for (const rel of unreadable) {
            failures.push(
                `${rel}/package.json exists but does not parse, so nothing can read its \`@gjsify/*\` ranges — ` +
                    `it passes this rule by having nothing to check. Fix the JSON.`,
            );
        }
        return {
            failures,
            stats: { apps: checked, ranges, unreadable: unreadable.length },
            summary: `release-train: ${ranges} \`@gjsify/*\` range(s) across ${checked} standalone app(s) name ^${version}`,
        };
    },
});
