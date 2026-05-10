/**
 * Hand-written ambient module for the GjsifyLightningcss-1.0 typelib.
 *
 * Auto-generated equivalent (via `yarn build:gir-types`) would mirror
 * the .gir produced by valac in build/GjsifyLightningcss-1.0.gir. We
 * keep this file hand-written for the POC because the surface is tiny
 * and it avoids a build-time dep on @ts-for-gir/cli.
 *
 * If/when we adopt automatic generation, this file becomes the output
 * of ts-for-gir and the comment block above gets replaced with the
 * standard "do not edit by hand" header.
 */

declare module 'gi://GjsifyLightningcss?version=1.0' {
  import type GLib from '@girs/glib-2.0';
  import type GObject from '@girs/gobject-2.0';

  export namespace GjsifyLightningcss {
    /**
     * Engine — stateless one-shot CSS transform pipeline. Each call
     * constructs a fresh lightningcss StyleSheet on the Rust side,
     * optionally lowers per browserslist targets, and prints back to
     * CSS (with optional minify + source map).
     */
    class Engine extends GObject.Object {
      constructor(properties?: Partial<GObject.Object.ConstructorProperties>);
      static new(): Engine;

      /**
       * @param filename     logical filename for diagnostics (may be null)
       * @param code         input CSS bytes (UTF-8)
       * @param browserslist browserslist query, e.g. "firefox >= 60";
       *                     null disables targets-driven lowering
       * @param minify       whitespace-strip + property/selector merging
       * @param source_map   also produce a JSON source map
       *
       * GJS surfaces the Vala out-param as a tuple:
       *   [outputCss: GLib.Bytes, sourceMapJson: GLib.Bytes | null]
       *
       * Throws GError on parse / transform / print failure.
       */
      transform(
        filename: string | null,
        code: GLib.Bytes,
        browserslist: string | null,
        minify: boolean,
        source_map: boolean,
      ): [GLib.Bytes, GLib.Bytes | null];

      /**
       * @param filename       entry CSS file path
       * @param browserslist   targets query (null = no lowering)
       * @param minify
       * @param source_map
       * @param error_recovery keep parsing after recoverable errors
       *                       (matches lightningcss `errorRecovery: true`)
       *
       * Returns: `[outputCss, sourceMapJson | null]`. Resolves
       * `@import` chains via lightningcss's filesystem-backed
       * FileProvider.
       */
      bundle(
        filename: string,
        browserslist: string | null,
        minify: boolean,
        source_map: boolean,
        error_recovery: boolean,
      ): [GLib.Bytes, GLib.Bytes | null];
    }
  }

  // Default export carrier for `import GjsifyLightningcss from 'gi://...'`.
  const GjsifyLightningcssDefault: typeof GjsifyLightningcss;
  export default GjsifyLightningcssDefault;
}
