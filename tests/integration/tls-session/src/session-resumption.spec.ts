// SPDX-License-Identifier: MIT
// Reference: refs/node/test/parallel/test-tls-session-cache.js
// Original: Copyright (c) Joyent, Inc. and other Node contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// What this validates
// -------------------
// PR #360 landed the Phase 2 Path-A native flip — `@gjsify/tls-native`'s
// SessionAccess bridge now extracts a real `gnutls_session_t` from
// `Gio.TlsConnection` and forwards every session API to GnuTLS proper.
// The unit-level `session-access.gjs.spec.ts` covers the SHAPE (every
// getter returns the right empty value pre-handshake), but the actual
// round-trip — open conn 1 → capture session via the `'session'` event
// → close → open conn 2 with `{ session }` → assert `isSessionReused()
// === true` — was deferred to this integration suite once a fixture
// TLS server was in place.
//
// We run TWO paths in parallel:
//
//   - **Node**: stock `node:tls` against an `https`-style raw `tls.createServer`.
//     This is the reference. If it doesn't reuse the session the test is
//     broken, not the impl.
//   - **GJS**: `@gjsify/tls` (re-exports via `node:tls` thanks to the
//     gjsify CLI alias layer) against a `@gjsify/tls` server. This is
//     what we actually want to validate.
//
// Skip rules
// ----------
//   - The GJS branch hard-fails if `hasTlsSessionAccess() === false`
//     (using `expect(...).toBe(true)` so the failure points right at
//     the predicate) — the whole point of the suite is to validate the
//     bridge IS working on glib-networking GnuTLS backends.
//   - The Node branch never skips. Modern Node always ships OpenSSL
//     with session caching enabled.

import { describe, it, expect, on } from '@gjsify/unit';
import { Buffer } from 'node:buffer';
import type { ConnectionOptions } from 'node:tls';
import { readCert, readKey } from './fixtures.js';

/**
 * Open a TLS connection, capture the (optional) session blob, run a
 * tiny request/response exchange so the handshake is fully driven, and
 * resolve with `{ session, reused }`.
 *
 * @param tls            The runtime's `node:tls` module — `node:tls` on
 *                       Node, `@gjsify/tls` on GJS via the alias layer.
 * @param port           Listening TLS server port.
 * @param ca             PEM CA used to verify the server cert.
 * @param sessionOption  Optional previously-captured session blob.
 */
async function openTlsConnection(
    tls: typeof import('node:tls'),
    port: number,
    ca: string,
    sessionOption?: Buffer,
): Promise<{ session: Buffer | undefined; reused: boolean }> {
    return new Promise((resolve, reject) => {
        // Build a plain options object (no explicit `ConnectionOptions`
        // annotation) so TS picks the `connect(options)` overload
        // unambiguously — annotating the literal makes the spread
        // widen the inferred type enough that TS falls back to the
        // `connect(port: number, ...)` overload and errors on the
        // object → number conversion.
        const connectOpts = {
            host: '127.0.0.1',
            port,
            ca,
            servername: 'localhost',
            // Force TLS 1.2 for predictable session-ticket semantics.
            // (TLS 1.3 also resumes via PSK tickets but the resumption
            //  surface differs slightly; the Node test we mirror is
            //  TLS_method/TLS 1.2.)
            minVersion: 'TLSv1.2' as const,
            maxVersion: 'TLSv1.2' as const,
            ...(sessionOption ? { session: sessionOption } : {}),
        } satisfies ConnectionOptions;
        const sock = tls.connect(connectOpts);

        let capturedSession: Buffer | undefined;
        sock.on('session', (s: Buffer) => {
            capturedSession ??= s;
        });
        sock.once('secureConnect', () => {
            // If 'session' fires synchronously we may already have it.
            // Otherwise pull it via getSession() — same value, just a
            // different surface.
            const session = capturedSession ?? sock.getSession() ?? undefined;
            const reused = sock.isSessionReused();
            sock.end();
            sock.on('close', () => {
                resolve({ session: session ? Buffer.from(session) : undefined, reused });
            });
        });
        sock.once('error', (err: Error) => reject(err));
    });
}

/**
 * Start a TLS server, run the given async exchange, then close the
 * server. The server echoes back nothing — the spec only cares about
 * the handshake completing.
 */
async function withTlsServer(tls: typeof import('node:tls'), body: (port: number) => Promise<void>): Promise<void> {
    const server = tls.createServer(
        {
            cert: readCert(),
            key: readKey(),
            // Force TLS 1.2 for predictable ticket-based resumption.
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.2',
        },
        (sock) => {
            // Drain any client bytes + end. The server side intentionally
            // does no app-layer work — this is a handshake-only test.
            sock.on('error', () => {
                /* swallow client-side aborts */
            });
            sock.end();
        },
    );

    const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('listen() returned no address'));
                return;
            }
            resolve(addr.port);
        });
    });
    try {
        await body(port);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export default async () => {
    await describe('TLS session resumption — real handshake round-trip', async () => {
        await on('Node.js', async () => {
            await it('Node: conn 2 with prior session blob resumes the TLS session', async () => {
                const tls = await import('node:tls');
                const ca = readCert();

                await withTlsServer(tls, async (port) => {
                    // Conn 1: full handshake, capture the session blob.
                    const first = await openTlsConnection(tls, port, ca);
                    expect(first.reused).toBe(false);
                    expect(first.session).toBeDefined();
                    expect((first.session as Buffer).length).toBeGreaterThan(0);

                    // Conn 2: resume.
                    const second = await openTlsConnection(tls, port, ca, first.session);
                    expect(second.reused).toBe(true);
                });
            });
        });

        await on('Gjs', async () => {
            await it('GJS: hasTlsSessionAccess() must report Phase 2 native bridge is functional', async () => {
                // Importing this from @gjsify/tls (vs node:tls) so the
                // predicate hits the Phase 2 native surface directly.
                const { hasTlsSessionAccess } = await import('@gjsify/tls');
                expect(hasTlsSessionAccess()).toBe(true);
            });

            await it('GJS: conn 2 with prior session blob resumes the TLS session', async () => {
                // node:tls under GJS resolves to @gjsify/tls via the
                // alias layer — same API surface, gnutls_session_t-backed
                // resumption under the hood.
                const tls = await import('node:tls');
                const ca = readCert();

                await withTlsServer(tls, async (port) => {
                    const first = await openTlsConnection(tls, port, ca);
                    expect(first.reused).toBe(false);
                    expect(first.session).toBeDefined();
                    expect((first.session as Buffer).length).toBeGreaterThan(0);

                    const second = await openTlsConnection(tls, port, ca, first.session);
                    expect(second.reused).toBe(true);
                });
            });
        });
    });
};
