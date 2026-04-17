# WebRTC DTMF — Tone Sender

Demonstrates sending DTMF (Dual-Tone Multi-Frequency) digits over a WebRTC audio connection.

Adapted from the [webrtc-samples dtmf](https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/dtmf) example.

## What it does

1. Captures audio via `getUserMedia({ audio: true })`
2. Creates two local `RTCPeerConnection` instances
3. Adds the audio track to peer 1 and performs offer/answer
4. Obtains the `RTCDTMFSender` from the audio sender (`sender.dtmf`)
5. Sends DTMF tones "1234#" with 100ms duration and 70ms gap
6. Logs each `tonechange` event as tones are sent
7. Verifies all tones were sent correctly

## What it demonstrates

- `RTCPeerConnection.getSenders()` to find the audio sender
- `RTCRtpSender.dtmf` — accessing the `RTCDTMFSender` interface
- `RTCDTMFSender.insertDTMF(tones, duration, gap)` — queueing tones
- `RTCDTMFSender.toneBuffer` — remaining tones in the queue
- `ontonechange` event with `tone` property (empty string = sentinel for completion)
- Audio peer connection setup: `getUserMedia` → `addTrack` → offer/answer

## Prerequisites

- PipeWire or PulseAudio audio backend (GStreamer uses `pipewiresrc`/`pulsesrc`)

## Output

```
[main] Requesting audio via getUserMedia...
[main] Got audio stream with 1 track(s)
[main] Offer/answer exchange complete
[dtmf] RTCDTMFSender available
[dtmf] Sending tones "1234#" (duration=100ms, gap=70ms)
[dtmf] Tone sent: "1" (buffer remaining: "234#")
[dtmf] Tone sent: "2" (buffer remaining: "34#")
[dtmf] Tone sent: "3" (buffer remaining: "4#")
[dtmf] Tone sent: "4" (buffer remaining: "#")
[dtmf] Tone sent: "#" (buffer remaining: "")
[dtmf] All tones sent (empty sentinel received)
[main] Tones sent: "1234#"
[main] SUCCESS — All DTMF tones sent correctly!
```

## Run

```bash
yarn build && yarn start
```
