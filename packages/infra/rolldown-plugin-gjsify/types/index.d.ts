/**
 * `import bytes from './data/<app-id>.data.gresource.xml'` (ADR 0116 § 1): the loader in
 * `plugins/gresource.ts` compiles the descriptor with `glib-compile-resources` and the module's
 * default export is the compiled GResource, for `Gio.Resource.new_from_data(bytes)`.
 */
declare module '*.gresource.xml' {
    const bytes: Uint8Array;
    export default bytes;
}

/**
 * `import './<app-id>.gschema.xml?schema'` (ADR 0099 § 1): on the browser and NativeScript the
 * loader in `plugins/gschema.ts` parses the schema at build time and registers it with the
 * `Gio.Settings` subset; on GJS and Node the import is the file's path and GSettings reads the
 * compiled schema.
 */
declare module '*.gschema.xml?schema' {
    const schema: unknown;
    export default schema;
}

/**
 * `import css from './style.css'` — and `.scss`/`.sass`, which `plugins/css-as-string.ts`
 * compiles to flat CSS first. That plugin's `load` hook runs before the CSS classification
 * Rolldown no longer has, and the emitted module's default export is the stylesheet source,
 * which is what `Gtk.CssProvider` wants: `provider.load_from_string(css)`. Without this
 * declaration every stylesheet import failed `check` with TS2307 and each project shipped its
 * own `src/css.d.ts` to say the same thing.
 *
 * Import the VALUE and apply it. A bare `import './x.css'` reaches a module whose only effect
 * is that default export, so it tree-shakes away at exit 0 — the reason
 * `gjsify/no-css-side-effect-import` exists.
 */
declare module '*.css' {
    const css: string;
    export default css;
}

declare module '*.scss' {
    const css: string;
    export default css;
}

declare module '*.sass' {
    const css: string;
    export default css;
}
