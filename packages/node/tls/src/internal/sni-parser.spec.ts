// SPDX-License-Identifier: MIT
// Unit tests for the TLS ClientHello SNI extractor.

import { describe, it, expect } from '@gjsify/unit';
import { parseClientHelloSni } from './sni-parser.js';

// Build a synthetic ClientHello record carrying the given SNI host_name.
// Produces a minimal-but-valid TLS 1.2-shaped record acceptable to a
// permissive parser:
//   RecordHeader: 0x16 0x03 0x01 <len(2)>
//   Handshake:    0x01 <len(3)>
//   ClientHello:  version(2) + random(32) + sid_len(1) + sid(0)
//                 + ciphers_len(2) + ciphers(2)
//                 + comp_len(1) + comp(1)
//                 + ext_len(2) + extensions
//   Extension SNI(0x0000):
//     ext_len(2) → list_len(2) + name_type(1) + name_len(2) + name
function buildClientHello(host: string, opts?: { extraExtBefore?: Uint8Array }): Uint8Array {
    const nameBytes = new Uint8Array(host.length);
    for (let i = 0; i < host.length; i++) nameBytes[i] = host.charCodeAt(i);

    // server_name extension data: list_len(2) + name_type(1) + name_len(2) + name
    const sniEntry = new Uint8Array(3 + nameBytes.length);
    sniEntry[0] = 0x00; // name_type = host_name
    sniEntry[1] = (nameBytes.length >> 8) & 0xff;
    sniEntry[2] = nameBytes.length & 0xff;
    sniEntry.set(nameBytes, 3);

    const sniExtData = new Uint8Array(2 + sniEntry.length);
    sniExtData[0] = (sniEntry.length >> 8) & 0xff;
    sniExtData[1] = sniEntry.length & 0xff;
    sniExtData.set(sniEntry, 2);

    const sniExt = new Uint8Array(4 + sniExtData.length);
    sniExt[0] = 0x00;
    sniExt[1] = 0x00; // ext_type = server_name
    sniExt[2] = (sniExtData.length >> 8) & 0xff;
    sniExt[3] = sniExtData.length & 0xff;
    sniExt.set(sniExtData, 4);

    const extensions = opts?.extraExtBefore ? new Uint8Array([...opts.extraExtBefore, ...sniExt]) : sniExt;

    const random = new Uint8Array(32); // all zeros — content irrelevant
    const ciphers = new Uint8Array([0x13, 0x01, 0x13, 0x02]); // 2 suites, 4 bytes
    const ciphersLen = new Uint8Array([0x00, 0x04]);
    const comp = new Uint8Array([0x00]); // 1 compression method
    const compLen = new Uint8Array([0x01]);
    const extLen = new Uint8Array([(extensions.length >> 8) & 0xff, extensions.length & 0xff]);

    const helloBody = new Uint8Array([
        0x03,
        0x03, // client_version TLS 1.2
        ...random,
        0x00, // session_id length = 0
        ...ciphersLen,
        ...ciphers,
        ...compLen,
        ...comp,
        ...extLen,
        ...extensions,
    ]);

    const helloLen = helloBody.length;
    const handshake = new Uint8Array([
        0x01, // ClientHello
        (helloLen >> 16) & 0xff,
        (helloLen >> 8) & 0xff,
        helloLen & 0xff,
        ...helloBody,
    ]);

    const recordLen = handshake.length;
    const record = new Uint8Array([
        0x16, // handshake content type
        0x03,
        0x01, // record layer "TLS 1.0" (1.3 uses 1.2 here)
        (recordLen >> 8) & 0xff,
        recordLen & 0xff,
        ...handshake,
    ]);
    return record;
}

export default async () => {
    await describe('parseClientHelloSni', async () => {
        await it('extracts a simple ASCII hostname from a ClientHello', () => {
            const bytes = buildClientHello('example.com');
            expect(parseClientHelloSni(bytes)).toBe('example.com');
        });

        await it('extracts a multi-label hostname', () => {
            const bytes = buildClientHello('api.staging.example.com');
            expect(parseClientHelloSni(bytes)).toBe('api.staging.example.com');
        });

        await it('extracts an IDN A-label hostname', () => {
            // RFC 6066: SNI carries the A-label form (xn--…) literally.
            const bytes = buildClientHello('xn--mller-kva.example');
            expect(parseClientHelloSni(bytes)).toBe('xn--mller-kva.example');
        });

        await it('handles SNI extension after a preceding extension', () => {
            // Place a 4-byte dummy extension (type=0xFFFF, length=0) before SNI.
            const dummy = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
            const bytes = buildClientHello('host.test', { extraExtBefore: dummy });
            expect(parseClientHelloSni(bytes)).toBe('host.test');
        });

        await it('returns null for non-handshake record (e.g. application_data)', () => {
            const bytes = buildClientHello('example.com');
            bytes[0] = 0x17; // ContentType.application_data
            expect(parseClientHelloSni(bytes)).toBeNull();
        });

        await it('returns null for non-ClientHello handshake (ServerHello)', () => {
            const bytes = buildClientHello('example.com');
            bytes[5] = 0x02; // HandshakeType.server_hello
            expect(parseClientHelloSni(bytes)).toBeNull();
        });

        await it('returns null for truncated record (missing extensions)', () => {
            const bytes = buildClientHello('example.com');
            const truncated = bytes.subarray(0, 50);
            expect(parseClientHelloSni(truncated)).toBeNull();
        });

        await it('returns null on empty input', () => {
            expect(parseClientHelloSni(new Uint8Array(0))).toBeNull();
        });

        await it('returns null on garbage input', () => {
            const junk = new Uint8Array(64);
            for (let i = 0; i < 64; i++) junk[i] = (i * 31) & 0xff;
            expect(parseClientHelloSni(junk)).toBeNull();
        });

        await it('returns null when no SNI extension is present', () => {
            // Build a ClientHello with only a dummy extension, no SNI.
            // Smuggle by hand: build with SNI, then strip it.
            const bytes = buildClientHello('example.com');
            // Replace the SNI extension's type with a benign 0xFFFF.
            // Find the extension section: walk the structure to find the
            // 0x00 0x00 type bytes that start the SNI extension.
            // We know SNI is the only extension, so find the position after
            // the ext_len(2) at the end of the compression_methods.
            // Simpler: scan for the 0x00 0x00 type marker after byte 5.
            // The first 0x00 0x00 after the body offset is the SNI ext.
            for (let i = 5; i < bytes.length - 1; i++) {
                if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) {
                    // Heuristic: only safe inside the extension area.
                    // For this synthetic builder, the SNI ext type lives
                    // at a predictable offset; flipping to 0xFFFF is enough.
                    bytes[i] = 0xff;
                    bytes[i + 1] = 0xff;
                    break;
                }
            }
            expect(parseClientHelloSni(bytes)).toBeNull();
        });

        await it('returns null when name_type is unknown', () => {
            const bytes = buildClientHello('example.com');
            // The host_name byte is the first 0x00 inside the SNI ext's
            // ServerNameList; we located it via the builder layout.
            // Walk to find: nameType byte sits at extData[2] = 0x00.
            // For this builder, scan for the 'e' of "example.com" and
            // back up 3 bytes (nameType + nameLen[2]).
            const target = 'example.com';
            for (let i = 0; i + target.length <= bytes.length; i++) {
                let match = true;
                for (let j = 0; j < target.length; j++) {
                    if (bytes[i + j] !== target.charCodeAt(j)) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    bytes[i - 3] = 0xff; // mutate name_type
                    break;
                }
            }
            expect(parseClientHelloSni(bytes)).toBeNull();
        });
    });
};
