// SDP-level RTP/ICE parameter helpers for @gjsify/webrtc.
//
// Pure string-level functions — no GStreamer imports — so everything here
// stays unit-testable without a pipeline.

import { fillRandomBytes } from '@gjsify/webcrypto/random';

// RFC 8839 § 5.4: ice-char = ALPHA / DIGIT / "+" / "/". The ufrag must be
// 4–256 ice-chars, the password 22–256.
const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function randomIceString(length: number): string {
    const bytes = new Uint8Array(length);
    fillRandomBytes(bytes);
    let out = '';
    for (const b of bytes) out += ICE_CHARS[b & 63];
    return out;
}

/**
 * Rewrite every `a=ice-ufrag:` / `a=ice-pwd:` line of an SDP with freshly
 * generated credentials — the JSEP ICE-restart primitive (RFC 9429 § 3.5.1:
 * "an ICE restart is indicated by generating new ICE ufrag and pwd in the
 * offer"; W3C WebRTC § 4.4.3.2 restartIce). Distinct old values map to
 * distinct new values, and a value repeated across m-sections
 * (BUNDLE-shared credentials) keeps sharing ONE new value, preserving the
 * offer's credential topology.
 *
 * Why rewriting instead of an engine option: GStreamer webrtcbin (≤ 1.28)
 * ignores the `ice-restart` field of the create-offer options structure
 * (measured: identical ufrag with and without it), but it DOES push the
 * local credentials of a set-local-description SDP into its ICE agent —
 * measured end-to-end: two webrtcbins complete ICE connectivity with a
 * munged ufrag/pwd offer. The SDP is therefore the supported carrier for
 * fresh local credentials.
 */
export function rewriteIceCredentials(sdp: string): string {
    const ufragMap = new Map<string, string>();
    const pwdMap = new Map<string, string>();
    return sdp
        .split('\r\n')
        .map((line) => {
            if (line.startsWith('a=ice-ufrag:')) {
                const old = line.slice('a=ice-ufrag:'.length);
                if (!ufragMap.has(old)) ufragMap.set(old, randomIceString(8));
                return `a=ice-ufrag:${ufragMap.get(old)}`;
            }
            if (line.startsWith('a=ice-pwd:')) {
                const old = line.slice('a=ice-pwd:'.length);
                if (!pwdMap.has(old)) pwdMap.set(old, randomIceString(24));
                return `a=ice-pwd:${pwdMap.get(old)}`;
            }
            return line;
        })
        .join('\r\n');
}
