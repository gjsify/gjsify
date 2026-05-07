// Wrap `.css` imports as JS string default exports.
//
// Replaces the recursive `esbuild.build()` sub-build pattern from
// `@gjsify/esbuild-plugin-css`. Rolldown's native CSS pipeline + Lightning
// CSS (configured via the parent factory's `transform.targets`) handle
// `@import` resolution and asset inlining; this plugin only converts the
// resolved CSS into a JS module so consumers can do:
//
//   import css from './app.css';
//   provider.load_from_string(css);
//
// — the canonical pattern for `Gtk.CssProvider` under GJS.

import type { Plugin } from 'rolldown';

export function cssAsStringPlugin(): Plugin {
    return {
        name: 'gjsify-css-as-string',
        transform: {
            order: 'post' as const,
            filter: { id: /\.css$/ },
            handler(code) {
                return { code: `export default ${JSON.stringify(code)};`, map: null };
            },
        },
    };
}
