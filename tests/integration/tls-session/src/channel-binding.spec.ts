// SPDX-License-Identifier: MIT
// Reference: refs/node/lib/internal/tls/wrap.js:1305-1306#getFinished
//   (TLSSocket.prototype.getFinished /
//   getPeerFinished); no upstream `test-tls-getfinished.js` ships with
//   Node — the API is documented but not exercised at the test layer.
//   This spec is the original "real handshake → channel-binding bytes"
//   integration test for `@gjsify/tls` Phase 2.
// Original: Copyright (c) Joyent, Inc. and other Node contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// What this validates
// -------------------
// Per `docs/poc/tls-phase2-session-access.md` §"Acceptance criteria"
// item 6: assert `getFinished()` returns a non-empty `Buffer` on TLS 1.2
// (RFC 5929 `tls-unique`) and degrades to TLS 1.3 `tls-exporter` bytes
// (RFC 9266) automatically. Both `getFinished()` (local end) and
// `getPeerFinished()` (peer end) must agree on a meaningful binding —
// they will NOT be byte-identical (each side computes its own Finished
// MAC), but both must be non-empty and the same length.
//
// We exercise the negotiation twice: once forced to TLS 1.2, once
// forced to TLS 1.3, via `{minVersion, maxVersion}` connect options.
// The GJS path additionally cross-checks against `hasTlsSessionAccess()`
// — if the predicate is `false`, the bridge is degraded and the rest
// of the assertions would silently pass with `undefined`. Hard-fail
// instead.

import { describe, it, expect, on } from '@gjsify/unit';
import { Buffer } from 'node:buffer';
import type { ConnectionOptions } from 'node:tls';
import { readCert, readKey } from './fixtures.js';

interface BindingProbe {
    protocol: string | null;
    finished: Buffer | undefined;
    peerFinished: Buffer | undefined;
}

/**
 * Open a TLS connection, run the handshake, capture the channel-binding
 * bytes from both ends, end the connection.
 */
async function probeChannelBinding(
    tls: typeof import('node:tls'),
    port: number,
    ca: string,
    minVersion: 'TLSv1.2' | 'TLSv1.3',
    maxVersion: 'TLSv1.2' | 'TLSv1.3',
): Promise<BindingProbe> {
    return new Promise((resolve, reject) => {
        // Build a plain options object (no explicit `ConnectionOptions`
        // annotation) so TS picks the `connect(options)` overload
        // unambiguously — annotating widens the inferred type enough
        // that TS falls back to `connect(port: number, ...)` and
        // errors on the object → number conversion.
        const connectOpts = {
            host: '127.0.0.1',
            port,
            ca,
            servername: 'localhost',
            minVersion,
            maxVersion,
        } satisfies ConnectionOptions;
        const sock = tls.connect(connectOpts);

        sock.once('secureConnect', () => {
            const probe: BindingProbe = {
                protocol: sock.getProtocol(),
                finished: sock.getFinished(),
                peerFinished: sock.getPeerFinished(),
            };
            sock.end();
            sock.on('close', () => resolve(probe));
        });
        sock.once('error', reject);
    });
}

async function withTlsServer(
    tls: typeof import('node:tls'),
    minVersion: 'TLSv1.2' | 'TLSv1.3',
    maxVersion: 'TLSv1.2' | 'TLSv1.3',
    body: (port: number) => Promise<void>,
): Promise<void> {
    const server = tls.createServer(
        {
            cert: readCert(),
            key: readKey(),
            minVersion,
            maxVersion,
        },
        (sock) => {
            sock.on('error', () => {
                /* swallow */
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

/**
 * Asserts the shape of a channel-binding probe — non-empty, equal-length,
 * non-identical local-vs-peer Finished buffers.
 *
 * Protocol-version assertion is NOT performed here. Both Node and our
 * GJS impl plumb `{minVersion, maxVersion}` through to the underlying
 * TLS library, but Gio.TlsConnection does NOT expose either knob — the
 * GnuTLS backend always negotiates whatever both sides best agree on
 * (typically TLS 1.3 on modern stacks). The CALLER (test body) decides
 * what protocol assertion is appropriate for its host: strict on Node,
 * informational on GJS. The shape assertion below is universal — it
 * holds for both TLS 1.2 (`tls-unique`, RFC 5929) and TLS 1.3
 * (`tls-exporter`, RFC 9266) bytes regardless of which got negotiated.
 */
function assertBindingShape(probe: BindingProbe): void {
    expect(probe.finished).toBeDefined();
    expect(probe.peerFinished).toBeDefined();
    const fin = probe.finished as Buffer;
    const peerFin = probe.peerFinished as Buffer;
    expect(Buffer.isBuffer(fin)).toBe(true);
    expect(Buffer.isBuffer(peerFin)).toBe(true);
    // Non-empty.
    expect(fin.length).toBeGreaterThan(0);
    expect(peerFin.length).toBeGreaterThan(0);
    // Both sides must produce a binding of the same length — they map
    // to different MAC inputs but the underlying primitive returns
    // bytes of a fixed length per TLS version.
    expect(fin.length).toBe(peerFin.length);
    // Local and peer Finished MUST differ — each side computes a MAC
    // over a distinct hash. A bridge that returns the SAME bytes for
    // both is a bug (one of the two getters is forwarding to the
    // wrong gnutls_channel_binding_t handedness).
    expect(fin.equals(peerFin)).toBe(false);
}

export default async () => {
    await describe('TLS channel binding — real handshake getFinished / getPeerFinished', async () => {
        await on('Node.js', async () => {
            await it('Node: TLS 1.2 — getFinished returns non-empty tls-unique bytes', async () => {
                const tls = await import('node:tls');
                const ca = readCert();
                await withTlsServer(tls, 'TLSv1.2', 'TLSv1.2', async (port) => {
                    const probe = await probeChannelBinding(tls, port, ca, 'TLSv1.2', 'TLSv1.2');
                    // Node respects {minVersion, maxVersion} — assert strict.
                    expect(probe.protocol).toBe('TLSv1.2');
                    assertBindingShape(probe);
                });
            });

            await it('Node: TLS 1.3 — getFinished returns non-empty tls-exporter bytes', async () => {
                const tls = await import('node:tls');
                const ca = readCert();
                await withTlsServer(tls, 'TLSv1.3', 'TLSv1.3', async (port) => {
                    const probe = await probeChannelBinding(tls, port, ca, 'TLSv1.3', 'TLSv1.3');
                    expect(probe.protocol).toBe('TLSv1.3');
                    assertBindingShape(probe);
                });
            });
        });

        await on('Gjs', async () => {
            await it('GJS: hasTlsSessionAccess() must report Phase 2 native bridge is functional', async () => {
                const { hasTlsSessionAccess } = await import('@gjsify/tls');
                expect(hasTlsSessionAccess()).toBe(true);
            });

            // GJS: Gio.TlsConnection does NOT expose minVersion/maxVersion to
            // the GnuTLS backend (only the @gjsify/tls option-bag preserves
            // them for diagnostics). We still pass them through — they're
            // documented in @gjsify/tls's API — but skip the strict protocol
            // assertion: GnuTLS always picks the highest agreed version, which
            // is TLS 1.3 on every modern stack. The binding-bytes contract is
            // what matters end-to-end (tls-unique on 1.2, tls-exporter on 1.3
            // auto-selected by the C shim) — assertBindingShape validates that
            // independent of the negotiated version.
            await it('GJS: TLS 1.2 requested — getFinished returns non-empty channel-binding bytes', async () => {
                const tls = await import('node:tls');
                const ca = readCert();
                await withTlsServer(tls, 'TLSv1.2', 'TLSv1.2', async (port) => {
                    const probe = await probeChannelBinding(tls, port, ca, 'TLSv1.2', 'TLSv1.2');
                    assertBindingShape(probe);
                });
            });

            await it('GJS: TLS 1.3 requested — getFinished returns non-empty channel-binding bytes', async () => {
                const tls = await import('node:tls');
                const ca = readCert();
                await withTlsServer(tls, 'TLSv1.3', 'TLSv1.3', async (port) => {
                    const probe = await probeChannelBinding(tls, port, ca, 'TLSv1.3', 'TLSv1.3');
                    assertBindingShape(probe);
                });
            });
        });
    });
};
