/**
 * Hand-written ambient module for the GjsifyRolldown-1.0 typelib.
 *
 * Minimal POC surface: one `Bundler` GObject with a single `bundle()`
 * method taking JSON-encoded options and returning JSON-encoded
 * BundleOutput. Detailed shape lives in the TS facade (src/ts/index.ts).
 */

declare module 'gi://GjsifyRolldown?version=1.0' {
  import type GLib from '@girs/glib-2.0';
  import type GObject from '@girs/gobject-2.0';

  export namespace GjsifyRolldown {
    /**
     * Bundler — stateless one-shot bundle pipeline. Each `bundle()`
     * call constructs a fresh `rolldown::Bundler` on the Rust side
     * and runs `generate()` to completion on a per-call current-thread
     * tokio runtime.
     */
    class Bundler extends GObject.Object {
      constructor(properties?: Partial<GObject.Object.ConstructorProperties>);
      static new(): Bundler;

      /**
       * @param options_json UTF-8 JSON document matching rolldown's
       *                     `BundlerOptions` serde shape (camelCase
       *                     keys; nested enums use rolldown's own
       *                     PascalCase variants — see the rolldown
       *                     docs).
       *
       * Returns the BundleOutput as JSON in a `GLib.Bytes`. Throws
       * `GError` (quark `gjsify-rolldown-error-quark`) on any pipeline
       * failure; the message contains the rolldown diagnostic.
       */
      bundle(options_json: GLib.Bytes): GLib.Bytes;
    }
  }

  const GjsifyRolldownDefault: typeof GjsifyRolldown;
  export default GjsifyRolldownDefault;
}
