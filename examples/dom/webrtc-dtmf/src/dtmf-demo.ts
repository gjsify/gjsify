// WebRTC DTMF tone demo — send DTMF digits over an audio peer connection.
//
// Adapted from refs/webrtc-samples/src/content/peerconnection/dtmf/js/main.js
// Copyright (c) 2015 The WebRTC project authors. BSD license.
// Reimplemented for GJS using @gjsify/webrtc.
//
// Creates two local RTCPeerConnection instances, establishes an audio call
// via getUserMedia, then sends DTMF tones through the RTCDTMFSender.
// Logs each tonechange event as it fires.

export type LogFn = (tag: string, msg: string) => void;

const TONES = '1234#';
const TONE_DURATION = 100;  // ms per tone
const TONE_GAP = 70;        // ms between tones

export async function runDtmfDemo(log: LogFn): Promise<void> {
    log('main', 'Starting DTMF tone demo');

    // Get audio stream
    log('main', 'Requesting audio via getUserMedia...');
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
    });
    const audioTracks = stream.getAudioTracks();
    log('main', `Got audio stream with ${audioTracks.length} track(s)`);
    if (audioTracks.length > 0) {
        log('main', `Using audio device: ${audioTracks[0].label || '(default)'}`);
    }

    // Create peer connections
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();

    // ICE trickle
    pc1.onicecandidate = (ev) => {
        if (ev.candidate) pc2.addIceCandidate(ev.candidate).catch(() => {});
    };
    pc2.onicecandidate = (ev) => {
        if (ev.candidate) pc1.addIceCandidate(ev.candidate).catch(() => {});
    };

    // State logging
    pc1.onconnectionstatechange = () => log('pc1', `connectionState → ${pc1.connectionState}`);
    pc2.onconnectionstatechange = () => log('pc2', `connectionState → ${pc2.connectionState}`);

    // Wait for remote track on pc2
    const trackPromise = new Promise<void>((resolve) => {
        pc2.ontrack = (ev) => {
            log('pc2', `Received remote ${ev.track.kind} track`);
            resolve();
        };
    });

    // Add audio tracks to pc1
    stream.getTracks().forEach((track) => pc1.addTrack(track, stream));
    log('pc1', 'Added local audio track');

    // Offer/answer handshake
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);
    log('main', 'Offer/answer exchange complete');

    // Wait for track event on pc2
    await trackPromise;

    // Get DTMF sender
    const senders = pc1.getSenders();
    const audioSender = senders.find((s) => s.track?.kind === 'audio');
    if (!audioSender) {
        log('ERROR', 'No audio sender found');
        cleanup();
        return;
    }

    const dtmf = audioSender.dtmf;
    if (!dtmf) {
        log('ERROR', 'DTMF not available on audio sender');
        cleanup();
        return;
    }

    log('dtmf', 'RTCDTMFSender available');

    // Collect tonechange events
    const tonesReceived: string[] = [];
    const dtmfComplete = new Promise<void>((resolve) => {
        dtmf.ontonechange = (ev: any) => {
            if (ev.tone === '') {
                log('dtmf', 'All tones sent (empty sentinel received)');
                resolve();
            } else {
                tonesReceived.push(ev.tone);
                log('dtmf', `Tone sent: "${ev.tone}" (buffer remaining: "${dtmf.toneBuffer}")`);
            }
        };
    });

    // Send DTMF tones
    log('dtmf', `Sending tones "${TONES}" (duration=${TONE_DURATION}ms, gap=${TONE_GAP}ms)`);
    dtmf.insertDTMF(TONES, TONE_DURATION, TONE_GAP);

    // Wait for all tones or timeout
    await Promise.race([
        dtmfComplete,
        new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('DTMF timeout (10s)')), 10000),
        ),
    ]);

    const sentStr = tonesReceived.join('');
    log('main', `Tones sent: "${sentStr}"`);
    if (sentStr === TONES) {
        log('main', 'SUCCESS — All DTMF tones sent correctly!');
    } else {
        log('main', `MISMATCH — Expected "${TONES}", got "${sentStr}"`);
    }

    cleanup();

    function cleanup() {
        stream.getTracks().forEach((t) => t.stop());
        pc1.close();
        pc2.close();
        log('main', 'Done!');
    }
}
