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
// Lets `package.json#gjsify` describe the full plugin chain without dropping
// to a JS-form config file (`gjsify.config.mjs`). Resolution is anchored at
// the project root (where the config lives) so the project's own
// `node_modules` wins over the CLI's own dependencies.

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

/** Type-guard: a `PluginByName` shape rather than a Rolldown plugin object. */
export function isPluginByName(value: unknown): value is PluginByName {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { name?: unknown }).name === 'string' &&
        // RolldownPluginOption can be `false | null | undefined | Plugin | Promise<Plugin>`.
        // A real plugin always has a function-shape behavior; `name` alone is shared
        // with our shape, so we additionally require absence of plugin-shape fields.
        !('apply' in value) &&
        !('resolveId' in value) &&
        !('load' in value) &&
        !('transform' in value) &&
        !('renderChunk' in value) &&
        !('generateBundle' in value)
    );
}

/**
 * Resolve a list of mixed user plugins. Entries that are already plugin
 * objects pass through unchanged; entries shaped like `PluginByName` get
 * dynamically imported, instantiated with their `options`, and returned in
 * the same position. Resolution is anchored at `projectDir`.
 *
 * Throws when a name fails to resolve, when the chosen export is not a
 * function, or when the factory returns nothing.
 */
export async function resolveUserPlugins(
    plugins: ReadonlyArray<RolldownPluginOption | PluginByName>,
    projectDir: string,
): Promise<RolldownPluginOption[]> {
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

        const mod = await import(pathToFileURL(resolvedPath).href);
        const exportName = entry.export ?? 'default';
        const factory = (mod as Record<string, unknown>)[exportName];

        if (typeof factory !== 'function') {
            const available = Object.keys(mod).filter(
                (k) => typeof (mod as Record<string, unknown>)[k] === 'function',
            );
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
