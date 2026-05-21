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
// STATUS.md "Open TODOs" as the "OCSP integration test" follow-up.

import { describe, it, expect, on } from '@gjsify/unit';
import { hasNativeTls, nativeTls, parseOcspResponse, OcspCertStatus, OcspResponseStatus } from './index.js';

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
        });
    });
};
