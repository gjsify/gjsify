/**
 * `import bytes from './data/<app-id>.data.gresource.xml'` (ADR 0116 § 1): the loader in
 * `plugins/gresource.ts` compiles the descriptor with `glib-compile-resources` and the module's
 * default export is the compiled GResource, for `Gio.Resource.new_from_data(bytes)`.
 */
declare module '*.gresource.xml' {
    const bytes: Uint8Array;
    export default bytes;
}
