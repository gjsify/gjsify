// SPDX-License-Identifier: MIT
//
// Phase 2 (TLS session resumption + channel binding) surface tests for
// @gjsify/tls. GJS-only because:
//   1. The native session-access bridge is a GJS Vala prebuild.
//   2. The TLSSocket internals (_tlsConnection, _sessionAccess) are
//      not surfaced via @types/node — `*.gjs.spec.ts` per CLAUDE.md
//      rule 2b allows direct impl-private access type-safely.
//
// Current state of the native side: every session-access method
// throws `SessionAccessError.NOT_SUPPORTED` (Phase 2 POC scaffold —
// see docs/poc/tls-phase2-session-access.md). The TLSSocket surface
// converts those throws into `undefined` returns / silent no-ops to
// match Node's "session support not available" contract.
//
// These tests lock the API surface in BEFORE the native side becomes
// functional. When the GIO struct-layout work lands and
// `hasTlsSessionAccess()` flips to `true`, a follow-up real
// round-trip test goes in `tests/integration/tls-session/` and the
// `expects-undefined` assertions here either stay (gated on
// `hasTlsSessionAccess() === false` paths) or get a paired
// "real value when available" assertion. Either way the contract
// stays: API surface always present, behavior gated by the predicate.

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

                await it('returns false until the gnutls_session_t access lands (POC scaffold)', () => {
                    // Flip this to a paired assertion once the GIO
                    // struct-layout work in docs/poc/tls-phase2-session-access.md
                    // is resolved and SessionAccess.is_supported() returns true.
                    expect(hasTlsSessionAccess()).toBe(false);
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

                await it('getFinished returns undefined when session-access bridge is unavailable', () => {
                    // POC path: hasTlsSessionAccess() === false, getFinished()
                    // short-circuits to undefined before touching the bridge.
                    if (hasTlsSessionAccess()) return; // skip when flipped
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
                await it('is a function (full round-trip lives in tests/integration/tls-session — pending native flip)', () => {
                    expect(typeof connect).toBe('function');
                });
            });

            await describe('graceful degradation (POC contract)', async () => {
                await it('all Phase 2 getters degrade to undefined / false / no-op when bridge is unavailable', () => {
                    // POC path: bridge unavailable means EVERY surface
                    // method behaves like Node on a build without session
                    // support — no thrown errors, no observable state
                    // change. This is the contract consumer libraries
                    // (https.Agent, pg-protocol's SCRAM-SHA-* path)
                    // depend on for graceful fallback.
                    if (hasTlsSessionAccess()) return;
                    const sock = new TLSSocket();
                    expect(sock.getFinished()).toBeUndefined();
                    expect(sock.getPeerFinished()).toBeUndefined();
                    expect(sock.getSession()).toBeUndefined();
                    expect(sock.isSessionReused()).toBe(false);
                    sock.setSession(Buffer.from([0]));
                    // setSession is a no-op, but the call itself must
                    // not perturb the other getters.
                    expect(sock.getSession()).toBeUndefined();
                });
            });
        });
    });
};
