// `gjsify.nativescriptPlatforms` — a declared platform has the sources to serve it.
//
// THE GAP THIS CLOSES, and it was already a known one. The unchecked-field
// ledger carried `nativescriptPlatforms` as a FINDING and sketched this exact
// rule: "a declared platform has a matching `*.ios.ts`/`*.android.ts` variant
// where the package ships platform-resolved sources. Deferred." This is that
// rule; the ledger entry retires with it.
//
// THE INCIDENT, carried here so the rule keeps its reason.
// `@gjsify/adwaita-nativescript` declared `['android', 'ios']` while shipping
// `widgets/icons.android.ts` and NO `icons.ios.ts`. The gjsify NS build resolves
// `foo.<platform>.ts` before `foo.ts`, so on iOS that resolution found nothing,
// fell back to the base module — and the base module's `renderSymbolicIcon`
// returns `null` by design, meaning "no backend here". The result was not a
// crash and not a warning: AdwIcon, AdwImageButton, AdwMenuButton,
// AdwButtonContent and every row with an icon rendered NO ICON on iOS, silently,
// for the whole life of the declaration. (Two of those four have since been
// renamed for the library owning their GType — `AdwIcon` is `GtkImage`,
// `AdwMenuButton` is `GtkMenuButton`, ADR 0034 — and the names are kept as
// written because they are what the incident was measured on.) Nothing could have caught it — the
// package builds, type-checks and passes its suite on a platform it does not
// serve, because the suite runs on GJS and Node where neither variant loads.
//
// WHAT IT CAN AND CANNOT PROVE. It cannot prove a variant WORKS on a device —
// nothing in this repo can, there is no iOS CI. What it proves is narrower and
// still worth having: if a package platform-resolves a module at all, then every
// platform it CLAIMS has an implementation of that module. That is exactly the
// difference between "untested" and "absent", and it is the absent case that
// fails silently.
//
// WHY `portable`: it reads the package's own `gjsify.nativescriptPlatforms` and
// files under the package's own directory. No pillar taxonomy, no curated names.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';

/** The platform slots the NativeScript axis recognises (see `gjsify.runtimes`). */
const KNOWN_PLATFORMS = ['android', 'ios'];

/** Extensions the build's `platformResolvePlugin` considers for a variant. */
const VARIANT_EXTENSIONS = ['ts', 'tsx', 'mts', 'js', 'mjs'];

/**
 * Every `<base>.<platform>.<ext>` under `dir`, grouped by base module path.
 *
 * Only bases that HAVE at least one variant are returned: a package whose
 * modules are all platform-neutral makes no per-platform promise to check.
 * `foo.native.ts` is deliberately ignored — it is the "both platforms" form, so
 * its presence says nothing about any single platform.
 *
 * @param {string} dir
 * @param {Map<string, Set<string>>} [found]
 * @returns {Map<string, Set<string>>} base module path → set of platforms
 */
export function collectPlatformVariants(dir, found = new Map()) {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectPlatformVariants(full, found);
            continue;
        }
        const match = /^(.+)\.(android|ios)\.(ts|tsx|mts|js|mjs)$/.exec(entry.name);
        if (!match) continue;
        const base = join(dir, match[1]);
        if (!found.has(base)) found.set(base, new Set());
        found.get(base).add(match[2]);
    }
    return found;
}

/**
 * @param {import('../context.mjs').Context} ctx
 * @returns {{failures: string[], stats: Record<string, number>}}
 */
export function auditNativescriptPlatforms(ctx) {
    const failures = [];
    let declared = 0;
    let resolvedModules = 0;

    for (const pkg of ctx.packages) {
        const platforms = pkg.manifest.gjsify?.nativescriptPlatforms;
        if (platforms === undefined) continue;
        declared++;

        if (!Array.isArray(platforms) || platforms.length === 0) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nativescriptPlatforms\` must be a non-empty array of ` +
                    `${KNOWN_PLATFORMS.map((p) => `\`${p}\``).join('/')} (got ${
                        Array.isArray(platforms) ? 'an empty array' : typeof platforms
                    }). Omit the key entirely to mean "both".`,
            );
            continue;
        }

        const unknown = platforms.filter((p) => !KNOWN_PLATFORMS.includes(p));
        if (unknown.length > 0) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nativescriptPlatforms\` names ${unknown
                    .map((p) => `\`${p}\``)
                    .join(', ')}, which the NativeScript axis does not have. Known: ` +
                    `${KNOWN_PLATFORMS.map((p) => `\`${p}\``).join(', ')}.`,
            );
            continue;
        }

        // The NS slot has to actually be served, or the platform subset narrows
        // nothing and the declaration is noise.
        if (pkg.manifest.gjsify?.runtimes?.nativescript === 'none') {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nativescriptPlatforms\` narrows a slot this package does not ` +
                    `serve — \`gjsify.runtimes.nativescript\` is "none". Drop one or the other.`,
            );
            continue;
        }

        const srcDir = join(pkg.dir, 'src');
        const variants = collectPlatformVariants(existsSync(srcDir) ? srcDir : pkg.dir);
        for (const [base, present] of variants) {
            resolvedModules++;
            const missing = platforms.filter((p) => !present.has(p));
            if (missing.length === 0) continue;
            const rel = base.slice(pkg.dir.length + 1);
            const has = [...present].sort().join(', ');
            failures.push(
                `${pkg.rel}: \`${rel}\` is platform-resolved (it ships ${has}) but has no ` +
                    `${missing.map((p) => `\`${rel}.${p}.${VARIANT_EXTENSIONS[0]}\``).join(' / ')}, while ` +
                    `\`gjsify.nativescriptPlatforms\` declares ${missing.map((p) => `\`${p}\``).join(', ')}. The build ` +
                    `resolves \`${rel}.<platform>\` before \`${rel}\`, so on the declared platform it silently falls ` +
                    `back to the base module — which is how iOS shipped with every symbolic icon missing and nothing ` +
                    `failing. Implement the variant, or narrow the declaration.`,
            );
        }
    }

    return { failures, stats: { declared, resolvedModules } };
}

export const nativescriptPlatformsRule = defineRule({
    id: 'nativescript-platforms',
    scope: 'portable',
    fields: ['gjsify.nativescriptPlatforms'],
    description: 'every declared NativeScript platform has a variant for each platform-resolved module',
    run(ctx) {
        const { failures, stats } = auditNativescriptPlatforms(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'nativescript-platforms: no package declares `gjsify.nativescriptPlatforms`'
                    : `nativescript-platforms: ${stats.declared} declaration(s), ${stats.resolvedModules} ` +
                      `platform-resolved module(s) checked`,
        };
    },
});
