// Generic "load file as JS string / data-URL default export" plugin.
//
// Mirrors `css-as-string` but lets the user opt-in arbitrary extensions
// through `gjsify.loaders` config, e.g.:
//
//   "loaders": { ".ui": "text", ".asm": "text", ".glsl": "text", ".png": "dataurl" }
//
// — replaces the esbuild `loader: { '.ui': 'text', '.png': 'dataurl' }` shorthand
// from the pre-Rolldown era. Rolldown does not classify unknown extensions as text
// by default; without a hook it tries to parse them as JS and fails.
//
// Loader kinds:
//   'text'    — file contents as a JS string default export
//               (`export default "…source…"`)
//   'dataurl' — file encoded as a data: URL string default export
//               (`export default "data:<mime>;base64,<b64>"`)
//               MIME is inferred from the file extension; falls back to
//               `application/octet-stream` for unknown extensions.
//               Useful for Excalibur's `ImageSource` constructor and similar
//               libraries that want a data: URL rather than a separate asset.

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

/** Loader kind values accepted under `gjsify.loaders`. */
export type LoaderKind = 'text' | 'dataurl';

export interface TextLoaderPluginOptions {
    /**
     * Map of file extension (with leading `.`) → loader kind.
     *   `'text'`    — file contents as JS string default export.
     *   `'dataurl'` — `data:<mime>;base64,<b64>` string default export.
     *                 MIME inferred from extension (.png → image/png etc.).
     */
    loaders?: Record<string, LoaderKind>;
}

/** MIME type lookup for common binary / shader formats. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.wasm': 'application/wasm',
};

function mimeForExtension(ext: string): string {
    return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function textLoaderPlugin(options: TextLoaderPluginOptions = {}): Plugin | null {
    const loaders = options.loaders ?? {};
    const entries = Object.entries(loaders);

    const textExts = entries.filter(([, kind]) => kind === 'text').map(([ext]) => ext);
    const dataurlExts = entries.filter(([, kind]) => kind === 'dataurl').map(([ext]) => ext);

    const allExts = [...textExts, ...dataurlExts];
    if (allExts.length === 0) return null;

    // Build a single regex matching any of the configured extensions:
    //   ['.ui', '.asm', '.png'] → /\.(ui|asm|png)$/
    const escaped = allExts.map((e) => e.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const filter = new RegExp(`\\.(?:${escaped.join('|')})$`);

    // Index extensions → kind for fast lookup in the load hook.
    const kindMap = new Map<string, LoaderKind>(
        entries.map(([ext, kind]) => [ext.toLowerCase(), kind]),
    );

    // Use the function-form `load(id)` (Rollup-compatible) rather than the
    // newer `load: { filter, handler }` shape. The newer shape was observed
    // not to claim unknown-extension files reliably under Rolldown rc.18 —
    // Rolldown's parser ran BEFORE the filtered handler fired and rejected
    // `.ui`/`.asm` content as invalid JS/JSX. Using the function form (same
    // as `@gjsify/vite-plugin-blueprint`'s `.blp` hook) intercepts during
    // module-load lookup and works under both Vite and Rolldown.
    return {
        name: 'gjsify-asset-loader',
        async load(id: string) {
            if (!filter.test(id)) return null;

            // Determine the extension (lowercase, with leading dot).
            const dotIdx = id.lastIndexOf('.');
            const ext = dotIdx >= 0 ? id.slice(dotIdx).toLowerCase() : '';
            const kind = kindMap.get(ext) ?? 'text';

            if (kind === 'dataurl') {
                const bytes = await readFile(id);
                const mime = mimeForExtension(ext);
                const b64 = bytes.toString('base64');
                return {
                    code: `export default ${JSON.stringify(`data:${mime};base64,${b64}`)};`,
                    moduleType: 'js' as const,
                };
            }

            // kind === 'text'
            const code = await readFile(id, 'utf8');
            return {
                code: `export default ${JSON.stringify(code)};`,
                moduleType: 'js' as const,
            };
        },
    };
}
