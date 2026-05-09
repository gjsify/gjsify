/*
 * GjsifyLightningcss — Vala wrapper around the Rust lightningcss cdylib.
 *
 * The real CSS pipeline lives in src/rust/ (compiled by meson via cargo
 * to libgjsify_lightningcss.so) and a tiny C glue file
 * (gjsify-lightningcss-glue.{h,c}) translates the malloc'd Rust struct
 * into GBytes + GError, which GJS handles natively.
 *
 * This Vala layer just exposes the GLib-friendly glue function as a
 * GObject method that emits to GIR/typelib, so JS can do:
 *
 *     import GjsifyLightningcss from "gi://GjsifyLightningcss?version=1.0";
 *     const engine = new GjsifyLightningcss.Engine();
 *     const code = engine.transform("app.css", input, null, true, false, out null);
 *
 * Pattern: same as @gjsify/http2-native — Rust/C ownership stays in
 * native land via GLib.Bytes; SpiderMonkey only sees refcounted handles.
 */

namespace GjsifyLightningcss {

    [CCode (cname = "gjsify_lightningcss_glue_transform",
            cheader_filename = "gjsify-lightningcss-glue.h")]
    private extern GLib.Bytes? _glue_transform (string? filename,
                                                GLib.Bytes code,
                                                string? browserslist,
                                                bool minify,
                                                bool source_map,
                                                out GLib.Bytes? out_map) throws GLib.Error;

    /**
     * Engine — stateless one-shot CSS transform pipeline.
     *
     * Each call constructs a fresh lightningcss StyleSheet on the Rust
     * side, optionally lowers per browserslist targets, and prints back
     * to CSS (with optional minify + source map). Designed for the
     * @gjsify/rolldown-plugin-gjsify cssAsStringPlugin call site —
     * single-shot transforms, no plugin/composes/css-modules surface.
     */
    public class Engine : GLib.Object {

        /**
         * transform:
         * @filename: logical filename for diagnostics (may be null)
         * @code: input CSS bytes (UTF-8)
         * @browserslist: browserslist query, e.g. "firefox >= 60"; null
         *                disables targets-driven lowering
         * @minify: whitespace-strip + property/selector merging
         * @source_map: also produce a JSON source map
         * @out_source_map: (out)(transfer full)(nullable): JSON source
         *                  map, set only when @source_map was true
         *
         * Returns: (transfer full): output CSS as GLib.Bytes. Throws
         * GjsifyLightningcssError.FAILED on any pipeline error.
         */
        public GLib.Bytes transform (string? filename,
                                     GLib.Bytes code,
                                     string? browserslist,
                                     bool minify,
                                     bool source_map,
                                     out GLib.Bytes? out_source_map) throws GLib.Error {
            GLib.Bytes? map = null;
            var bytes = _glue_transform (filename, code, browserslist,
                                         minify, source_map, out map);
            out_source_map = map;
            if (bytes == null)
                throw new GLib.Error (GLib.Quark.from_string ("gjsify-lightningcss-error-quark"),
                                      0, "lightningcss: unknown error (NULL result without GError)");
            return bytes;
        }
    }
}
