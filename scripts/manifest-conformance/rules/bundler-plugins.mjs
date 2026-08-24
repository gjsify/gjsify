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
 *   - a named plugin is DECLARED as a dependency of the package that configures it (any
 *     of the three dependency kinds), so the hoist cannot stand in for it;
 *   - a `workspace:` dependency names a package that exists in this workspace;
 *   - a relative entry points at a file that is on disk;
 *   - the chosen export (`export`, else `default`) exists and is a function — but only
 *     when the plugin's entry file is BUILT. See the note below.
 *
 * NO NODE RESOLUTION, AND THAT IS THE POINT. The first version called
 * `createRequire(...).resolve(name)` and `await import(...)`, which passed locally and
 * failed in CI on every leg: this job installs nothing and builds nothing, so the
 * plugin's `exports` target `lib/index.js` does not exist and resolution throws
 * `Cannot find module`. A rule that needs a build cannot run on every PR, which is the
 * whole reason the checks in this job are plain manifest reads. So the declaration half
 * — the half that is silently wrong — is checked from the manifests alone, and the
 * export half degrades to a NOTE when the entry is unbuilt. A note that says "not
 * checked" is honest; a failure that means "not built" is noise, and noise is how a
 * gate gets routed around.
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

import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** The three dependency kinds a plugin may legitimately be declared under. */
const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** `true` for a `{ name }` entry rather than an inline plugin object. */
function isPluginByName(entry) {
    return typeof entry === 'object' && entry !== null && typeof entry.name === 'string';
}

/**
 * The package's own default entry, from its manifest — `exports['.']` in either shape,
 * else `module`, else `main`. Deliberately not a resolver: this must answer without an
 * install, and the only question is which FILE the entry names.
 */
function defaultEntryOf(manifest) {
    const dot = manifest?.exports?.['.'];
    if (typeof dot === 'string') return dot;
    if (dot && typeof dot === 'object') {
        for (const key of ['default', 'import', 'node']) {
            if (typeof dot[key] === 'string') return dot[key];
        }
    }
    return manifest?.module ?? manifest?.main ?? null;
}

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export async function auditBundlerPlugins(ctx) {
    const failures = [];
    const notes = [];
    let declaring = 0;
    let checked = 0;
    let exportsChecked = 0;

    for (const pkg of ctx.packages) {
        const plugins = pkg.gjsify?.bundler?.plugins;
        if (!Array.isArray(plugins) || plugins.length === 0) continue;
        declaring += 1;

        for (const entry of plugins) {
            if (!isPluginByName(entry)) continue;
            checked += 1;
            const { name } = entry;
            const exportName = entry.export ?? 'default';

            // A relative entry is a path into the package's own tree: nothing to declare
            // and nothing to hoist, so existence is the whole promise.
            if (name.startsWith('.')) {
                if (!existsSync(resolvePath(pkg.dir, name))) {
                    failures.push(
                        `${pkg.name} declares gjsify.bundler.plugins["${name}"], and no such file exists under ` +
                            `${pkg.rel}.`,
                    );
                }
                continue;
            }

            const declaredRange = DEPENDENCY_KINDS.map((kind) => pkg.manifest?.[kind]?.[name]).find(Boolean);
            if (!declaredRange) {
                failures.push(
                    `${pkg.name} declares gjsify.bundler.plugins["${name}"] but lists it in none of ` +
                        `${DEPENDENCY_KINDS.join('/')}. It resolves here only because the workspace hoists it; ` +
                        `installed from npm the build fails on an unresolvable plugin.`,
                );
                continue;
            }

            const workspacePkg = ctx.byName.get(name);
            if (String(declaredRange).startsWith('workspace:') && !workspacePkg) {
                failures.push(
                    `${pkg.name} declares gjsify.bundler.plugins["${name}"] as a \`workspace:\` dependency, but no ` +
                        `package of that name exists in this workspace.`,
                );
                continue;
            }

            // The export half needs the plugin BUILT, and this job builds nothing.
            if (!workspacePkg) continue;
            const rel = defaultEntryOf(workspacePkg.manifest);
            if (!rel) {
                failures.push(
                    `${pkg.name}'s plugin "${name}" declares no default entry (no \`exports["."]\`, \`module\` or ` +
                        `\`main\`), so nothing can import it.`,
                );
                continue;
            }
            const entryFile = join(workspacePkg.dir, rel);
            if (!existsSync(entryFile)) {
                notes.push(
                    `"${name}" is unbuilt (${rel} absent), so its "${exportName}" export was not checked. The ` +
                        `declaration half above was.`,
                );
                continue;
            }

            let mod;
            try {
                mod = await import(pathToFileURL(entryFile).href);
            } catch (error) {
                failures.push(
                    `${pkg.name}'s plugin "${name}" has a built entry at ${rel} that cannot be imported ` +
                        `(${error.message}). A plugin that cannot load is a build that cannot start.`,
                );
                continue;
            }
            exportsChecked += 1;

            if (typeof mod[exportName] !== 'function') {
                const available = Object.keys(mod).filter((key) => typeof mod[key] === 'function');
                failures.push(
                    `${pkg.name}'s plugin "${name}" has no function export "${exportName}". Available: ` +
                        `${available.length > 0 ? available.join(', ') : '(none)'}.`,
                );
            }
        }
    }

    return { failures, notes, stats: { declaring, plugins: checked, exportsChecked } };
}

export const bundlerPluginsRule = defineRule({
    id: 'bundler-plugins',
    scope: 'repo',
    fields: ['gjsify.bundler'],
    description: 'every plugin named in `gjsify.bundler.plugins` is declared as a dependency and exists',
    async run(ctx) {
        const { failures, notes, stats } = await auditBundlerPlugins(ctx);
        return {
            failures,
            notes,
            stats,
            summary:
                `bundler-plugins: ${stats.plugins} named plugin(s) across ${stats.declaring} package(s) declared ` +
                `and present (${stats.exportsChecked} with a built entry, whose factory export was checked too)`,
        };
    },
});
