// SDP-level RTP/ICE parameter helpers for @gjsify/webrtc.
//
// Backs RTCRtpSender.getParameters()'s `codecs` / `headerExtensions` /
// `rtcp` fields (W3C WebRTC § 5.2: "The codecs sequence is populated based
// on the codecs that have been negotiated for sending, … in the priority
// order indicated by the remote description" — the negotiated set lives in
// the applied session descriptions) and restartIce's credential rewrite.
// Grammar references: SDP RFC 8866 (§ 5.14 m=, § 6.6 rtpmap, § 6.15 fmtp),
// RFC 8285 § 5 (extmap), RFC 5506 (rtcp-rsize), RFC 5888 (mid).
//
// Pure string-level functions — no GStreamer imports — so everything here
// stays unit-testable without a pipeline.

import { fillRandomBytes } from '@gjsify/webcrypto/random';

export interface SdpCodecParams {
    payloadType: number;
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

export interface SdpHeaderExtensionParams {
    uri: string;
    id: number;
}

export interface SdpMediaSectionParams {
    codecs: SdpCodecParams[];
    headerExtensions: SdpHeaderExtensionParams[];
    /** `a=rtcp-rsize` present (RFC 5506 reduced-size RTCP). */
    reducedSize: boolean;
}

export interface SdpMediaSectionSelector {
    /** Match by `a=mid:<mid>` (RFC 5888) — the most precise selector. */
    mid?: string;
    /** Fall back to the m-section at this index (JSEP m-line order). */
    mlineIndex?: number;
    /** Last resort: the first m-section of this media kind. */
    kind?: 'audio' | 'video';
}

/**
 * Extract the negotiated codec/extension/rtcp parameters for ONE m-section
 * of an SDP document. Returns `null` when no section matches the selector
 * (e.g. before any negotiation completed).
 */
export function parseMediaSectionParams(
    sdp: string,
    selector: SdpMediaSectionSelector,
): SdpMediaSectionParams | null {
    const sections: string[][] = [];
    let current: string[] | null = null;
    for (const rawLine of sdp.split(/\r\n|\r|\n/)) {
        const line = rawLine.trimEnd();
        if (line.startsWith('m=')) {
            current = [line];
            sections.push(current);
        } else if (current && line.length > 0) {
            current.push(line);
        }
    }

    let target: string[] | undefined;
    if (selector.mid !== undefined) {
        target = sections.find((s) => s.includes(`a=mid:${selector.mid}`));
    }
    if (!target && selector.mlineIndex !== undefined && selector.mlineIndex >= 0) {
        target = sections[selector.mlineIndex];
    }
    if (!target && selector.kind !== undefined) {
        target = sections.find((s) => s[0].startsWith(`m=${selector.kind} `));
    }
    if (!target) return null;

    // m=<media> <port> <proto> <fmt> … — the fmt list is the payload-type
    // priority order (RFC 8866 § 5.14).
    const mLineParts = target[0].split(' ');
    const mediaKind = mLineParts[0].slice(2);
    const payloadOrder = mLineParts.slice(3).map(Number).filter(Number.isInteger);

    const rtpmap = new Map<number, { encoding: string; clockRate: number; channels?: number }>();
    const fmtp = new Map<number, string>();
    const headerExtensions: SdpHeaderExtensionParams[] = [];
    let reducedSize = false;

    for (const line of target) {
        let m = /^a=rtpmap:(\d+) ([^/]+)\/(\d+)(?:\/(\d+))?/.exec(line);
        if (m) {
            const entry: { encoding: string; clockRate: number; channels?: number } = {
                encoding: m[2],
                clockRate: Number(m[3]),
            };
            if (m[4] !== undefined) entry.channels = Number(m[4]);
            rtpmap.set(Number(m[1]), entry);
            continue;
        }
        m = /^a=fmtp:(\d+) (.+)/.exec(line);
        if (m) {
            fmtp.set(Number(m[1]), m[2]);
            continue;
        }
        // a=extmap:<id>[/<direction>] <uri> [<ext-attributes>] (RFC 8285 § 5)
        m = /^a=extmap:(\d+)(?:\/\S+)? (\S+)/.exec(line);
        if (m) {
            headerExtensions.push({ id: Number(m[1]), uri: m[2] });
            continue;
        }
        if (line === 'a=rtcp-rsize') {
            reducedSize = true;
        }
    }

    const codecs: SdpCodecParams[] = [];
    for (const pt of payloadOrder) {
        const entry = rtpmap.get(pt);
        if (!entry) continue;
        const codec: SdpCodecParams = {
            payloadType: pt,
            mimeType: `${mediaKind}/${entry.encoding}`,
            clockRate: entry.clockRate,
        };
        if (entry.channels !== undefined) codec.channels = entry.channels;
        const fmtpLine = fmtp.get(pt);
        if (fmtpLine !== undefined) codec.sdpFmtpLine = fmtpLine;
        codecs.push(codec);
    }

    return { codecs, headerExtensions, reducedSize };
}

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
