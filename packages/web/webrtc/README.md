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

The GStreamer side comes from the system: `webrtcbin` (gst-plugins-bad) and libnice's
GStreamer plugin for ICE. On Fedora `dnf install gstreamer1-plugins-bad-free libnice-gstreamer1`,
on Debian/Ubuntu `apt install gstreamer1.0-plugins-bad gstreamer1.0-nice`, on macOS
`brew install gstreamer libnice-gstreamer`. The native bridge (`@gjsify/webrtc-native`)
ships prebuilt for `linux-{x64,arm64,ppc64,s390x,riscv64}` and `darwin-{arm64,x64}`.

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

## Audio device selection

On `ensureGstInit()` (the first `RTCPeerConnection`, `getUserMedia`, or any
other GStreamer-touching call), this package sets the `openalsrc` and
`openalsink` GStreamer plugin features' rank to `Gst.Rank.NONE` in the
**process-wide** GStreamer registry — it affects every pipeline in the
process, including ones built outside this package.

Why: `getUserMedia({ audio: true })`'s capture source falls through to
`autoaudiosrc` when PipeWire/Pulse/V4L2 aren't reachable, and `autoaudiosrc`
tries registered audio sources in rank order until one opens. `openalsrc`
(and its sink counterpart, reachable the same way through `autoaudiosink`)
is the one candidate whose `open()` does not fail fast: OpenAL Soft's
device backend runs its own nested connection probe synchronously inside
the GStreamer state change, which can stall the whole process for tens of
seconds (measured in CI — `[ALSOFT] Failed to connect PipeWire` followed by
30+ seconds of silence, hit while moving a shared track's source between
peer connections). `autoaudiosrc`/`autoaudiosink` already fall back to
`audiotestsrc`/`fakesink` when nothing opens, in well under 100ms —
deranking `openalsrc`/`openalsink` restores that existing fallback instead
of leaving it reachable through the one candidate that defeats it.

Set `GJSIFY_GST_KEEP_OPENAL=1` to opt out, if a host genuinely needs OpenAL
Soft as its audio backend. This also un-deranks `openalsink` for
`@gjsify/webaudio` if both are loaded in the same process — the two
packages share the one GStreamer registry.

## License

MIT
