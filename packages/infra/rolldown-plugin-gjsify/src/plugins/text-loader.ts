// Generic "load file as JS string default export" plugin.
//
// Mirrors `css-as-string` but lets the user opt-in arbitrary extensions
// through `bundler.loaders` config, e.g.:
//
//   "bundler": { "loaders": { ".ui": "text", ".asm": "text" } }
//
// — replaces the esbuild `loader: { '.ui': 'text' }` shorthand from the
// pre-Rolldown era. Rolldown does not classify unknown extensions as text
// by default; without a hook it tries to parse them as JS and fails.

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

export interface TextLoaderPluginOptions {
    /**
     * Map of file extension (with leading `.`) → loader kind. Currently only
     * `'text'` is implemented; the field is shaped this way to leave room
     * for `'json'` / `'binary'` later without a config break.
     */
    loaders?: Record<string, 'text'>;
}

export function textLoaderPlugin(options: TextLoaderPluginOptions = {}): Plugin | null {
    const exts = Object.entries(options.loaders ?? {})
        .filter(([, kind]) => kind === 'text')
        .map(([ext]) => ext);

    if (exts.length === 0) return null;

    // Build a single regex matching any of the configured extensions:
    //   ['.ui', '.asm'] → /\.(ui|asm)$/
    const escaped = exts.map((e) => e.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const filter = new RegExp(`\\.(?:${escaped.join('|')})$`);

    // Use the function-form `load(id)` (Rollup-compatible) rather than the
    // newer `load: { filter, handler }` shape. The newer shape was observed
    // not to claim unknown-extension files reliably under Rolldown rc.18 —
    // Rolldown's parser ran BEFORE the filtered handler fired and rejected
    // `.ui`/`.asm` content as invalid JS/JSX. Using the function form (same
    // as `@gjsify/vite-plugin-blueprint`'s `.blp` hook) intercepts during
    // module-load lookup and works under both Vite and Rolldown.
    return {
        name: 'gjsify-text-loader',
        async load(id: string) {
            if (!filter.test(id)) return null;
            const code = await readFile(id, 'utf8');
            return {
                code: `export default ${JSON.stringify(code)};`,
                moduleType: 'js' as const,
            };
        },
    };
}
