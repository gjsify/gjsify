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

    /* Phase B.3 — nested-protocol externs. */

    [CCode (cname = "gjsify_rolldown_glue_session_context_resolve",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern uint64 _glue_session_context_resolve (BundleSessionHandle session,
                                                         uint64 parent_req_id,
                                                         GLib.Bytes args_json);

    [CCode (cname = "gjsify_rolldown_glue_session_context_warn",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern void _glue_session_context_warn (BundleSessionHandle session,
                                                    GLib.Bytes message);

    [CCode (cname = "gjsify_rolldown_session_context_response_fd",
            cheader_filename = "gjsify-rolldown.h")]
    private extern int _session_context_response_fd (BundleSessionHandle session);

    [CCode (cname = "gjsify_rolldown_glue_session_next_context_response",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern GLib.Bytes? _glue_session_next_context_response (BundleSessionHandle session);

    /* Phase B.4 — bytes-payload side-channel externs. */

    [CCode (cname = "gjsify_rolldown_glue_session_take_request_payload",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern GLib.Bytes? _glue_session_take_request_payload (BundleSessionHandle session,
                                                                   uint64 req_id);

    [CCode (cname = "gjsify_rolldown_glue_session_set_response_payload",
            cheader_filename = "gjsify-rolldown-glue.h")]
    private extern bool _glue_session_set_response_payload (BundleSessionHandle session,
                                                            uint64 req_id,
                                                            GLib.Bytes bytes);

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
        private uint _ctx_response_source_id = 0;

        /**
         * Emitted whenever rolldown invokes a plugin hook.
         *
         * @hook_name: one of `load`, `transform`, `resolveId`,
         *             `renderChunk`, `banner`, `footer`, `intro`,
         *             `outro`, `buildStart`, `buildEnd`,
         *             `generateBundle`, `writeBundle`, `closeBundle`
         * @req_id: opaque ID; pass back to `respond()` exactly once
         * @plugin_index: position in the user's `plugins[]` array
         *                that originally registered this hook
         * @args_json: full request envelope as JSON. Shape depends on
         *             the hook — see `HookRequestPayload` in
         *             `src/rust/src/plugin_proxy.rs`.
         *
         * JS handler MUST eventually call `respond(req_id, json)`
         * exactly once with one of:
         *   `{"kind":"skip"}`  — chain to next plugin
         *   `{"kind":"ok", "value": ...}`  — handler succeeded
         *   `{"kind":"error", "message": "...", "stack": "..."}`
         *
         * Failure to respond within 60s aborts the build with a
         * timeout error.
         */
        public signal void hook_requested (string hook_name,
                                           uint64 req_id,
                                           uint plugin_index,
                                           GLib.Bytes args_json);

        /** Emitted when the bundle completes successfully. */
        public signal void completed (GLib.Bytes output_json);

        /** Emitted on any pipeline failure. */
        public signal void error_occurred (string message);

        /**
         * Phase B.3 — emitted whenever a context-resolve sub-result
         * (initiated via `context_resolve()`) is ready. JS handler
         * matches `child_id` against the value previously returned
         * from `context_resolve()`, parses `response_json` as
         * `{childId, id?, external?, error?}`.
         */
        public signal void context_response (uint64 child_id, GLib.Bytes response_json);

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

            int ctx_fd = _session_context_response_fd (_handle);
            var ctx_chan = new GLib.IOChannel.unix_new (ctx_fd);
            ctx_chan.set_close_on_unref (false);
            ctx_chan.set_encoding (null);
            ctx_chan.set_buffered (false);
            _ctx_response_source_id = ctx_chan.add_watch (GLib.IOCondition.IN, on_ctx_response_ready);
        }

        private bool on_ctx_response_ready (GLib.IOChannel source, GLib.IOCondition cond) {
            char[] sink = new char[8];
            try {
                size_t got;
                source.read_chars (sink, out got);
            } catch (Error e) {
                // ignore — eventfd had nothing left
            }

            while (_handle != null) {
                var resp_bytes = _glue_session_next_context_response (_handle);
                if (resp_bytes == null) break;

                // Peek at childId so the C signal handler can route by it
                // without re-parsing the JSON in JS.
                unowned uint8[]? data = resp_bytes.get_data ();
                ssize_t len = (ssize_t) resp_bytes.get_size ();
                uint64 child_id = 0;
                try {
                    var parser = new Json.Parser ();
                    parser.load_from_data ((string) data, len);
                    child_id = (uint64) parser.get_root ().get_object ().get_int_member ("childId");
                } catch (Error e) {
                    error_occurred ("rolldown: malformed context_response from Rust: %s".printf (e.message));
                    continue;
                }
                context_response (child_id, resp_bytes);
            }
            return true;
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

            // Generic dispatch — JS-side adapter routes by hook name.
            // Validates that hook is one of the known names; unknown
            // names indicate a Rust/Vala desync and are surfaced as
            // build errors rather than silently accepted.
            switch (hook) {
                case "load":
                case "transform":
                case "resolveId":
                case "renderChunk":
                case "banner":
                case "footer":
                case "intro":
                case "outro":
                case "buildStart":
                case "buildEnd":
                case "generateBundle":
                case "writeBundle":
                case "closeBundle":
                    hook_requested (hook, req_id, plugin_index, req_bytes);
                    break;
                default:
                    error_occurred ("rolldown: unknown hook '%s' from Rust side".printf (hook));
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
            if (_ctx_response_source_id != 0) {
                GLib.Source.remove (_ctx_response_source_id);
                _ctx_response_source_id = 0;
            }
        }

        public void respond (uint64 req_id, GLib.Bytes response_json) {
            if (_handle == null) return;
            _glue_session_respond (_handle, req_id, response_json);
        }

        /**
         * Phase B.3 — trigger `ctx.resolve()` on behalf of the JS
         * plugin handler currently running for `parent_req_id`.
         * Returns a child request ID that JS uses to match the
         * eventual `context_response(child_id, ...)` signal.
         * Returns 0 if `parent_req_id` is unknown (parent already
         * completed, or JS called outside a handler).
         */
        public uint64 context_resolve (uint64 parent_req_id, GLib.Bytes args_json) {
            if (_handle == null) return 0;
            return _glue_session_context_resolve (_handle, parent_req_id, args_json);
        }

        /** Phase B.3 — append a `this.warn(msg)` string to the build's
         *  warnings list. */
        public void context_warn (GLib.Bytes message) {
            if (_handle == null) return;
            _glue_session_context_warn (_handle, message);
        }

        /**
         * Phase B.4 — drain the request-payload bytes Rust stashed for
         * `req_id` (currently only the transform hook's source code).
         * Returns null when there's no stashed payload (e.g. the hook
         * is not transform, or the slot was already taken).
         */
        public GLib.Bytes? take_request_payload (uint64 req_id) {
            if (_handle == null) return null;
            return _glue_session_take_request_payload (_handle, req_id);
        }

        /**
         * Phase B.4 — stash bytes for Rust to consume after `respond()`.
         * Used by the transform hook to return the new code without
         * round-tripping through a JSON-encoded string.
         */
        public bool set_response_payload (uint64 req_id, GLib.Bytes bytes) {
            if (_handle == null) return false;
            return _glue_session_set_response_payload (_handle, req_id, bytes);
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
