// Wrap `.css` imports as JS string default exports.
//
// Rolldown's experimental CSS bundling was removed (see
// https://github.com/rolldown/rolldown/issues/4271) — when the bundler
// sees a `.css` extension it errors out unless something else loads the
// file first. We hook into `load` (with a path filter) BEFORE Rolldown's
// CSS classification fires and emit a JS module whose default export is
// the CSS source as a string. Consumers can then do:
//
//   import css from './app.css';
//   provider.load_from_string(css);
//
// — the canonical pattern for `Gtk.CssProvider` under GJS.
//
// `@import` resolution + nesting/modern-syntax lowering are handled via
// lightningcss `bundleAsync`. The defaults work for the common case
// (resolve `@import`s, no targeting); the `--app gjs` orchestrator passes
// `targets: { firefox: 60 << 16 }` so nesting + modern selectors get
// flattened to GTK4-CSS-engine-compatible output. Targeting is opt-in —
// a missing `targets` keeps the source pristine.
//
// `lightningcss` is a regular dependency of this package; the plugin
// imports it lazily so missing-arch installs surface the underlying
// load error instead of crashing every gjsify build.

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

export interface CssAsStringOptions {
    /**
     * lightningcss browser targets passed to `bundleAsync`. When set,
     * nesting + modern syntax are lowered for the given engines. The
     * GJS orchestrator defaults this to `{ firefox: 60 << 16 }` to
     * match the GTK4 CSS parser. Omit or leave undefined to skip
     * lowering (output stays as-authored except for `@import` inlining).
     */
    targets?: import('lightningcss').Targets;
    /**
     * When true (default), `@import` statements are resolved by
     * lightningcss `bundleAsync`. Set false to fall back to a plain
     * `readFile` — useful only when you want to keep `@import` strings
     * verbatim in the bundled JS (rare).
     */
    bundle?: boolean;
}

export function cssAsStringPlugin(options: CssAsStringOptions = {}): Plugin {
    const { targets, bundle = true } = options;
    return {
        name: 'gjsify-css-as-string',
        load: {
            filter: { id: /\.css$/ },
            async handler(id: string) {
                const code = bundle
                    ? new TextDecoder('utf-8').decode(await loadAndBundleCss(id, targets))
                    : await readFile(id, 'utf8');
                return {
                    code: `export default ${JSON.stringify(code)};`,
                    moduleType: 'js' as const,
                };
            },
        },
    };
}

async function loadAndBundleCss(
    filename: string,
    targets: import('lightningcss').Targets | undefined,
): Promise<Uint8Array> {
    const { bundleAsync } = await import('lightningcss');
    const result = await bundleAsync({
        filename,
        targets,
        minify: false,
        errorRecovery: true,
    });
    return result.code;
}
