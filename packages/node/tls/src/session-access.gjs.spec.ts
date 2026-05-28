// SPDX-License-Identifier: MIT
//
// Phase 2 (TLS session resumption + channel binding) surface tests for
// @gjsify/tls. GJS-only because:
//   1. The native session-access bridge is a GJS Vala prebuild.
//   2. The TLSSocket internals (_tlsConnection, _sessionAccess) are
//      not surfaced via @types/node — `*.gjs.spec.ts` per CLAUDE.md
//      rule 2b allows direct impl-private access type-safely.
//
// Current state of the native side: Path-A implementation lands the
// C shim (`@gjsify/tls-native` `src/c/gjsify-tls-private.{c,h}`) that
// walks the glib-networking GnuTLS-backend private struct to extract
// `gnutls_session_t` and forwards every session/channel-binding API
// to GnuTLS proper. `hasTlsSessionAccess()` returns `true` on any
// runtime with glib-networking's GnuTLS backend (Fedora 43+, gjs
// 1.86+). A real TLS handshake round-trip test for resumption +
// channel-binding bytes lives at the package level once a fixture
// TLS server is in place.
//
// The unit-level tests below cover the API SHAPE + pre-handshake
// graceful-degradation: every getter returns `undefined`/`false`
// when there is no live TlsConnection bound to the socket (a socket
// constructed without going through `connect()`). That's the
// contract consumers (https.Agent, pg-protocol SCRAM-SHA-*) depend
// on for graceful fallback regardless of bridge availability.

import { describe, it, expect, on } from '@gjsify/unit';
import {
    TLSSocket,
    hasTlsSessionAccess,
    TlsChannelBindingType,
    connect,
} from '@gjsify/tls';
import type { TlsConnectOptions } from '@gjsify/tls';
import { Buffer } from 'node:buffer';

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/tls — Phase 2 surface (session resumption + channel binding)', async () => {
            await describe('hasTlsSessionAccess', async () => {
                await it('is a function returning a boolean', () => {
                    expect(typeof hasTlsSessionAccess).toBe('function');
                    expect(typeof hasTlsSessionAccess()).toBe('boolean');
                });

                await it('returns true under glib-networking GnuTLS backend (Path-A active)', () => {
                    // Path-A: returns true on the Fedora 43+ default
                    // (glib-networking GnuTLS backend). Would return
                    // false on a future OpenSSL backend selected via
                    // `GIO_USE_TLS=openssl`.
                    expect(hasTlsSessionAccess()).toBe(true);
                });
            });

            await describe('TlsChannelBindingType', async () => {
                await it('exposes the three RFC 5929 / RFC 9266 binding-type constants', () => {
                    expect(TlsChannelBindingType.TLS_UNIQUE).toBe(0);
                    expect(TlsChannelBindingType.TLS_SERVER_END_POINT).toBe(1);
                    expect(TlsChannelBindingType.TLS_EXPORTER).toBe(2);
                });
            });

            await describe('TLSSocket.getFinished / getPeerFinished', async () => {
                await it('exposes getFinished as a function returning Buffer | undefined', () => {
                    const sock = new TLSSocket();
                    expect(typeof sock.getFinished).toBe('function');
                    // Pre-handshake (no _tlsConnection): always undefined.
                    expect(sock.getFinished()).toBeUndefined();
                });

                await it('exposes getPeerFinished as a function returning Buffer | undefined', () => {
                    const sock = new TLSSocket();
                    expect(typeof sock.getPeerFinished).toBe('function');
                    expect(sock.getPeerFinished()).toBeUndefined();
                });

                await it('getFinished returns undefined before a TLS handshake', () => {
                    // Path-A: even with hasTlsSessionAccess() === true,
                    // a socket with no bound `_tlsConnection` returns
                    // undefined — there is no session to bind against
                    // yet. Same contract Node uses pre-handshake.
                    const sock = new TLSSocket();
                    expect(sock.getFinished()).toBeUndefined();
                    expect(sock.getPeerFinished()).toBeUndefined();
                });
            });

            await describe('TLSSocket.getSession / setSession / isSessionReused', async () => {
                await it('exposes getSession as a function returning Buffer | undefined', () => {
                    const sock = new TLSSocket();
                    expect(typeof sock.getSession).toBe('function');
                    expect(sock.getSession()).toBeUndefined();
                });

                await it('exposes setSession as a no-throw function accepting Buffer | Uint8Array', () => {
                    const sock = new TLSSocket();
                    expect(typeof sock.setSession).toBe('function');
                    // No-op when bridge unavailable — must not throw.
                    sock.setSession(Buffer.from([1, 2, 3, 4]));
                    sock.setSession(new Uint8Array([5, 6, 7, 8]));
                });

                await it('exposes isSessionReused as a function returning boolean', () => {
                    const sock = new TLSSocket();
                    expect(typeof sock.isSessionReused).toBe('function');
                    expect(sock.isSessionReused()).toBe(false);
                });
            });

            await describe('TlsConnectOptions.session', async () => {
                await it('accepts a Buffer in the session field without type error', () => {
                    // Type-only check (constructed but not connected): the
                    // {session} option is part of TlsConnectOptions and
                    // forwards through to setSession() at handshake time.
                    const opts: TlsConnectOptions = {
                        host: 'localhost',
                        port: 4433,
                        session: Buffer.from([0xab, 0xcd]),
                    };
                    expect(opts.session).toBeDefined();
                    expect((opts.session as Buffer).length).toBe(2);
                });

                await it('accepts a Uint8Array in the session field without type error', () => {
                    const opts: TlsConnectOptions = {
                        host: 'localhost',
                        port: 4433,
                        session: new Uint8Array([1, 2, 3]),
                    };
                    expect(opts.session).toBeDefined();
                    expect((opts.session as Uint8Array).length).toBe(3);
                });
            });

            await describe('connect() — surface for the Phase 2 hooks', async () => {
                await it('is a function (full TLS-handshake round-trip is exercised at the integration layer)', () => {
                    expect(typeof connect).toBe('function');
                });
            });

            await describe('graceful degradation pre-handshake', async () => {
                await it('all Phase 2 getters degrade to undefined / false / no-op before a handshake', () => {
                    // A socket with no bound `_tlsConnection` behaves
                    // like Node's TLSSocket pre-handshake — every
                    // getter returns the empty/undefined value, no
                    // throws. Holds regardless of bridge availability
                    // because the short-circuit happens at the JS
                    // layer before any native call.
                    const sock = new TLSSocket();
                    expect(sock.getFinished()).toBeUndefined();
                    expect(sock.getPeerFinished()).toBeUndefined();
                    expect(sock.getSession()).toBeUndefined();
                    expect(sock.isSessionReused()).toBe(false);
                    sock.setSession(Buffer.from([0]));
                    // setSession is a no-op pre-handshake, but the
                    // call itself must not perturb the other getters.
                    expect(sock.getSession()).toBeUndefined();
                });
            });
        });
    });
};
