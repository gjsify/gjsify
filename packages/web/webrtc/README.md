# @gjsify/webrtc

Full W3C WebRTC implementation for GJS backed by GStreamer's `webrtcbin`. Provides `RTCPeerConnection`, `RTCDataChannel` (string and binary), `RTCRtpSender`/`Receiver`/`Transceiver`, `MediaStream`, `MediaStreamTrack`, `getUserMedia` (PipeWire/PulseAudio/V4L2 fallback chain), `RTCDTMFSender`, `RTCCertificate`, `RTCStatsReport`, and `RTCIceCandidate`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webrtc

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webrtc
yarn add @gjsify/webrtc
```

## Usage

```typescript
import { RTCPeerConnection, RTCSessionDescription, getUserMedia } from '@gjsify/webrtc';

const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
});

// Add a local media track
const stream = await getUserMedia({ video: true, audio: true });
for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
}

// Create and set an SDP offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

pc.onicecandidate = (event) => {
    if (event.candidate) {
        // Send event.candidate to the remote peer via your signalling channel
    }
};
```

## License

MIT
