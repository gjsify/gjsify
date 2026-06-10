/*
 * GjsifyOxfmt — Vala wrapper around the Rust oxc-formatter cdylib.
 *
 * The real formatting pipeline lives in src/rust/ (compiled by meson via
 * cargo to libgjsify_oxfmt.so) and a tiny C glue file
 * (gjsify-oxfmt-glue.{h,c}) translates the malloc'd Rust struct into
 * GBytes + GError, which GJS handles natively.
 *
 * This Vala layer exposes the glue function as a GObject method that emits
 * to GIR/typelib, so JS can do:
 *
 *     import GjsifyOxfmt from "gi://GjsifyOxfmt?version=1.0";
 *     const fmt = new GjsifyOxfmt.Formatter();
 *     const out = fmt.format("file.ts", input);   // GLib.Bytes
 *
 * Pattern: same as @gjsify/lightningcss-native — Rust/C ownership stays in
 * native land via GLib.Bytes; SpiderMonkey only sees refcounted handles.
 */

namespace GjsifyOxfmt {

    [CCode (cname = "gjsify_oxfmt_glue_format",
            cheader_filename = "gjsify-oxfmt-glue.h")]
    private extern GLib.Bytes? _glue_format (string? filename,
                                             GLib.Bytes code) throws GLib.Error;

    [CCode (cname = "gjsify_oxfmt_glue_run",
            cheader_filename = "gjsify-oxfmt-glue.h")]
    private extern int _glue_run (string[] args);

    /**
     * Formatter — stateless one-shot oxc formatter.
     *
     * Each call parses the source on the Rust side (typed from the
     * filename's extension, TypeScript by default) and prints it back
     * through oxc_formatter (Prettier-compatible). Only the native
     * JS/TS/JSX path is wrapped — embedded CSS/HTML/Markdown formatting
     * (oxfmt's Prettier-NAPI ExternalFormatter) is out of scope.
     */
    public class Formatter : GLib.Object {

        /**
         * format:
         * @filename: logical filename; its extension selects JS/TS/JSX
         *            (may be null → treated as TypeScript)
         * @code: input source bytes (UTF-8)
         *
         * Returns: (transfer full): formatted source as GLib.Bytes.
         * Throws GjsifyOxfmtError.FAILED on a fatal parse/print error.
         */
        public GLib.Bytes format (string? filename,
                                  GLib.Bytes code) throws GLib.Error {
            var bytes = _glue_format (filename, code);
            if (bytes == null)
                throw new GLib.Error (GLib.Quark.from_string ("gjsify-oxfmt-error-quark"),
                                      0, "oxfmt: unknown error (NULL result without GError)");
            return bytes;
        }

        /**
         * run:
         * @args: CLI arguments WITHOUT the program name
         *        (`process.argv.slice(2)` shaped) — e.g.
         *        `["--check", "--config", "/abs/.oxfmtrc.json", "src"]`
         *
         * Runs the full oxfmt CLI in-process: `.oxfmtrc(.json)` +
         * `.editorconfig` resolution, ignore handling, parallel file
         * walking, `--write` / `--check` / `--list-different` modes.
         * Reports to stdout/stderr exactly like the `oxfmt` binary.
         * Working directory = the current process working directory.
         *
         * Returns: the process exit code (0 = success, 1 = config error or
         *          `--check` mismatch, 2 = no files found / format failed).
         */
        public int run (string[] args) {
            return _glue_run (args);
        }
    }
}
