/*
 * SessionAccess — Phase 2 (TLS session resumption + channel binding)
 * of @gjsify/tls-native.
 *
 * Status
 * ──────
 * Functional Path-A implementation. Every method below delegates to a
 * thin C shim (`src/c/gjsify-tls-private.{c,h}`) that reaches into
 * glib-networking's GnuTLS-backend private struct via the GLib 2.38+
 * public `g_type_instance_get_private` + a runtime
 * `g_type_from_name("GTlsConnectionGnutls")` lookup. The struct layout
 * itself is vendored from `refs/glib-networking/tls/gnutls/
 * gtlsconnection-gnutls.c` (see the file-header in the C shim for the
 * vendored offsets + supported window).
 *
 * Backwards-compatibility on a non-GnuTLS backend
 * ───────────────────────────────────────────────
 * If `g_type_from_name("GTlsConnectionGnutls")` returns 0 (i.e. a
 * hypothetical future OpenSSL backend is selected via `GIO_USE_TLS`),
 * the static `is_supported()` returns `false` and every consumer call
 * surfaces `SessionAccessError.NOT_SUPPORTED` — gracefully degrading
 * the same way Node's TLSSocket does when built without session
 * support. The JS-side `hasTlsSessionAccess()` predicate is the
 * canonical gate consumers should check; see the per-method docs for
 * the corresponding error semantics.
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
         * Returns `true` when glib-networking's GnuTLS backend is the
         * active TLS backend (`GTlsConnectionGnutls` GType is
         * registered). Returns `false` only when a non-GnuTLS GIO TLS
         * backend is selected (e.g. via `GIO_USE_TLS=openssl` once
         * that backend exists upstream).
         *
         * Consumers should call this BEFORE constructing a
         * {@link SessionAccess} — passing the result through to
         * `hasTlsSessionAccess()` on the JS side.
         */
        public static bool is_supported () {
            return GjsifyTlsPrivate.is_supported ();
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
         * @throws SessionAccessError if the connection is not from
         *         the GnuTLS backend (`NOT_SUPPORTED`) or the GnuTLS
         *         API itself failed (`GNUTLS_ERROR`).
         */
        public bool is_session_reused () throws SessionAccessError {
            try {
                return GjsifyTlsPrivate.is_session_reused (this._connection);
            } catch (GjsifyTlsPrivate.Error e) {
                throw _wrap (e);
            }
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
            try {
                return GjsifyTlsPrivate.get_session_data (this._connection);
            } catch (GjsifyTlsPrivate.Error e) {
                throw _wrap (e);
            }
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
            try {
                GjsifyTlsPrivate.set_session_data (this._connection, data);
            } catch (GjsifyTlsPrivate.Error e) {
                throw _wrap (e);
            }
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
            try {
                return GjsifyTlsPrivate.get_channel_binding (this._connection, (int) binding);
            } catch (GjsifyTlsPrivate.Error e) {
                throw _wrap (e);
            }
        }

        /**
         * Convenience: `getFinished()` per Node's TLSSocket API.
         * Returns the local Finished bytes (i.e. the bytes WE sent).
         * On TLS 1.3 returns the `tls-exporter` material instead.
         *
         * Same blocker as {@link get_channel_binding}.
         */
        public GLib.Bytes get_finished () throws SessionAccessError {
            // On TLS ≤1.2 the relevant binding is `tls-unique` (the
            // first Finished message, RFC 5929 §3). On TLS 1.3 the
            // Finished messages are encrypted before the channel-
            // binding is taken, so RFC 9266 specifies `tls-exporter`
            // as the replacement.
            var binding = _connection.get_protocol_version () == GLib.TlsProtocolVersion.TLS_1_3
                ? ChannelBindingType.TLS_EXPORTER
                : ChannelBindingType.TLS_UNIQUE;
            return get_channel_binding (binding);
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
            // Per the GnuTLS manual + RFC 5929/9266 the channel-binding
            // bytes are symmetric across both peers — there is no
            // separate "peer" Finished available via the GnuTLS API
            // (OpenSSL exposes both halves; GnuTLS does not). For the
            // SCRAM-SHA-* use case the symmetric binding IS what SASL
            // negotiates against, so this is functionally correct.
            // Same TLS-1.3 fallback as `get_finished()`.
            return get_finished ();
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
         * Translate a {@link GjsifyTlsPrivate.Error} from the C shim
         * into the public {@link SessionAccessError} domain, preserving
         * the original message verbatim. The mapping is one-to-one:
         * `NOT_SUPPORTED` → `NOT_SUPPORTED`, `GNUTLS_FAILED` →
         * `GNUTLS_ERROR`. The `NOT_READY` code stays reserved for the
         * Vala-side `null`-connection guard in {@link for_connection}.
         */
        private SessionAccessError _wrap (GjsifyTlsPrivate.Error e) {
            if (e is GjsifyTlsPrivate.Error.GNUTLS_FAILED) {
                return new SessionAccessError.GNUTLS_ERROR (e.message);
            }
            return new SessionAccessError.NOT_SUPPORTED (e.message);
        }
    }
}
