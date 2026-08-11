// session-access.ts — TLS session resumption + channel binding, over the
// Vala/GnuTLS bridge in `@gjsify/tls-native`.

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
 * Returns `true` when the native bridge is loaded AND the GIO TLS backend is
 * GnuTLS, whose private `gnutls_session_t` the shim reads. `false` on Node and
 * on any other backend, where the surface degrades exactly as Node's does
 * without OpenSSL session support: `getFinished`/`getPeerFinished`/`getSession`
 * return `undefined`, `setSession`/`connect({session})` skip the resumption
 * attempt, and `'session'` never fires.
 */
export function hasTlsSessionAccess(): boolean {
    return _hasTlsSessionAccess();
}

/**
 * `null` when the native typelib isn't loaded or @connection is `null`. The
 * wrapper's methods may throw — check `hasTlsSessionAccess()` AND catch.
 *
 * @internal — public consumers use the Node-shaped `TLSSocket` accessors.
 */
export function createSessionAccess(connection: _TlsConnectionHandle | null): _NativeSessionAccess | null {
    return _createSessionAccess(connection);
}

export { _TlsChannelBindingType };
