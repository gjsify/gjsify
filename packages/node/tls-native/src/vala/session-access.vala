/*
 * SessionAccess — POC scaffold for Phase 2 (TLS session resumption +
 * channel binding) of @gjsify/tls-native.
 *
 * Status
 * ──────
 * This class delivers the JS-visible *surface* (so `@gjsify/tls` can
 * wire `getFinished()` / `getPeerFinished()` / `getSession()` /
 * `setSession()` / `isSessionReused()` and the `'session'` event into
 * `TLSSocket` with proper typings and consistent error semantics), but
 * the actual GnuTLS interactions throw a clear "not supported" error
 * pending the GIO-internal struct-layout work documented in
 * `docs/poc/tls-phase2-session-access.md`.
 *
 * Why a POC and not a real impl: GnuTLS's session-resumption +
 * channel-binding APIs all operate on a `gnutls_session_t` handle,
 * which `Gio.TlsConnection` keeps private inside the glib-networking
 * GnuTLS backend (`_GTlsConnectionGnutlsPrivate`). Reaching it requires
 * either:
 *
 *   (a) Walking the GTypeInstance private-data offset for
 *       `GTlsConnectionGnutls` — needs the exact struct layout from a
 *       known glib-networking commit (see the docs/poc note).
 *   (b) A future upstream patch to expose a `g_tls_connection_get_native_session()`
 *       (or similar) accessor.
 *
 * Until either path is available, every native call here returns the
 * `GError` domain `GjsifyTls.session_access_quark()`/code
 * `NOT_SUPPORTED` with a message pointing at the docs/poc note. The
 * JS side surfaces this as a regular `Error` thrown synchronously
 * from the `@gjsify/tls` getter — so consumers can detect it via
 * `try/catch` AND gate up-front via `hasTlsSessionAccess()`.
 *
 * Wiring the real implementation later is intentionally a small
 * change: each `throw_not_supported()` site below becomes a call into
 * a new `_native_session_for_connection()` helper that returns the
 * raw `gnutls_session_t`, then the existing GnuTLS APIs (already in
 * Vala 0.56's `gnutls.vapi`, with `session_channel_binding` added in
 * the sibling `gnutls-session.vapi`) take over. The JS-side bindings
 * + tests don't need to change.
 *
 * Phase 2 scope
 * ─────────────
 * Three Node-equivalent capabilities, all blocked on the same
 * `gnutls_session_t` extraction:
 *
 *   1. Session resumption — `getSession()`/`setSession()` data
 *      buffer for `gnutls_session_get_data2` / `gnutls_session_set_data`,
 *      `isSessionReused()` for `gnutls_session_is_resumed`, and a
 *      `'session'` event hook (`'new-session-ticket'` signal proxy).
 *   2. Channel binding — `getFinished()` / `getPeerFinished()` are
 *      Node-compat aliases for the `tls-unique` channel-binding
 *      bytes (RFC 5929 §3, TLS 1.0–1.2). For TLS 1.3 the same APIs
 *      semantically degrade to `tls-exporter` (RFC 9266) — covered by
 *      the `get_channel_binding()` method taking a binding type.
 *   3. Negotiated-protocol introspection beyond what Gio surfaces —
 *      not strictly Phase 2 but tracked here so the next iteration
 *      doesn't duplicate the bridge.
 */

using GLib;

namespace GjsifyTls {

    /**
     * Error domain for {@link SessionAccess} failures.
     */
    public errordomain SessionAccessError {
        /**
         * The underlying GIO/GnuTLS plumbing is not available — typically
         * because the `gnutls_session_t` cannot be extracted from a
         * `Gio.TlsConnection` in this GLib/glib-networking version.
         * Track progress in `docs/poc/tls-phase2-session-access.md`.
         */
        NOT_SUPPORTED,
        /**
         * The supplied `Gio.TlsConnection` is null or the handshake has
         * not yet completed — the GnuTLS session is not ready.
         */
        NOT_READY,
        /**
         * The GnuTLS call returned a non-zero error code. The {@link
         * SessionAccessError.code} message includes the GnuTLS error
         * string when available.
         */
        GNUTLS_ERROR,
    }

    /**
     * Symbolic channel-binding selector for {@link SessionAccess.get_channel_binding}.
     *
     * Mirrors GnuTLS's `gnutls_channel_binding_t` so the JS layer can
     * pass int constants without depending on the GnuTLS GIR (GnuTLS
     * has no GIR; values are stable per RFC 5929 / RFC 9266 / GnuTLS
     * API stability).
     */
    public enum ChannelBindingType {
        /** `tls-unique` (RFC 5929 §3). TLS 1.0–1.2 only. */
        TLS_UNIQUE = 0,
        /** `tls-server-end-point` (RFC 5929 §4). */
        TLS_SERVER_END_POINT = 1,
        /** `tls-exporter` (RFC 9266). TLS 1.3 replacement for `tls-unique`. */
        TLS_EXPORTER = 2,
    }

    /**
     * SessionAccess — wraps a `Gio.TlsConnection` to extract / inject
     * data that the GIO API does not expose: serialized session
     * resumption blobs, channel-binding bytes for SCRAM-SHA-* SASL,
     * and the `is_resumed` predicate.
     *
     * Construction
     * ────────────
     * Created via {@link SessionAccess.for_connection} — the binding
     * holds a strong ref on the connection so the session stays alive
     * for the bridge's lifetime. The connection MUST have completed a
     * handshake before any of the extraction APIs are called; calling
     * earlier yields {@link SessionAccessError.NOT_READY}.
     *
     * Native session pointer
     * ──────────────────────
     * Every method below resolves the `gnutls_session_t` via
     * {@link _resolve_native_session}, which currently always returns
     * `null` and triggers a {@link SessionAccessError.NOT_SUPPORTED}.
     * When the GIO struct-layout question is resolved, that single
     * function becomes the only file that changes — the public
     * surface stays stable.
     */
    public class SessionAccess : GLib.Object {

        /** Strong ref on the wrapped connection.
         *
         * Note: Vala maps GIO into the `GLib` namespace (see
         * `gio-2.0.vapi` — `[CCode (gir_namespace = "Gio")]`
         * `namespace GLib {`). So `Gio.TlsConnection` in JS / GIR
         * corresponds to `GLib.TlsConnection` in Vala. The class
         * surface published to JS via the GIR still appears as
         * `Gio.TlsConnection` (the gir_namespace attribute drives
         * the introspection output). */
        private GLib.TlsConnection _connection;

        /**
         * Returns whether SessionAccess is functional in this runtime.
         *
         * Today this always returns `false` (Phase 2 POC). When the
         * GIO-internal `gnutls_session_t` access lands, this returns
         * `true` for connections whose backend is the GnuTLS one
         * (`GTlsConnectionGnutls` instance) and `false` for any other
         * (e.g. a hypothetical OpenSSL backend, or a mock).
         *
         * Consumers should call this BEFORE constructing a
         * {@link SessionAccess} — passing the result through to
         * `hasTlsSessionAccess()` on the JS side.
         */
        public static bool is_supported () {
            // POC: always false. See `_resolve_native_session()` below.
            return false;
        }

        /**
         * Build a SessionAccess for a live `Gio.TlsConnection`. The
         * connection is retained until this object is collected.
         *
         * Returns `null` if @connection is `null` — callers can use
         * the null-coalescing pattern to short-circuit.
         */
        public static SessionAccess? for_connection (GLib.TlsConnection? connection) {
            if (connection == null) {
                return null;
            }
            return new SessionAccess.with_connection (connection);
        }

        /** Internal constructor — use {@link for_connection}. */
        private SessionAccess.with_connection (GLib.TlsConnection connection) {
            this._connection = connection;
        }

        /**
         * Returns `true` if the underlying TLS session was resumed
         * from a session ticket or session ID rather than completing
         * a full handshake.
         *
         * Wraps `gnutls_session_is_resumed`.
         *
         * @throws SessionAccessError if the native session cannot be
         *         accessed (currently: always, until the Phase 2
         *         struct-layout work lands).
         */
        public bool is_session_reused () throws SessionAccessError {
            _resolve_native_session ();
            // Unreachable today — _resolve_native_session() always throws.
            return false;
        }

        /**
         * Extract the serialized session-resumption blob from the
         * current handshake. Suitable for stashing in a JS variable
         * and feeding back into a subsequent connect call via
         * {@link set_session_data} (the `{session}` option on the
         * Node-side `tls.connect()`).
         *
         * Wraps `gnutls_session_get_data2`.
         *
         * @returns serialized session as `Bytes` on success.
         * @throws SessionAccessError if the native session cannot be
         *         accessed.
         */
        public GLib.Bytes get_session_data () throws SessionAccessError {
            _resolve_native_session ();
            return new GLib.Bytes (new uint8[0]);
        }

        /**
         * Inject a previously serialized session blob to attempt
         * resumption. Must be called BEFORE the handshake completes
         * — typically right after `Gio.TlsClientConnection.new()` and
         * before `handshake_async()`.
         *
         * Wraps `gnutls_session_set_data`.
         *
         * @param data serialized blob from a prior {@link get_session_data} call.
         * @throws SessionAccessError if the native session cannot be
         *         accessed.
         */
        public void set_session_data (GLib.Bytes data) throws SessionAccessError {
            _resolve_native_session ();
        }

        /**
         * Extract the TLS-Finished bytes for the given channel-binding
         * type. The default (`TLS_UNIQUE`) matches Node's
         * `tlsSocket.getFinished()` semantics; `TLS_EXPORTER` is the
         * TLS 1.3 replacement.
         *
         * Wraps `gnutls_session_channel_binding`.
         *
         * @param binding the binding type — see {@link ChannelBindingType}.
         * @returns the binding bytes on success.
         * @throws SessionAccessError if the native session cannot be
         *         accessed or the binding type is not supported by
         *         the negotiated TLS version.
         */
        public GLib.Bytes get_channel_binding (ChannelBindingType binding = ChannelBindingType.TLS_UNIQUE)
            throws SessionAccessError {
            _resolve_native_session ();
            return new GLib.Bytes (new uint8[0]);
        }

        /**
         * Convenience: `getFinished()` per Node's TLSSocket API.
         * Returns the local Finished bytes (i.e. the bytes WE sent).
         * On TLS 1.3 returns the `tls-exporter` material instead.
         *
         * Same blocker as {@link get_channel_binding}.
         */
        public GLib.Bytes get_finished () throws SessionAccessError {
            // TLS 1.3 vs 1.2 selection happens here once
            // _resolve_native_session() returns a real handle — for
            // 1.3 we'd call get_channel_binding(TLS_EXPORTER) and
            // for ≤1.2 get_channel_binding(TLS_UNIQUE). Today the
            // throw is unconditional.
            return get_channel_binding (ChannelBindingType.TLS_UNIQUE);
        }

        /**
         * Convenience: `getPeerFinished()` per Node's TLSSocket API.
         * Returns the peer's Finished bytes. Same TLS 1.3 fallback as
         * {@link get_finished}.
         *
         * Implementation note: GnuTLS's `gnutls_session_channel_binding`
         * with `TLS_UNIQUE` returns the local-side Finished. For the
         * peer-side bytes we need a sibling call that reads the
         * remote Finished from the same session state — exists as
         * `gnutls_session_get_random_*` + manual derivation, OR via
         * the same TLS_UNIQUE binding bytes which by design are
         * symmetric for both peers on the same session (the binding
         * is shared, not directional). Node distinguishes
         * `getFinished()` vs `getPeerFinished()` because OpenSSL
         * exposes both halves separately; for SCRAM-SHA-* the value
         * actually used is `tls-unique` (shared) so the distinction
         * is informational. See docs/poc note for the precise
         * mapping the Path-A implementation will use.
         */
        public GLib.Bytes get_peer_finished () throws SessionAccessError {
            return get_channel_binding (ChannelBindingType.TLS_UNIQUE);
        }

        /**
         * Get the protocol version actually negotiated, as a stable
         * string. Mirrors `Gio.TlsConnection.get_protocol_version()`
         * but is colocated here so the JS-side `SessionAccess`
         * wrapper has one consistent surface — useful when the
         * `tls-unique` vs `tls-exporter` switch in
         * {@link get_finished} needs the live version.
         *
         * Unlike the rest of this class, this method DOES return a
         * useful value today — it reads `Gio.TlsConnection.get_protocol_version()`
         * directly. POC value: lets tests / consumers exercise the
         * SessionAccess shape end-to-end even before the gnutls
         * blocker is resolved.
         */
        public string get_negotiated_protocol_version () {
            var proto = _connection.get_protocol_version ();
            switch (proto) {
                case GLib.TlsProtocolVersion.TLS_1_0: return "TLSv1";
                case GLib.TlsProtocolVersion.TLS_1_1: return "TLSv1.1";
                case GLib.TlsProtocolVersion.TLS_1_2: return "TLSv1.2";
                case GLib.TlsProtocolVersion.TLS_1_3: return "TLSv1.3";
                default: return "unknown";
            }
        }

        /**
         * Resolve the `gnutls_session_t` for {@link _connection}.
         *
         * Today this always throws {@link SessionAccessError.NOT_SUPPORTED}.
         * The eventual implementation needs to:
         *
         *   1. Confirm `_connection` is a `GTlsConnectionGnutls`
         *      instance (`g_type_check_instance_is_a` against the
         *      type from `gio-tls-gnutls.so`).
         *   2. Read the `session` field from
         *      `((GTlsConnectionGnutls*)_connection)->priv->session`
         *      — the layout comes from `glib-networking/tls/gnutls/
         *      gtlsconnection-gnutls-base.c`.
         *   3. Return the pointer as `void*` so the GnuTLS calls in
         *      the methods above can use it.
         *
         * Until that lands, the unconditional throw keeps the API
         * surface honest. See docs/poc/tls-phase2-session-access.md
         * for the open questions and acceptance criteria for Path A.
         */
        private void* _resolve_native_session () throws SessionAccessError {
            throw new SessionAccessError.NOT_SUPPORTED (
                "@gjsify/tls-native SessionAccess: extracting gnutls_session_t " +
                "from Gio.TlsConnection is not yet implemented. The Phase 2 " +
                "native bits ship as a POC scaffold; see " +
                "docs/poc/tls-phase2-session-access.md for the open struct-layout " +
                "question that gates the real implementation."
            );
        }
    }
}
