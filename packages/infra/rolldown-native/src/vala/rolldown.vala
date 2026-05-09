/*
 * GjsifyRolldown — Vala wrapper around the Rust rolldown cdylib.
 *
 * Mirrors the @gjsify/lightningcss-native pattern. The real bundler
 * lives in src/rust/ (compiled by meson via cargo to libgjsify_rolldown.so);
 * a tiny C glue file translates the Rust result struct into GBytes +
 * GError; this Vala layer just exposes a GObject method emitting to
 * GIR/typelib so JS can do:
 *
 *     import GjsifyRolldown from "gi://GjsifyRolldown?version=1.0";
 *     const bundler = new GjsifyRolldown.Bundler();
 *     const optsBytes = GLib.Bytes.new(new TextEncoder().encode(JSON.stringify({...})));
 *     const out = bundler.bundle(optsBytes);
 *     const result = JSON.parse(new TextDecoder().decode(out.get_data()));
 *
 * POC scope: no JS plugins, no watch mode. Each call constructs a
 * fresh rolldown Bundler and runs generate() on a current-thread
 * tokio runtime — sync from the JS view, no thread leaks on exit.
 */

namespace GjsifyRolldown {

    [CCode (cname = "gjsify_rolldown_glue_bundle",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern GLib.Bytes? _glue_bundle (GLib.Bytes options_json) throws GLib.Error;

    /**
     * Bundler — stateless one-shot bundle pipeline.
     *
     * Each `bundle()` call constructs a fresh `rolldown::Bundler` on
     * the Rust side, drives `Bundler::generate()` to completion on a
     * per-call current-thread tokio runtime, and returns the chunk +
     * asset list as JSON (matching rolldown's serde shape).
     */
    public class Bundler : GLib.Object {

        /**
         * bundle:
         * @options_json: UTF-8 JSON document matching rolldown's
         *                BundlerOptions serde shape (camelCase).
         *
         * Returns: (transfer full): output JSON as GLib.Bytes. The JSON
         * matches the BundleOutputJson shape declared in
         * src/rust/src/lib.rs: `{ warnings: string[], output:
         * (Chunk|Asset)[] }`.
         *
         * Throws GjsifyRolldownError.FAILED on any pipeline error.
         */
        public GLib.Bytes bundle (GLib.Bytes options_json) throws GLib.Error {
            var bytes = _glue_bundle (options_json);
            if (bytes == null)
                throw new GLib.Error (GLib.Quark.from_string ("gjsify-rolldown-error-quark"),
                                      0, "rolldown: unknown error (NULL result without GError)");
            return bytes;
        }
    }
}
