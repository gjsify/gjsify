// SPDX-License-Identifier: MIT
// Implements ClientHello server_name (SNI) extraction per:
//   RFC 5246  (TLS 1.2 ClientHello)
//   RFC 8446  (TLS 1.3 ClientHello — same outer record/handshake shape)
//   RFC 6066 §3 (Server Name Indication extension)
//   RFC 8449  (record_size_limit — orthogonal, not parsed here)
//
// Used by `@gjsify/tls`'s server-side path to drive `SNICallback` /
// `addContext()` selection from the actual ClientHello bytes, peeked
// before `Gio.TlsServerConnection.new()` consumes them.

/**
 * Parse a TLS ClientHello record and extract the SNI host_name, if any.
 *
 * Inspects `bytes` as a TLS record (`content_type=Handshake`, handshake
 * type `ClientHello`), walks the extensions list, and returns the first
 * `server_name` entry of `NameType=host_name` (RFC 6066 §3).
 *
 * Returns `null` if:
 *   - the record is truncated;
 *   - the record is not a Handshake record or the handshake is not a
 *     ClientHello;
 *   - the ClientHello has no SNI extension or no `host_name` entry.
 *
 * Never throws; all bounds violations are treated as "no SNI".
 */
export function parseClientHelloSni(bytes: Uint8Array): string | null {
    if (bytes.length < 11) return null;

    // TLS record header: ContentType(1) + Version(2) + Length(2)
    if (bytes[0] !== 0x16) return null; // ContentType.handshake = 22
    if (bytes[1] !== 0x03) return null; // SSLv3 / TLS 1.x
    const recordLen = (bytes[3]! << 8) | bytes[4]!;
    if (recordLen < 4) return null;
    const recordEnd = 5 + recordLen;
    if (bytes.length < recordEnd) return null;

    let p = 5;

    // Handshake header: type(1) + length(3, big-endian)
    if (bytes[p] !== 0x01) return null; // HandshakeType.client_hello = 1
    const helloLen = (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!;
    p += 4;
    const helloEnd = p + helloLen;
    if (helloEnd > recordEnd) return null;

    // ClientHello body: client_version(2) + random(32)
    if (p + 34 > helloEnd) return null;
    p += 34;

    // session_id: opaque<0..32>
    if (p >= helloEnd) return null;
    const sidLen = bytes[p]!;
    p += 1 + sidLen;
    if (p > helloEnd) return null;

    // cipher_suites: opaque<2..2^16-2>
    if (p + 2 > helloEnd) return null;
    const cipherLen = (bytes[p]! << 8) | bytes[p + 1]!;
    p += 2 + cipherLen;
    if (p > helloEnd) return null;

    // compression_methods: opaque<1..2^8-1>
    if (p + 1 > helloEnd) return null;
    const compLen = bytes[p]!;
    p += 1 + compLen;
    if (p > helloEnd) return null;

    // extensions: opaque<0..2^16-1> — absent on TLS 1.0 SSLv3-style hellos
    if (p === helloEnd) return null;
    if (p + 2 > helloEnd) return null;
    const extTotalLen = (bytes[p]! << 8) | bytes[p + 1]!;
    p += 2;
    const extEnd = p + extTotalLen;
    if (extEnd > helloEnd) return null;

    while (p + 4 <= extEnd) {
        const extType = (bytes[p]! << 8) | bytes[p + 1]!;
        const extLen = (bytes[p + 2]! << 8) | bytes[p + 3]!;
        p += 4;
        const extDataEnd = p + extLen;
        if (extDataEnd > extEnd) return null;

        if (extType === 0x0000) {
            // server_name extension (RFC 6066 §3).
            // ServerNameList: opaque<1..2^16-1>
            if (p + 2 > extDataEnd) return null;
            const listLen = (bytes[p]! << 8) | bytes[p + 1]!;
            const listStart = p + 2;
            const listEnd = listStart + listLen;
            if (listEnd > extDataEnd) return null;

            let q = listStart;
            while (q + 3 <= listEnd) {
                const nameType = bytes[q]!;
                const nameLen = (bytes[q + 1]! << 8) | bytes[q + 2]!;
                q += 3;
                if (q + nameLen > listEnd) return null;
                if (nameType === 0x00) {
                    // host_name: opaque HostName<1..2^16-1>. Spec: 7-bit ASCII,
                    // already in A-label form for IDN. Decode literally.
                    let host = '';
                    for (let i = 0; i < nameLen; i++) {
                        host += String.fromCharCode(bytes[q + i]!);
                    }
                    return host;
                }
                q += nameLen;
            }
            // server_name extension present but no host_name entry.
            return null;
        }
        p = extDataEnd;
    }
    return null;
}
