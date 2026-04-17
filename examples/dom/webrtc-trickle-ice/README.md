# WebRTC Trickle ICE — ICE Candidate Gatherer

Diagnostic tool that collects and displays all ICE candidates gathered during a WebRTC connection setup.

Adapted from the [webrtc-samples trickle-ice](https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/trickle-ice) example.

## What it does

1. Creates two local `RTCPeerConnection` instances with a STUN server (`stun:stun.l.google.com:19302`)
2. Creates a data channel to generate an `m=` line in the SDP
3. Performs offer/answer handshake
4. Collects all ICE candidates from the offerer as they trickle in
5. Prints a formatted table showing type, protocol, address, port, and priority

## What it demonstrates

- ICE candidate gathering via `onicecandidate` events
- `onicegatheringstatechange` lifecycle (`new` → `gathering` → `complete`)
- Candidate types: `host` (local), `srflx` (STUN-reflected), `relay` (TURN)
- RFC 5245 priority parsing (type preference | local preference | component ID)
- STUN server connectivity verification
- GStreamer webrtcbin ICE agent behavior

## Output

```
[candidate] host   udp  192.168.178.161:43496       (priority: 120 | 8193 | 255) [0.050s]
[candidate] host   tcp  192.168.178.161:9            (priority: 60 | 32769 | 255) [0.050s]
[candidate] srflx  udp  89.245.28.3:7750             (priority: 100 | 8193 | 255) [0.107s]
──────────────────────────────────────────────────────────
Type   Proto Address                Port   Priority
──────────────────────────────────────────────────────────
host   udp   192.168.178.161        43496  120 | 8193 | 255
srflx  udp   89.245.28.3            7750   100 | 8193 | 255
──────────────────────────────────────────────────────────
```

## Run

```bash
yarn build && yarn start
```
