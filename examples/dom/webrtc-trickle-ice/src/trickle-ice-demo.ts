// WebRTC trickle ICE demo — collect and display ICE candidates.
//
// Adapted from refs/webrtc-samples/src/content/peerconnection/trickle-ice/js/main.js
// Copyright (c) 2015 The WebRTC project authors. BSD license.
// Reimplemented for GJS using @gjsify/webrtc.
//
// Creates a single RTCPeerConnection with a STUN server, generates an offer,
// and collects all ICE candidates as they trickle in. No second peer or media
// stream is needed — this is a diagnostic tool for verifying ICE connectivity.

export type LogFn = (tag: string, msg: string) => void;

export interface CandidateInfo {
    elapsed: string;
    type: string;
    foundation: string;
    protocol: string;
    address: string;
    port: number;
    priority: string;
}

/** Parse RFC 5245 uint32 PRIORITY into type|local|component parts. */
function formatPriority(priority: number): string {
    return [
        priority >> 24,
        (priority >> 8) & 0xFFFF,
        priority & 0xFF,
    ].join(' | ');
}

export async function runTrickleIceDemo(
    log: LogFn,
    stunUrl = 'stun:stun.l.google.com:19302',
): Promise<CandidateInfo[]> {
    log('main', 'Starting ICE candidate gathering demo');
    log('main', `STUN server: ${stunUrl}`);

    const config: RTCConfiguration = {
        iceServers: [{ urls: stunUrl }],
    };

    const pc = new RTCPeerConnection(config);
    const candidates: CandidateInfo[] = [];
    const begin = performance.now();

    log('main', `Initial iceGatheringState: ${pc.iceGatheringState}`);

    return new Promise<CandidateInfo[]>((resolve, reject) => {
        pc.onicecandidate = (event) => {
            const elapsed = ((performance.now() - begin) / 1000).toFixed(3);

            if (event.candidate && event.candidate.candidate !== '') {
                const c = event.candidate;
                const info: CandidateInfo = {
                    elapsed,
                    type: c.type ?? '?',
                    foundation: c.foundation ?? '',
                    protocol: c.protocol ?? '',
                    address: c.address ?? '',
                    port: c.port ?? 0,
                    priority: formatPriority(c.priority ?? 0),
                };
                candidates.push(info);
                log('candidate', `${info.type.padEnd(6)} ${info.protocol.padEnd(4)} ${info.address}:${info.port} (priority: ${info.priority}) [${elapsed}s]`);
            }
        };

        pc.onicegatheringstatechange = () => {
            log('state', `iceGatheringState → ${pc.iceGatheringState}`);

            if (pc.iceGatheringState === 'complete') {
                const elapsed = ((performance.now() - begin) / 1000).toFixed(3);
                log('main', `Gathering complete — ${candidates.length} candidate(s) in ${elapsed}s`);

                // Print summary table
                log('table', '──────────────────────────────────────────────────────────');
                log('table', 'Type   Proto Address                Port   Priority');
                log('table', '──────────────────────────────────────────────────────────');
                for (const c of candidates) {
                    log('table', `${c.type.padEnd(6)} ${c.protocol.padEnd(5)} ${c.address.padEnd(22)} ${String(c.port).padEnd(6)} ${c.priority}`);
                }
                log('table', '──────────────────────────────────────────────────────────');

                pc.close();
                resolve(candidates);
            }
        };

        (pc as any).onicecandidateerror = (e: any) => {
            log('error', `ICE candidate error: code=${e.errorCode} ${e.errorText ?? ''} (${e.url ?? ''})`);
        };

        // Create an audio transceiver to generate an m= line in the SDP
        pc.addTransceiver('audio');

        pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .catch((err) => {
                log('ERROR', `createOffer failed: ${err.message}`);
                pc.close();
                reject(err);
            });

        // Timeout after 30s
        setTimeout(() => {
            if (pc.iceGatheringState !== 'complete') {
                log('main', `Timeout — ${candidates.length} candidate(s) gathered so far`);
                pc.close();
                resolve(candidates);
            }
        }, 30000);
    });
}
