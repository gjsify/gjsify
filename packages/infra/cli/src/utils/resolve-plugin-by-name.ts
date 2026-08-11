// Resolve `bundler.plugins` entries that are specified by package name in
// the user's gjsify config, e.g.:
//
//   "bundler": {
//     "plugins": [
//       { "name": "@gjsify/vite-plugin-blueprint", "options": { "minify": true } },
//       { "name": "@gjsify/vite-plugin-gettext", "export": "msgfmtPlugin", "options": { ... } }
//     ]
//   }
//
// Lets `package.json#gjsify` describe the full plugin chain without dropping to a JS-form config
// file (`gjsify.config.mjs`). Resolution is anchored at the project root, so the project's own
// `node_modules` wins over the CLI's dependencies.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RolldownPluginOption } from 'rolldown';

/** User-supplied entry: a package name + optional named export and options. */
export interface PluginByName {
    name: string;
    /** Named export to invoke. Defaults to the module's default export. */
    export?: string;
    /** Options forwarded to the plugin factory. */
    options?: unknown;
}

/**
 * Strategy for turning a resolved plugin file path into its module namespace.
 *
 * A plain dynamic `import()` on Node, but under GJS it cannot be: GJS's native ESM loader does not
 * follow npm `package.json#exports` subpath maps for bare specifiers, so a plugin whose source
 * does `import … from '@scope/pkg/internal-subpath'` throws `Module not found` even with the file
 * on disk. The CLI injects a GJS strategy that first bundles the plugin to one self-contained ESM
 * file (Rolldown resolves the exports map at bundle time), then imports that — see
 * `BuildAction.loadPluginViaGjsBundle`.
 */
export type LoadPluginModule = (resolvedPath: string, pluginName: string) => Promise<Record<string, unknown>>;

export interface ResolveUserPluginsOptions {
    /** Defaults to a direct dynamic `import()`, which is correct on Node. */
    loadModule?: LoadPluginModule;
}

/** Default loader: a plain dynamic import of the resolved file URL (Node path). */
const defaultLoadModule: LoadPluginModule = async (resolvedPath) =>
    (await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>;

/** Type-guard: a `PluginByName` shape rather than a Rolldown plugin object. */
export function isPluginByName(value: unknown): value is PluginByName {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { name?: unknown }).name === 'string' &&
        // `name` alone does not discriminate — a real Rolldown plugin has it too — so the
        // absence of every plugin-shape hook is what separates the two.
        !('apply' in value) &&
        !('resolveId' in value) &&
        !('load' in value) &&
        !('transform' in value) &&
        !('renderChunk' in value) &&
        !('generateBundle' in value)
    );
}

/**
 * Resolve a list of mixed user plugins, anchored at `projectDir`. Plugin objects pass through
 * unchanged; `PluginByName` entries are imported, instantiated with their `options`, and returned
 * in the same position. Throws when a name fails to resolve, the chosen export is not a function,
 * or the factory returns nothing.
 */
export async function resolveUserPlugins(
    plugins: ReadonlyArray<RolldownPluginOption | PluginByName>,
    projectDir: string,
    options: ResolveUserPluginsOptions = {},
): Promise<RolldownPluginOption[]> {
    const loadModule = options.loadModule ?? defaultLoadModule;
    const requireFromProject = createRequire(join(projectDir, 'package.json'));
    const out: RolldownPluginOption[] = [];

    for (const entry of plugins) {
        if (!isPluginByName(entry)) {
            out.push(entry as RolldownPluginOption);
            continue;
        }

        let resolvedPath: string;
        try {
            resolvedPath = requireFromProject.resolve(entry.name);
        } catch (err) {
            throw new Error(
                `gjsify config: failed to resolve plugin "${entry.name}" from ${projectDir}. ` +
                    `Add it to your project's dependencies, or pass a Plugin object directly. ` +
                    `(${(err as Error).message})`,
            );
        }

        const mod = await loadModule(resolvedPath, entry.name);
        const exportName = entry.export ?? 'default';
        const factory = mod[exportName];

        if (typeof factory !== 'function') {
            const available = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
            throw new Error(
                `gjsify config: plugin "${entry.name}" has no function export "${exportName}". ` +
                    `Available function exports: ${available.length ? available.join(', ') : '(none)'}.`,
            );
        }

        const plugin = await (factory as (opts?: unknown) => unknown)(entry.options);
        if (plugin === undefined || plugin === null) {
            throw new Error(
                `gjsify config: plugin "${entry.name}" factory returned ${plugin}. ` +
                    `Check the plugin's signature — it should return a Rolldown/Vite plugin object.`,
            );
        }
        out.push(plugin as RolldownPluginOption);
    }

    return out;
}
