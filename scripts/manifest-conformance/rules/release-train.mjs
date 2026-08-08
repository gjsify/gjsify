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
 * @param {string} root
 * @returns {Array<{rel: string, manifest: Record<string, unknown>}>}
 */
export function collectStandaloneApps(root) {
    const found = [];
    for (const group of ['showcases', 'examples']) {
        const groupDir = join(root, group);
        if (!existsSync(groupDir)) continue;
        for (const pillar of readdirSync(groupDir, { withFileTypes: true })) {
            if (!pillar.isDirectory()) continue;
            const pillarDir = join(groupDir, pillar.name);
            for (const app of readdirSync(pillarDir, { withFileTypes: true })) {
                if (!app.isDirectory()) continue;
                const rel = `${group}/${pillar.name}/${app.name}`;
                const manifest = readManifest(join(pillarDir, app.name, 'package.json'));
                if (manifest) found.push({ rel, manifest });
            }
        }
    }
    return found;
}

/**
 * @param {Array<{rel: string, manifest: Record<string, unknown>}>} apps
 * @param {string} version the workspace version every range must name
 * @returns {{failures: string[], checked: number, ranges: number}}
 */
export function auditReleaseTrain(apps, version) {
    const failures = [];
    const wanted = `^${version}`;
    let ranges = 0;

    for (const { rel, manifest } of apps) {
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
        const apps = collectStandaloneApps(ctx.root);
        const { failures, checked, ranges } = auditReleaseTrain(apps, version);
        return {
            failures,
            stats: { apps: checked, ranges },
            summary: `release-train: ${ranges} \`@gjsify/*\` range(s) across ${checked} standalone app(s) name ^${version}`,
        };
    },
});
