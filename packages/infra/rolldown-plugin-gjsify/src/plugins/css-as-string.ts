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
// `@import` resolution is left to the user / CSS preprocessor. For simple
// app CSS this is fine; for @import-heavy CSS, run a preprocessor (e.g.
// sass / postcss) ahead of `gjsify build` so the input file is already
// flat.

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

export function cssAsStringPlugin(): Plugin {
    return {
        name: 'gjsify-css-as-string',
        load: {
            filter: { id: /\.css$/ },
            async handler(id: string) {
                const code = await readFile(id, 'utf8');
                return {
                    code: `export default ${JSON.stringify(code)};`,
                    moduleType: 'js' as const,
                };
            },
        },
    };
}
