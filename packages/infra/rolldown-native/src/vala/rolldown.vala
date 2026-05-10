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

    /* ------------------------------------------------------------- */
    /* Phase B.1+: plugin-callback bridge.                           */
    /* ------------------------------------------------------------- */

    [Compact]
    [CCode (cname = "BundleSession", free_function = "gjsify_rolldown_session_free", has_type_id = false)]
    private class BundleSessionHandle { }

    [CCode (cname = "gjsify_rolldown_glue_session_start",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern BundleSessionHandle? _glue_session_start (GLib.Bytes args_json) throws GLib.Error;

    [CCode (cname = "gjsify_rolldown_session_request_fd",
            cheader_filename = "gjsify-rolldown.h")]
    private extern int _session_request_fd (BundleSessionHandle session);

    [CCode (cname = "gjsify_rolldown_session_complete_fd",
            cheader_filename = "gjsify-rolldown.h")]
    private extern int _session_complete_fd (BundleSessionHandle session);

    [CCode (cname = "gjsify_rolldown_glue_session_next_request",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern GLib.Bytes? _glue_session_next_request (BundleSessionHandle session);

    [CCode (cname = "gjsify_rolldown_glue_session_respond",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern bool _glue_session_respond (BundleSessionHandle session,
                                               uint64 req_id,
                                               GLib.Bytes response_json);

    [CCode (cname = "gjsify_rolldown_glue_session_try_result",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern GLib.Bytes? _glue_session_try_result (BundleSessionHandle session) throws GLib.Error;

    [CCode (cname = "gjsify_rolldown_session_cancel",
            cheader_filename = "gjsify-rolldown.h")]
    private extern void _session_cancel (BundleSessionHandle session);

    /**
     * BundlerSession — long-lived bundle session that drives a
     * rolldown build asynchronously, emitting a GObject signal
     * each time a JS plugin hook needs to fire.
     *
     * Typical JS-side usage:
     *
     *   const session = new GjsifyRolldown.BundlerSession();
     *   session.connect('load_requested', (_, reqId, idx, args) => {
     *       const result = userPlugins[idx].load(decode(args).id);
     *       session.respond(reqId, encode(JSON.stringify(...)));
     *   });
     *   session.connect('completed', (_, output) => resolvePromise(output));
     *   session.connect('error_occurred', (_, msg) => rejectPromise(msg));
     *   session.start(argsJsonBytes);
     */
    public class BundlerSession : GLib.Object {
        private BundleSessionHandle? _handle = null;
        private uint _request_source_id = 0;
        private uint _complete_source_id = 0;

        /** Emitted when rolldown invokes a `load` hook on a JS plugin.
         *  JS handler MUST eventually call `respond(req_id, json)`. */
        public signal void load_requested (uint64 req_id, uint plugin_index, GLib.Bytes args_json);

        /** Emitted when the bundle completes successfully. */
        public signal void completed (GLib.Bytes output_json);

        /** Emitted on any pipeline failure. */
        public signal void error_occurred (string message);

        /**
         * Start the bundle session. @args_json must be a UTF-8 JSON
         * document of shape `{"options": <BundlerOptions>, "plugins":
         * [{"name": "...", "hooks": ["load", ...]}]}`.
         */
        public void start (GLib.Bytes args_json) throws GLib.Error {
            if (_handle != null)
                throw new GLib.Error (GLib.Quark.from_string ("gjsify-rolldown-error-quark"),
                                      0, "rolldown: BundlerSession.start() called twice");

            _handle = _glue_session_start (args_json);
            if (_handle == null)
                throw new GLib.Error (GLib.Quark.from_string ("gjsify-rolldown-error-quark"),
                                      0, "rolldown: session_start returned NULL without GError");

            int req_fd = _session_request_fd (_handle);
            int comp_fd = _session_complete_fd (_handle);

            // Watch the eventfds on the GLib main loop. add_full hands
            // the source priority + condition; we own the fd lifetime
            // via Rust, so don't pass close_fd:true.
            var req_chan = new GLib.IOChannel.unix_new (req_fd);
            req_chan.set_close_on_unref (false);
            req_chan.set_encoding (null);
            req_chan.set_buffered (false);
            _request_source_id = req_chan.add_watch (GLib.IOCondition.IN, on_request_ready);

            var comp_chan = new GLib.IOChannel.unix_new (comp_fd);
            comp_chan.set_close_on_unref (false);
            comp_chan.set_encoding (null);
            comp_chan.set_buffered (false);
            _complete_source_id = comp_chan.add_watch (GLib.IOCondition.IN, on_complete_ready);
        }

        private bool on_request_ready (GLib.IOChannel source, GLib.IOCondition cond) {
            // Drain the eventfd counter (best-effort; ignore errors).
            // Drain via posix read() — IOChannel.read_chars wants
            // `char[]` and Vala can't auto-convert from `uint8[]`.
            // The eventfd content is an opaque 8-byte counter; we
            // discard it (just need the wake-up).
            char[] sink = new char[8];
            try {
                size_t got;
                source.read_chars (sink, out got);
            } catch (Error e) {
                // EAGAIN-equivalent — eventfd had nothing left, fine.
            }

            // Pull all queued requests in this wake-up cycle.
            while (_handle != null) {
                var req_bytes = _glue_session_next_request (_handle);
                if (req_bytes == null) break;
                dispatch_request (req_bytes);
            }
            return true; // keep source alive
        }

        private void dispatch_request (GLib.Bytes req_bytes) {
            // Parse just enough to route. We don't want to fully
            // deserialize on the Vala side — JS does that. But we
            // need to peek at "hook" and "reqId" + "pluginIndex" to
            // emit the right signal.
            // GBytes is NOT NUL-terminated; pass the explicit length
            // to Json.Parser so it doesn't read past the buffer.
            unowned uint8[]? data = req_bytes.get_data ();
            ssize_t len = (ssize_t) req_bytes.get_size ();
            uint64 req_id = 0;
            uint plugin_index = 0;
            string hook = "";
            try {
                var parser = new Json.Parser ();
                parser.load_from_data ((string) data, len);
                var root = parser.get_root ().get_object ();
                req_id = (uint64) root.get_int_member ("reqId");
                plugin_index = (uint) root.get_int_member ("pluginIndex");
                hook = root.get_string_member ("hook");
            } catch (Error e) {
                error_occurred ("rolldown: malformed request from Rust: %s".printf (e.message));
                return;
            }

            switch (hook) {
                case "load":
                    load_requested (req_id, plugin_index, req_bytes);
                    break;
                default:
                    // Phase B.2 fans out to the remaining 11 hooks.
                    error_occurred ("rolldown: hook '%s' not yet supported in Phase B.1".printf (hook));
                    break;
            }
        }

        private bool on_complete_ready (GLib.IOChannel source, GLib.IOCondition cond) {
            char[] sink = new char[8];
            try {
                size_t got;
                source.read_chars (sink, out got);
            } catch (Error e) {
                // ignore
            }

            if (_handle == null) return false;
            try {
                var bytes = _glue_session_try_result (_handle);
                if (bytes != null) {
                    completed (bytes);
                    teardown_sources ();
                    return false;
                }
            } catch (Error e) {
                error_occurred (e.message);
                teardown_sources ();
                return false;
            }
            return true;
        }

        private void teardown_sources () {
            if (_request_source_id != 0) {
                GLib.Source.remove (_request_source_id);
                _request_source_id = 0;
            }
            if (_complete_source_id != 0) {
                GLib.Source.remove (_complete_source_id);
                _complete_source_id = 0;
            }
        }

        public void respond (uint64 req_id, GLib.Bytes response_json) {
            if (_handle == null) return;
            _glue_session_respond (_handle, req_id, response_json);
        }

        public void cancel () {
            if (_handle != null) _session_cancel (_handle);
        }

        public override void dispose () {
            teardown_sources ();
            cancel ();
            _handle = null; // Compact class auto-frees via free_function
            base.dispose ();
        }
    }
}
