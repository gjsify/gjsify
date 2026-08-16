/**
 * Rule `release-train` (ADR 0008) — REPO-SCOPED.
 *
 * Every `@gjsify/*` package moves as ONE version and ADR 0008 guarantees
 * compatibility only WITHIN a release. Workspace members get that for free through the
 * workspace; the NativeScript apps `!`-negated out of `workspaces` do not — they carry
 * their own `node_modules` and their own NS toolchain, so their `@gjsify/*` ranges are
 * ordinary npm ranges nothing keeps current. Nothing installs those apps in CI either,
 * and being outside the workspace they are invisible to `gjsify upgrade --check`, so a
 * stale range there has no other signal. The incident behind that is in the failure
 * message below.
 *
 * WHO KEEPS IT TRUE ACROSS A CUT. `@release-it/bumper` globs these manifests but
 * rewrites only `version`, never a dependency RANGE — so the moment release-it bumps
 * the workspace, every range here names the PREVIOUS version and this rule fails
 * inside the `after:bump` hook. The other half is
 * `scripts/bump-release-train-ranges.mjs`, which runs earlier in that hook and
 * rewrites the edges `trainEdges()` selects — the SAME selection this rule grades,
 * shared rather than reimplemented. It is fail-closed on `gjsify pack`'s contract, so
 * a finding here on a bumped tree means the hook did not run, not that it gave up.
 *
 * Repo-scoped: it compares against THIS repo's version and reads `@gjsify/*` edges in
 * paths this repo lays out. It never reaches the network — an unsatisfiable range is
 * caught as a side effect of requiring the CURRENT version, and a conformance rule
 * that needs a registry is one that fails when the registry is down.
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
 * The trees that hold standalone apps.
 *
 * `tests/integration` is one of them and is NOT shaped like the other two — its apps sit
 * one level down, not two. That is exactly how it went unread: the walk counted levels,
 * so `tests/integration/nativescript` — the on-device NS suite, and the third manifest
 * `!`-negated out of the root `workspaces` — was never collected, and its `@gjsify/*`
 * ranges named a long-superseded release with nothing anywhere to say so.
 */
const APP_GROUPS = ['showcases', 'examples', 'tests/integration'];

/**
 * Every directory under {@link APP_GROUPS} carrying its own `package.json`. The
 * workspace-excluded apps among them are what this rule is for; including the rest costs
 * nothing because they resolve identically.
 *
 * Depth-agnostic on purpose: the walk stops at the first `package.json` on a branch
 * rather than counting levels, so a group's layout is not a second thing to keep in sync
 * with this file. Stopping there also keeps the walk out of an app's own `node_modules`,
 * the only large subtree down here.
 *
 * A manifest that EXISTS but does not parse is returned separately rather than dropped:
 * an unreadable file has no ranges, so dropping it passes every check by having nothing
 * to check — a manifest that looks authoritative and is not. An ABSENT `package.json`
 * is ordinary and simply skipped.
 *
 * @returns {{apps: Array<{rel: string, manifest: Record<string, unknown>}>, unreadable: string[]}}
 */
export function collectStandaloneApps(root) {
    const apps = [];
    const unreadable = [];
    for (const group of APP_GROUPS) collectAppsUnder(root, group, apps, unreadable);
    return { apps, unreadable };
}

/** One branch of the {@link collectStandaloneApps} walk; `rel` stays posix for messages. */
function collectAppsUnder(root, rel, apps, unreadable) {
    const dir = join(root, rel);
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) {
        const manifest = readManifest(join(dir, 'package.json'));
        if (manifest) apps.push({ rel, manifest });
        else unreadable.push(rel);
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) collectAppsUnder(root, `${rel}/${entry.name}`, apps, unreadable);
    }
}

/** The range every governed edge has to name, for a given workspace version. */
export function trainRange(version) {
    return `^${version}`;
}

/**
 * THE ONE definition of "which dependency edges ride the release train".
 *
 * A generator rather than an inlined loop because a SECOND consumer needs exactly this
 * set: `scripts/bump-release-train-ranges.mjs`, the release hook that rewrites these
 * ranges. A rewriter with its own copy of the skip list would "fix" an edge this rule
 * allows, or miss one it does not, and the two would disagree inside the few seconds of
 * a bumped tree — where the only symptom is a failed cut.
 *
 * @returns {Generator<{block: string, name: string, range: string}>}
 */
export function* trainEdges(manifest) {
    for (const block of DEP_BLOCKS) {
        const deps = manifest[block];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, range] of Object.entries(deps)) {
            if (!name.startsWith('@gjsify/')) continue;
            // A workspace protocol or local path is already pinned to this checkout, so
            // it cannot drift.
            if (typeof range !== 'string') continue;
            if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:')) continue;
            // `*` / `latest` cannot LAG — they always resolve to the newest publish,
            // which is the failure mode this rule exists for. Loose about the future
            // rather than stale about the past, used deliberately by `examples/*`.
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
    description: 'standalone apps name the current workspace version for every `@gjsify/*` range',
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
