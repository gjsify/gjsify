// RTCIceCandidate — W3C WebRTC ICE candidate descriptor.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCIceCandidate.ts (ISC)
//
// Field extraction (type/protocol/port/...) uses a minimal SDP candidate-line
// parser per RFC 5245 §15.1.

export interface RTCIceCandidateInit {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
}

export type RTCIceComponent = 'rtp' | 'rtcp';
export type RTCIceProtocol = 'udp' | 'tcp';
export type RTCIceCandidateType = 'host' | 'srflx' | 'prflx' | 'relay';
export type RTCIceTcpCandidateType = 'active' | 'passive' | 'so';

interface ParsedCandidate {
    foundation: string;
    component: RTCIceComponent | null;
    priority: number | null;
    protocol: RTCIceProtocol | null;
    address: string | null;
    port: number | null;
    type: RTCIceCandidateType | null;
    relatedAddress: string | null;
    relatedPort: number | null;
    tcpType: RTCIceTcpCandidateType | null;
}

function parseCandidate(line: string): Partial<ParsedCandidate> {
    // Accepts both `candidate:...` and raw `a=candidate:...` forms.
    let s = line.trim();
    if (s.startsWith('a=')) s = s.slice(2);
    if (s.startsWith('candidate:')) s = s.slice('candidate:'.length);

    const parts = s.split(/\s+/);
    if (parts.length < 8) return {};

    const protocolRaw = parts[2]?.toLowerCase();
    const typeIdx = parts.indexOf('typ');
    const typeRaw = typeIdx >= 0 ? parts[typeIdx + 1] : undefined;

    const raddrIdx = parts.indexOf('raddr');
    const rportIdx = parts.indexOf('rport');
    const tcpTypeIdx = parts.indexOf('tcptype');

    const componentId = Number(parts[1]);
    return {
        foundation: parts[0],
        component: componentId === 1 ? 'rtp' : componentId === 2 ? 'rtcp' : null,
        priority: Number(parts[3]) || null,
        protocol: (protocolRaw === 'udp' || protocolRaw === 'tcp') ? protocolRaw : null,
        address: parts[4] ?? null,
        port: Number(parts[5]) || null,
        type: (typeRaw === 'host' || typeRaw === 'srflx' || typeRaw === 'prflx' || typeRaw === 'relay') ? typeRaw : null,
        relatedAddress: raddrIdx >= 0 ? parts[raddrIdx + 1] ?? null : null,
        relatedPort: rportIdx >= 0 ? Number(parts[rportIdx + 1]) || null : null,
        tcpType: tcpTypeIdx >= 0
            ? (parts[tcpTypeIdx + 1] as RTCIceTcpCandidateType)
            : null,
    };
}

export class RTCIceCandidate {
    readonly candidate: string;
    readonly sdpMid: string | null;
    readonly sdpMLineIndex: number | null;
    readonly usernameFragment: string | null;
    readonly foundation: string | null;
    readonly component: RTCIceComponent | null;
    readonly priority: number | null;
    readonly protocol: RTCIceProtocol | null;
    readonly address: string | null;
    readonly port: number | null;
    readonly type: RTCIceCandidateType | null;
    readonly tcpType: RTCIceTcpCandidateType | null;
    readonly relatedAddress: string | null;
    readonly relatedPort: number | null;

    constructor(init: RTCIceCandidateInit = {}) {
        if (init.sdpMid == null && init.sdpMLineIndex == null) {
            throw new TypeError(
                'RTCIceCandidate requires either sdpMid or sdpMLineIndex',
            );
        }
        this.candidate = init.candidate ?? '';
        this.sdpMid = init.sdpMid ?? null;
        this.sdpMLineIndex = init.sdpMLineIndex ?? null;
        this.usernameFragment = init.usernameFragment ?? null;

        const parsed = parseCandidate(this.candidate);
        this.foundation = parsed.foundation ?? null;
        this.component = parsed.component ?? null;
        this.priority = parsed.priority ?? null;
        this.protocol = parsed.protocol ?? null;
        this.address = parsed.address ?? null;
        this.port = parsed.port ?? null;
        this.type = parsed.type ?? null;
        this.tcpType = parsed.tcpType ?? null;
        this.relatedAddress = parsed.relatedAddress ?? null;
        this.relatedPort = parsed.relatedPort ?? null;
    }

    toJSON(): RTCIceCandidateInit {
        return {
            candidate: this.candidate,
            sdpMid: this.sdpMid,
            sdpMLineIndex: this.sdpMLineIndex,
            usernameFragment: this.usernameFragment,
        };
    }
}
