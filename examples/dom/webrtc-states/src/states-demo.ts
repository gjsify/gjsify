// WebRTC connection states demo — track state transitions during a call.
//
// Adapted from refs/webrtc-samples/src/content/peerconnection/states/js/main.js
// Copyright (c) 2015 The WebRTC project authors. BSD license.
// Reimplemented for GJS using @gjsify/webrtc.
//
// Creates two local peers, establishes a video call, and logs every state
// transition (signalingState, iceConnectionState, connectionState) for both
// peers. Provides callbacks for UI updates.

export type LogFn = (tag: string, msg: string) => void;

export interface StateCallbacks {
    onPc1Signal: (state: string) => void;
    onPc1Ice: (state: string) => void;
    onPc1Conn: (state: string) => void;
    onPc2Signal: (state: string) => void;
    onPc2Ice: (state: string) => void;
    onPc2Conn: (state: string) => void;
    onRemoteStream: (stream: MediaStream) => void;
}

export async function runStatesDemo(
    log: LogFn,
    localVideo: HTMLVideoElement | null,
    callbacks: StateCallbacks,
): Promise<{ hangup: () => void }> {
    log('main', 'Starting connection states demo');

    // Get local media
    log('main', 'Requesting video via getUserMedia...');
    const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
    });
    log('main', `Got local stream with ${localStream.getVideoTracks().length} video track(s)`);

    if (localVideo) {
        localVideo.srcObject = localStream;
    }

    // Create peer connections
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();

    // State change callbacks
    pc1.onsignalingstatechange = () => {
        const s = pc1.signalingState;
        log('pc1', `signalingState → ${s}`);
        callbacks.onPc1Signal(s);
    };
    pc1.oniceconnectionstatechange = () => {
        const s = pc1.iceConnectionState;
        log('pc1', `iceConnectionState → ${s}`);
        callbacks.onPc1Ice(s);
    };
    pc1.onconnectionstatechange = () => {
        const s = pc1.connectionState;
        log('pc1', `connectionState → ${s}`);
        callbacks.onPc1Conn(s);
    };

    pc2.onsignalingstatechange = () => {
        const s = pc2.signalingState;
        log('pc2', `signalingState → ${s}`);
        callbacks.onPc2Signal(s);
    };
    pc2.oniceconnectionstatechange = () => {
        const s = pc2.iceConnectionState;
        log('pc2', `iceConnectionState → ${s}`);
        callbacks.onPc2Ice(s);
    };
    pc2.onconnectionstatechange = () => {
        const s = pc2.connectionState;
        log('pc2', `connectionState → ${s}`);
        callbacks.onPc2Conn(s);
    };

    // Log initial states
    callbacks.onPc1Signal(pc1.signalingState);
    callbacks.onPc1Ice(pc1.iceConnectionState);
    callbacks.onPc1Conn(pc1.connectionState);
    callbacks.onPc2Signal(pc2.signalingState);
    callbacks.onPc2Ice(pc2.iceConnectionState);
    callbacks.onPc2Conn(pc2.connectionState);

    // ICE trickle
    pc1.onicecandidate = (ev) => {
        if (ev.candidate) {
            pc2.addIceCandidate(ev.candidate).catch((e) =>
                log('pc1', `addIceCandidate error: ${e.message}`));
        }
    };
    pc2.onicecandidate = (ev) => {
        if (ev.candidate) {
            pc1.addIceCandidate(ev.candidate).catch((e) =>
                log('pc2', `addIceCandidate error: ${e.message}`));
        }
    };

    // Remote stream
    pc2.ontrack = (ev) => {
        log('pc2', `Got remote ${ev.track.kind} track`);
        if (ev.streams[0]) {
            callbacks.onRemoteStream(ev.streams[0]);
        }
    };

    // Add local tracks to pc1
    localStream.getTracks().forEach((track) => pc1.addTrack(track, localStream));
    log('main', 'Added local tracks to pc1');

    // Offer/answer
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);
    log('main', 'Offer/answer exchange complete');

    // Return hangup function for UI control
    return {
        hangup() {
            log('main', 'Hanging up');
            pc1.close();
            pc2.close();

            // Log final states after close
            callbacks.onPc1Signal(pc1.signalingState);
            callbacks.onPc2Signal(pc2.signalingState);
            callbacks.onPc1Ice(pc1.iceConnectionState);
            callbacks.onPc2Ice(pc2.iceConnectionState);
            callbacks.onPc1Conn(pc1.connectionState);
            callbacks.onPc2Conn(pc2.connectionState);

            localStream.getTracks().forEach((t) => t.stop());
            log('main', 'Done!');
        },
    };
}
