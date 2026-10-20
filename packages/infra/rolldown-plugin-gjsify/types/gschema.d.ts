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
