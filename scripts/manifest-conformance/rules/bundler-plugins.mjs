/**
 * Rule `bundler-plugins` — REPO-SCOPED. `gjsify.bundler.plugins` lets a package name
 * its build's plugin chain by PACKAGE NAME instead of dropping to a JS-form config
 * file, and that name is a promise with an on-disk counterpart: it has to resolve from
 * the declaring package, and the export it picks has to be a function that returns a
 * plugin.
 *
 * WHY THIS IS WORTH A RULE AND NOT A LEDGER ENTRY. The failure is silent in the
 * direction that matters. `resolveUserPlugins` throws on an unresolvable name, so a
 * TYPO fails loudly at build time — but a plugin the declaration forgot to depend on
 * resolves anyway while the monorepo hoists it to the root `node_modules`, and stops
 * resolving the moment the package is consumed from npm. That is a declaration that is
 * true in the tree and false everywhere else, which is exactly the shape
 * `field-coverage` exists to refuse.
 *
 * WHAT IT CHECKS
 *
 *   - every `{ name }` entry resolves from the DECLARING package's directory, not from
 *     the repo root — the same anchor `resolveUserPlugins` uses;
 *   - a workspace-local `@gjsify/*` plugin is DECLARED as a dependency of that package
 *     (any of the three dependency kinds), so the hoist cannot stand in for it;
 *   - the chosen export (`export`, else `default`) exists and is a function.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK, and why the claim is still honest: the rest of
 * `gjsify.bundler` — `output`, `minify`, `externals`, `loaders`, `defines` — is bundler
 * INPUT. There is no artifact on disk that could contradict `minify: false`, and the
 * one thing that could (the emitted bundle) is already the subject of
 * `verify-package-outputs` and the gjs/node bundle guards. `plugins` is the only
 * sub-key that names something which must EXIST.
 *
 * Repo-scoped because the dependency half is unanswerable from a published tarball: a
 * consumer installs the package without its devDependencies, so "declared as a
 * dependency" would report failures for a correct install.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** The three dependency kinds a plugin may legitimately be declared under. */
const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** `true` for a `{ name }` entry rather than an inline plugin object. */
function isPluginByName(entry) {
    return typeof entry === 'object' && entry !== null && typeof entry.name === 'string';
}

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export async function auditBundlerPlugins(ctx) {
    const failures = [];
    let declaring = 0;
    let checked = 0;

    for (const pkg of ctx.packages) {
        const plugins = pkg.gjsify?.bundler?.plugins;
        if (!Array.isArray(plugins) || plugins.length === 0) continue;
        declaring += 1;

        const requireFromPkg = createRequire(join(pkg.dir, 'package.json'));

        for (const entry of plugins) {
            if (!isPluginByName(entry)) continue;
            checked += 1;
            const { name } = entry;
            const exportName = entry.export ?? 'default';

            // A relative entry is a path into the package's own tree; nothing to
            // declare and nothing to hoist, so only resolution applies.
            const relative = name.startsWith('.');
            if (!relative) {
                const declared = DEPENDENCY_KINDS.some((kind) => pkg.manifest?.[kind]?.[name]);
                if (!declared) {
                    failures.push(
                        `${pkg.name} declares gjsify.bundler.plugins["${name}"] but lists it in none of ` +
                            `${DEPENDENCY_KINDS.join('/')}. It resolves here only because the workspace hoists it; ` +
                            `installed from npm the build fails on an unresolvable plugin.`,
                    );
                }
            }

            let resolved;
            try {
                resolved = requireFromPkg.resolve(name);
            } catch (error) {
                failures.push(
                    `${pkg.name} declares gjsify.bundler.plugins["${name}"], which does not resolve from ` +
                        `${pkg.rel} (${error.message}).`,
                );
                continue;
            }

            let mod;
            try {
                mod = await import(pathToFileURL(resolved).href);
            } catch (error) {
                failures.push(
                    `${pkg.name}'s plugin "${name}" resolves to ${resolved} but cannot be imported ` +
                        `(${error.message}). A plugin that cannot load is a build that cannot start.`,
                );
                continue;
            }

            if (typeof mod[exportName] !== 'function') {
                const available = Object.keys(mod).filter((key) => typeof mod[key] === 'function');
                failures.push(
                    `${pkg.name}'s plugin "${name}" has no function export "${exportName}". Available: ` +
                        `${available.length > 0 ? available.join(', ') : '(none)'}.`,
                );
            }
        }
    }

    return { failures, stats: { declaring, plugins: checked } };
}

export const bundlerPluginsRule = defineRule({
    id: 'bundler-plugins',
    scope: 'repo',
    fields: ['gjsify.bundler'],
    description: 'every plugin named in `gjsify.bundler.plugins` is declared as a dependency and resolves',
    async run(ctx) {
        const { failures, stats } = await auditBundlerPlugins(ctx);
        return {
            failures,
            stats,
            summary:
                `bundler-plugins: ${stats.plugins} named plugin(s) across ${stats.declaring} package(s) resolve ` +
                `and export a factory`,
        };
    },
});
