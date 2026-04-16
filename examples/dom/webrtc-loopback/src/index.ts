// WebRTC data-channel loopback — two RTCPeerConnection instances in one
// GJS process exchange an offer/answer + ICE candidates, then message each
// other over a data channel.
//
// No imports needed: `gjsify build --globals auto` (the default) detects the
// RTCPeerConnection / process usage in the bundled output and injects the
// matching register subpaths (@gjsify/webrtc/register/peer-connection,
// @gjsify/node-globals/register/process) automatically.
//
// Run: yarn build && yarn start
// Prerequisite: GStreamer ≥ 1.20 with gst-plugins-bad + libnice-gstreamer1.

declare const print: ((msg: string) => void) | undefined;

function log(side: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${side}] ${msg}`);
    } else {
        console.log(`[${side}] ${msg}`);
    }
}

async function main(): Promise<void> {
    const pcA = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const pcB = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // State trace
    pcA.onsignalingstatechange = () => log('A', `signalingState → ${pcA.signalingState}`);
    pcB.onsignalingstatechange = () => log('B', `signalingState → ${pcB.signalingState}`);
    pcA.oniceconnectionstatechange = () => log('A', `iceConnectionState → ${pcA.iceConnectionState}`);
    pcB.oniceconnectionstatechange = () => log('B', `iceConnectionState → ${pcB.iceConnectionState}`);
    pcA.onconnectionstatechange = () => log('A', `connectionState → ${pcA.connectionState}`);
    pcB.onconnectionstatechange = () => log('B', `connectionState → ${pcB.connectionState}`);

    // Trickle ICE between A and B.
    pcA.onicecandidate = (ev) => {
        if (ev.candidate) {
            log('A→B', `ICE ${ev.candidate.type ?? '?'} ${ev.candidate.address ?? ''}:${ev.candidate.port ?? ''}`);
            pcB.addIceCandidate(ev.candidate.toJSON());
        }
    };
    pcB.onicecandidate = (ev) => {
        if (ev.candidate) {
            log('B→A', `ICE ${ev.candidate.type ?? '?'} ${ev.candidate.address ?? ''}:${ev.candidate.port ?? ''}`);
            pcA.addIceCandidate(ev.candidate.toJSON());
        }
    };

    // A creates the data channel. Once open, send a greeting.
    const channelA = pcA.createDataChannel('chat');
    channelA.onopen = () => {
        log('A', 'data-channel "chat" open — sending greeting');
        channelA.send('hello from peer A');
        channelA.send(new Uint8Array([1, 2, 3, 4]).buffer);
    };
    channelA.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
            log('A', `received: ${ev.data}`);
        } else {
            const arr = new Uint8Array(ev.data as ArrayBuffer);
            log('A', `received ArrayBuffer(${arr.length}): [${Array.from(arr).join(', ')}]`);
        }
    };

    // B awaits the incoming data channel, then echoes.
    pcB.ondatachannel = (ev) => {
        const channelB = ev.channel;
        log('B', `ondatachannel "${channelB.label}"`);
        channelB.onopen = () => log('B', 'data-channel "chat" open');
        channelB.onmessage = (mev) => {
            if (typeof mev.data === 'string') {
                log('B', `received: ${mev.data} — echoing back`);
                channelB.send(`echo: ${mev.data}`);
            } else {
                const arr = new Uint8Array(mev.data as ArrayBuffer);
                const reversed = new Uint8Array(arr).reverse();
                log('B', `received ArrayBuffer(${arr.length}) — echoing reversed`);
                channelB.send(reversed.buffer as ArrayBuffer);
            }
        };
    };

    // Handshake
    log('A', 'createOffer');
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    log('B', 'createAnswer');
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    // Quit a short time after the messages have echoed back.
    setTimeout(() => {
        log('main', 'demo complete — closing peer connections');
        pcA.close();
        pcB.close();
        setTimeout(() => process.exit(0), 100);
    }, 8000);
}

main().catch((err: any) => {
    log('ERROR', err?.message ?? String(err));
    process.exit(1);
});
