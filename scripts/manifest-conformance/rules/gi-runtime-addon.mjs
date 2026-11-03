/**
 * Rule `gi-runtime-addon` (ADR 0117 § 1) — REPO-SCOPED.
 *
 * An Android GI add-on (`@gjsify/gi-runtime-android-gtk`) declares `gjsify.giRuntime`:
 * which core it extends and which namespaces it provides. The build-time planner reads
 * that block to name the add-on a missing namespace needs, so a stale one sends a user to
 * the wrong package.
 *
 * Three edges are checked, each one a way the pair breaks while every build exits 0:
 *
 * - the add-on's `version` equals the core's, and it depends on the core at EXACTLY that
 *   version — both AARs link one sysroot, and the device refuses a mixed pair at startup,
 *   so a range that lets npm resolve an older core turns a lockstep release into a crash;
 * - the CORE does not list the add-on in any dependency block: npm installs
 *   `optionalDependencies` by default, which would put every add-on's AAR into every
 *   app's APK (the ADR's first draft said otherwise; see its amendment);
 * - `namespaces` is a non-empty list of strings.
 *
 * The exact pin is a literal rather than `workspace:*` because `gjsify pack` rewrites the
 * protocol only for root-workspace members and `packages/node-gi/*` are not members.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/registry.mjs';

const GROUP = 'packages/node-gi';
const DEP_BLOCKS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function readManifest(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * @param {Array<{ rel: string, manifest: Record<string, any> }>} packages every package in the group
 * @returns {{ failures: string[], addons: number }}
 */
export function auditGiAddons(packages) {
    const failures = [];
    const byName = new Map(packages.map((p) => [p.manifest.name, p]));
    const addons = packages.filter((p) => p.manifest.gjsify?.giRuntime);
    for (const { rel, manifest } of addons) {
        const gi = manifest.gjsify.giRuntime;
        const core = byName.get(gi.core);
        if (!core) {
            failures.push(`${rel}: \`gjsify.giRuntime.core\` names ${gi.core}, which is no package under ${GROUP}.`);
            continue;
        }
        if (manifest.version !== core.manifest.version) {
            failures.push(
                `${rel}: version ${manifest.version} differs from ${gi.core} ${core.manifest.version} — the pair is released in lockstep.`,
            );
        }
        const pin = manifest.dependencies?.[gi.core];
        if (pin !== core.manifest.version) {
            failures.push(
                `${rel}: \`dependencies["${gi.core}"]\` is ${JSON.stringify(pin)}, expected the exact literal ` +
                    `"${core.manifest.version}" — a range lets npm install a core built against another sysroot.`,
            );
        }
        for (const block of DEP_BLOCKS) {
            if (core.manifest[block]?.[manifest.name] !== undefined) {
                failures.push(
                    `${core.rel}: lists ${manifest.name} in \`${block}\` — the core must not depend on its add-ons, ` +
                        'or every APK grows by the add-on AAR.',
                );
            }
        }
        const ns = gi.namespaces;
        if (!Array.isArray(ns) || ns.length === 0 || ns.some((n) => typeof n !== 'string' || n === '')) {
            failures.push(`${rel}: \`gjsify.giRuntime.namespaces\` must be a non-empty list of namespace names.`);
        }
    }
    return { failures, addons: addons.length };
}

export const giRuntimeAddonRule = defineRule({
    id: 'gi-runtime-addon',
    scope: 'repo',
    fields: ['gjsify.giRuntime'],
    description: 'Android GI add-ons pin their core exactly, and the core never depends on an add-on (ADR 0117)',
    run(ctx) {
        const dir = join(ctx.root, GROUP);
        const packages = [];
        for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
            if (!entry.isDirectory()) continue;
            const manifest = readManifest(join(dir, entry.name, 'package.json'));
            if (manifest) packages.push({ rel: `${GROUP}/${entry.name}`, manifest });
        }
        const { failures, addons } = auditGiAddons(packages);
        return {
            failures,
            stats: { addons },
            summary: `gi-runtime-addon: ${addons} add-on(s) pin their core exactly`,
        };
    },
});
