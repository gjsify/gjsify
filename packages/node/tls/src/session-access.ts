// session-access.ts — Phase 2 surface re-exports from @gjsify/tls-native.
//
// Exposes the JS-side surface for TLS session resumption + channel
// binding that wraps the Vala/GnuTLS bridge in `@gjsify/tls-native`.
// The bridge currently ships as a POC scaffold (every call throws
// "not supported"); the surface here is locked in so that flipping
// the native side from throw → real is transparent for consumers.
//
// Consumer flow (Node-compat):
//
//   import { TLSSocket, hasTlsSessionAccess } from '@gjsify/tls';
//   const sock = tls.connect({ host, port });
//   sock.once('secureConnect', () => {
//     if (hasTlsSessionAccess()) {
//       const session = sock.getSession();              // Buffer | undefined
//       const finished = sock.getFinished();            // Buffer | undefined
//       const peerFinished = sock.getPeerFinished();    // Buffer | undefined
//       const reused = sock.isSessionReused();          // boolean
//     }
//   });
//
//   sock.on('session', (session) => { /* persist for resumption */ });
//
//   // resume:
//   const sock2 = tls.connect({ host, port, session });  // Buffer
//
// On Node and on GJS without the native typelib, `hasTlsSessionAccess()`
// returns `false` and the TLSSocket getters return `undefined`. On GJS
// with the typelib but without the GIO struct-layout fix landed, the
// getters synchronously throw with a message pointing at
// `docs/poc/tls-phase2-session-access.md`.

import {
    hasTlsSessionAccess as _hasTlsSessionAccess,
    createSessionAccess as _createSessionAccess,
    TlsChannelBindingType as _TlsChannelBindingType,
    type NativeSessionAccess as _NativeSessionAccess,
    type TlsConnectionHandle as _TlsConnectionHandle,
} from '@gjsify/tls-native';

export { TlsChannelBindingType } from '@gjsify/tls-native';
export type { NativeSessionAccess, TlsConnectionHandle } from '@gjsify/tls-native';

/**
 * Returns `true` when the @gjsify/tls-native Phase 2 session-access
 * bridge is loaded AND functional. Today this returns `false` even
 * on GJS with the typelib installed — the underlying gnutls_session_t
 * extraction from `Gio.TlsConnection` is not yet implemented
 * (`docs/poc/tls-phase2-session-access.md`).
 *
 * Use this predicate to detect "session-resumption / channel-binding
 * available on this runtime" without triggering a thrown error. When
 * it returns `false`:
 *
 *   - `TLSSocket.getFinished()` / `getPeerFinished()` return `undefined`.
 *   - `TLSSocket.getSession()` returns `undefined`.
 *   - `TLSSocket.setSession()` / `tls.connect({session})` silently
 *     skip the resumption attempt (full handshake instead).
 *   - The `'session'` event never fires.
 *
 * This matches Node's behavior on a build without OpenSSL session
 * support — present API surface, no-op when unavailable.
 */
export function hasTlsSessionAccess(): boolean {
    return _hasTlsSessionAccess();
}

/**
 * Internal: build a {@link NativeSessionAccess} wrapper around a live
 * `Gio.TlsConnection`. Returns `null` when the native typelib isn't
 * loaded OR @connection is `null`. The returned wrapper's methods
 * may throw — callers must wrap in `try/catch` AND check
 * `hasTlsSessionAccess()` first.
 *
 * @internal — used by `TLSSocket` and `connect.ts`. Public consumers
 * should rely on the Node-shaped getters/setters on `TLSSocket`.
 */
export function createSessionAccess(connection: _TlsConnectionHandle | null): _NativeSessionAccess | null {
    return _createSessionAccess(connection);
}

/** Re-export for code that wants the channel-binding type constants
 *  without importing through the native package directly. */
export { _TlsChannelBindingType };
