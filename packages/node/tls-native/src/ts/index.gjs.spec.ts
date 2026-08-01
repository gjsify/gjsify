// SPDX-License-Identifier: MIT
// GJS-only smoke test for @gjsify/tls-native.
//
// Runs only under GJS (via `on('Gjs', …)`) because `imports.gi.GjsifyTls`
// is unavailable on Node. The test asserts:
//   1. `hasNativeTls()` returns true after the typelib is loaded.
//   2. `parseOcspResponse(emptyBytes)` returns null (invalid input).
//   3. `parseOcspResponse(garbage)` returns null (non-OCSP DER input).
//
// We do not yet exercise a real OCSP response fixture — generating one
// requires either a live responder or a pre-captured DER blob. Tracked in
// status/open-todos.md as the "OCSP integration test" follow-up.

import { describe, it, expect, on } from '@gjsify/unit';
import {
    hasNativeTls,
    nativeTls,
    parseOcspResponse,
    OcspCertStatus,
    OcspResponseStatus,
    hasTlsSessionAccess,
    createSessionAccess,
    TlsChannelBindingType,
} from './index.js';

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/tls-native — module loading', async () => {
            await it('loads the GjsifyTls typelib successfully', () => {
                expect(hasNativeTls()).toBe(true);
                expect(nativeTls).not.toBeNull();
                expect(typeof nativeTls?.Tls.parse_ocsp_response).toBe('function');
            });
        });

        await describe('@gjsify/tls-native — parse_ocsp_response', async () => {
            await it('returns null for empty input', () => {
                expect(parseOcspResponse(new Uint8Array(0))).toBeNull();
            });

            await it('returns null for non-OCSP garbage bytes', () => {
                const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01, 0x02, 0x03]);
                expect(parseOcspResponse(garbage)).toBeNull();
            });

            await it('returns null for truncated DER (sequence header only)', () => {
                // ASN.1 SEQUENCE tag + length-of-1 + one byte — not enough to be
                // a valid OCSPResponse (which needs OCSPResponseStatus + …).
                const truncated = new Uint8Array([0x30, 0x01, 0x00]);
                expect(parseOcspResponse(truncated)).toBeNull();
            });
        });

        await describe('@gjsify/tls-native — symbolic constants', async () => {
            await it('exposes OcspCertStatus enum-style constants', () => {
                expect(OcspCertStatus.GOOD).toBe(0);
                expect(OcspCertStatus.REVOKED).toBe(1);
                expect(OcspCertStatus.UNKNOWN).toBe(2);
            });

            await it('exposes OcspResponseStatus enum-style constants', () => {
                expect(OcspResponseStatus.SUCCESSFUL).toBe(0);
                expect(OcspResponseStatus.MALFORMED_REQUEST).toBe(1);
                expect(OcspResponseStatus.INTERNAL_ERROR).toBe(2);
                expect(OcspResponseStatus.TRY_LATER).toBe(3);
                expect(OcspResponseStatus.SIG_REQUIRED).toBe(5);
                expect(OcspResponseStatus.UNAUTHORIZED).toBe(6);
            });

            await it('exposes TlsChannelBindingType enum-style constants', () => {
                expect(TlsChannelBindingType.TLS_UNIQUE).toBe(0);
                expect(TlsChannelBindingType.TLS_SERVER_END_POINT).toBe(1);
                expect(TlsChannelBindingType.TLS_EXPORTER).toBe(2);
            });
        });

        // Phase 2 (Path-A implementation): the SessionAccess native class
        // delegates to the C shim that walks the glib-networking GnuTLS
        // backend's private struct to extract gnutls_session_t and
        // forward to gnutls_session_get_data2 / set_data /
        // is_resumed / channel_binding. `is_supported()` now returns
        // true on any platform running glib-networking's GnuTLS
        // backend (Fedora 43+ defaults). Surface-only tests below;
        // round-trip resumption + channel-binding bytes are covered
        // by tests/integration/tls-session/ (real TLS handshake).
        await describe('@gjsify/tls-native — SessionAccess (Phase 2)', async () => {
            await it('exposes the SessionAccess class on the native module', () => {
                expect(nativeTls).not.toBeNull();
                expect(typeof nativeTls?.SessionAccess.is_supported).toBe('function');
                expect(typeof nativeTls?.SessionAccess.for_connection).toBe('function');
            });

            await it('hasTlsSessionAccess() returns true under glib-networking GnuTLS backend', () => {
                // Path-A: returns true on GnuTLS-backend runtimes (the
                // Fedora 43+ default). Would return false on a future
                // OpenSSL backend selected via `GIO_USE_TLS=openssl`.
                expect(hasTlsSessionAccess()).toBe(true);
            });

            await it('SessionAccess.is_supported() matches hasTlsSessionAccess()', () => {
                expect(nativeTls?.SessionAccess.is_supported()).toBe(true);
            });

            await it('createSessionAccess(null) returns null', () => {
                expect(createSessionAccess(null)).toBeNull();
            });

            await it('SessionAccess.for_connection(null) returns null', () => {
                expect(nativeTls?.SessionAccess.for_connection(null)).toBeNull();
            });
        });
    });
};
