// WebRTC trickle ICE demo — collect and display ICE candidates.
//
// Adapted from refs/webrtc-samples/src/content/peerconnection/trickle-ice/js/main.js
// Copyright (c) 2015 The WebRTC project authors. BSD license.
// Reimplemented for GJS using @gjsify/webrtc.
//
// Creates two local RTCPeerConnection instances, performs offer/answer, and
// collects all ICE candidates as they trickle in from the offerer. GStreamer's
// webrtcbin only emits ICE candidates after a full offer/answer exchange and
// pipeline state change to PLAYING, so a second peer is required.

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

    const pc1 = new RTCPeerConnection(config);
    const pc2 = new RTCPeerConnection(config);
    const candidates: CandidateInfo[] = [];
    const begin = performance.now();

    log('main', `Initial iceGatheringState: ${pc1.iceGatheringState}`);

    return new Promise<CandidateInfo[]>((resolve, reject) => {
        let gatheringComplete = false;

        // Collect candidates from pc1 and forward to pc2
        pc1.onicecandidate = (event) => {
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
                // Forward to pc2 for connectivity
                pc2.addIceCandidate(c).catch(() => {});
            }
        };

        // Also forward pc2 candidates to pc1
        pc2.onicecandidate = (ev) => {
            if (ev.candidate) pc1.addIceCandidate(ev.candidate).catch(() => {});
        };

        pc1.onicegatheringstatechange = () => {
            log('state', `pc1 iceGatheringState → ${pc1.iceGatheringState}`);

            // Resolve when all candidates have been gathered
            if (pc1.iceGatheringState === 'complete' && !gatheringComplete) {
                gatheringComplete = true;
                printResults();
                resolve(candidates);
            }
        };

        pc1.oniceconnectionstatechange = () => {
            log('state', `pc1 iceConnectionState → ${pc1.iceConnectionState}`);
        };

        function printResults() {
            const elapsed = ((performance.now() - begin) / 1000).toFixed(3);
            log('main', `Gathering done — ${candidates.length} candidate(s) in ${elapsed}s`);
            log('table', '──────────────────────────────────────────────────────────');
            log('table', 'Type   Proto Address                Port   Priority');
            log('table', '──────────────────────────────────────────────────────────');
            for (const c of candidates) {
                log('table', `${c.type.padEnd(6)} ${c.protocol.padEnd(5)} ${c.address.padEnd(22)} ${String(c.port).padEnd(6)} ${c.priority}`);
            }
            log('table', '──────────────────────────────────────────────────────────');
            pc1.close();
            pc2.close();
        }

        // Create a data channel to generate an m= line
        pc1.createDataChannel('ice-probe');

        pc1.createOffer()
            .then((offer) => pc1.setLocalDescription(offer))
            .then(() => pc2.setRemoteDescription(pc1.localDescription!))
            .then(() => pc2.createAnswer())
            .then((answer) => pc2.setLocalDescription(answer))
            .then(() => pc1.setRemoteDescription(pc2.localDescription!))
            .then(() => log('main', 'Offer/answer exchange complete — gathering ICE candidates...'))
            .catch((err) => {
                log('ERROR', `Handshake failed: ${err.message}`);
                pc1.close();
                pc2.close();
                reject(err);
            });

        // Timeout after 15s — print whatever we have
        setTimeout(() => {
            if (!gatheringComplete) {
                gatheringComplete = true;
                log('main', `Timeout — ${candidates.length} candidate(s) gathered`);
                printResults();
                resolve(candidates);
            }
        }, 15000);
    });
}
