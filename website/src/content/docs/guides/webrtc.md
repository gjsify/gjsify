---
title: WebRTC & Media Capture
description: Peer connections, data channels and getUserMedia on GJS, backed by GStreamer webrtcbin. How a capture device gets picked, and the limits that will bite you.
---

`@gjsify/webrtc` is the W3C WebRTC API on GJS, with GStreamer's `webrtcbin` underneath. You get
`RTCPeerConnection` and the full offer/answer/ICE handshake, `RTCDataChannel` for strings and
binary, the `RTCRtpSender` / `Receiver` / `Transceiver` trio, `MediaStream`, `MediaStreamTrack`
and `getUserMedia`, plus `RTCDTMFSender`, `RTCCertificate` and `RTCStatsReport`.

You write the code you would write for a browser. The package supplies the globals.

## Install

```bash
gjsify install @gjsify/webrtc
```

The GStreamer side is not bundled. WebRTC needs GStreamer 1.20 or newer with the WebRTC plugin
and libnice:

```bash
# Fedora
sudo dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras libnice-gstreamer1

# Ubuntu / Debian
sudo apt install gstreamer1.0-plugins-bad gstreamer1.0-nice
```

Check that both arrived:

```bash
gst-inspect-1.0 webrtcbin
gst-inspect-1.0 nicesrc
gjsify system-check          # GJS plus the optional GStreamer pieces
```

A handshake that stalls at `checking` and never reaches `connected` is almost always one of
those two missing.

## A data channel, end to end

Two peer connections in one process, no signalling server: hand each side's SDP and ICE
candidates straight to the other. This is the whole API in about forty lines.

```ts
import GLib from 'gi://GLib?version=2.0';

const loop = GLib.MainLoop.new(null, false);

const pcA = new RTCPeerConnection();
const pcB = new RTCPeerConnection();

// No signalling server: hand each candidate straight to the other peer.
pcA.onicecandidate = (ev) => {
    if (ev.candidate) void pcB.addIceCandidate(ev.candidate.toJSON()).catch(() => {});
};
pcB.onicecandidate = (ev) => {
    if (ev.candidate) void pcA.addIceCandidate(ev.candidate.toJSON()).catch(() => {});
};

// B echoes whatever it is sent.
pcB.ondatachannel = (ev) => {
    const channel = ev.channel;
    channel.onmessage = (msg) => channel.send(`echo: ${msg.data as string}`);
};

const chat = pcA.createDataChannel('chat');
chat.onopen = () => {
    console.log(`channel "${chat.label}" open, id ${chat.id}`);
    chat.send('hello from peer A');
};
chat.onmessage = (ev) => {
    console.log(`A received: ${ev.data as string}`);
    pcA.close();
    pcB.close();
    loop.quit();
};

const offer = await pcA.createOffer();
await pcA.setLocalDescription(offer);
await pcB.setRemoteDescription(offer);

const answer = await pcB.createAnswer();
await pcB.setLocalDescription(answer);
await pcA.setRemoteDescription(answer);

loop.run();
```

```bash
gjsify build src/main.ts --app gjs --outfile dist/main.gjs.mjs
gjsify run dist/main.gjs.mjs
```

```
channel "chat" open, id 1
A received: echo: hello from peer A
```

Three things in there are worth pulling out.

**Nothing imports `@gjsify/webrtc`.** The default `--globals auto` sees `RTCPeerConnection` in
your source and injects the matching register module for you.
[CLI reference](/gjsify/cli-reference/) lists which global comes from which subpath, if you
would rather import them by hand.

**It needs a running main loop, not a window.** WebRTC is driven by GLib main-context callbacks,
so a headless `GLib.MainLoop` is enough — but without one the handshake never progresses.

**`addIceCandidate` returns a promise, and it rejects.** Server-reflexive candidates come back
from a STUN server long after the local host candidates do, so on a short-lived connection they
routinely land *after* `close()` and reject with `InvalidStateError`. That is expected; a bare
call leaves an unhandled rejection per candidate, which GJS reports and your exit code does not.

## Capturing audio and video

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
```

It is a named export too, if you would rather not go through the global.

Every track is backed by a GStreamer source element, and `track.label` names it. That is how you
find out what you actually got:

```ts
import { getUserMedia } from '@gjsify/webrtc';

const stream = await getUserMedia({ audio: true, video: true });
for (const track of stream.getTracks()) {
    console.log(`${track.kind}: ${track.label}`);
}
```

On a workstation with PipeWire running:

```
audio: pipewiresrc0
video: pipewiresrc1
```

### A source is opened before it is chosen

**This is a behaviour change.** Until recently the package picked the first source element
GStreamer could *construct*. A constructible element is not an openable device, and the two come
apart exactly where you least want them to.

`gstreamer1-plugins-good` puts `pulsesrc` on practically every Linux install, container images
included, and `Gst.ElementFactory.make('pulsesrc')` succeeds there whether or not an audio
daemon is listening. So on a headless server, inside a container, or in a sandboxed app without
audio access, `getUserMedia` claimed a source that could never produce a buffer — and the
synthetic fallback below it, the one source that *does* work on such a host, was unreachable
because a broken `pulsesrc` was always claimed first.

Nothing threw. You got a track, and the track was dead. The failure surfaced seconds later and
somewhere else entirely: `addTrack` wired the dead source up, `webrtcbin` sent no RTP, and the
remote peer's `track` event simply never fired. It reads as a WebRTC bug and it is not one.

Now each candidate is started for real — in a throwaway `src ! <converter> ! fakesink`
pipeline — and kept only if that does not fail. Candidates are tried in order:

| Kind | Real sources, in order | Synthetic fallback |
|---|---|---|
| audio | `pipewiresrc`, `pulsesrc`, `autoaudiosrc` | `audiotestsrc` (a sine tone) |
| video | `pipewiresrc`, `v4l2src`, `autovideosrc` | `videotestsrc` (SMPTE colour bars) |

What you will observe:

- **On a normal desktop**, with PipeWire or PulseAudio running: your real microphone and camera,
  the same as before.
- **In a container, on a headless box, or in a sandbox with no audio access**: a working
  synthetic source, where you previously got a silent, dead track.

So colour bars instead of your face, or a sine tone instead of a room, is the package telling you
that no real device opened. Treat it as a diagnosis. It is a far better one than silence, and
`track.label` names the element that won.

A source that is still starting up counts as a pass, not a failure — a live camera that has not
prerolled within half a second is slow, not broken.

### The probe runs once per process

Starting a capture pipeline costs real time, and on a host whose audio stack cannot serve it,
tearing one down leaks threads and address space inside the GStreamer backend rather than in
anything you can close. So the *verdict* is cached: the first `getUserMedia` in a process probes,
and every later call reuses the winning factory and simply makes a fresh element.

The difference is easy to see. Two identical `getUserMedia({ audio: true, video: true })` calls
back to back:

```
first call: 1054 ms
second call: 0 ms
```

The trade this makes is worth stating plainly: **the set of capture devices is read at first use.**
Plug a microphone in after your app's first `getUserMedia` call and it will not be noticed until
the process restarts. If your app is long-lived and cares about hot-plugged devices, do the first
capture lazily, at the point the user asks for it, rather than at startup.

### Which constraints actually do something

Constraints are mapped onto a GStreamer `capsfilter`, and only a subset is wired up:

| Constraint | Kind | Becomes |
|---|---|---|
| `width`, `height`, `frameRate` | video | `video/x-raw,width=…,height=…,framerate=…/1` |
| `sampleRate`, `channelCount` | audio | `audio/x-raw,rate=…,channels=…` |

```ts
const stream = await getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
});
```

`navigator.mediaDevices.getSupportedConstraints()` is the machine-readable version of that table.
Everything it reports `false` for — `echoCancellation`, `noiseSuppression`, `autoGainControl`,
`facingMode`, `aspectRatio`, `resizeMode`, `latency`, `groupId` — is accepted and ignored, the
way a browser treats an unsupported non-required constraint. `deviceId` is accepted too, but it
does not yet select the device: source selection is the probe order above, not your hint.

### enumerateDevices comes back empty in containers

`navigator.mediaDevices.enumerateDevices()` returns an empty array when `CI` is set in the
environment, or when neither `DISPLAY` nor `WAYLAND_DISPLAY` is. GStreamer's `DeviceMonitor` can
crash inside native code on some GJS and GStreamer combinations in containers, and a native crash
is not something a `try`/`catch` in JavaScript can rescue you from — so it is not attempted where
there are almost certainly no devices to find. Do not treat an empty list as "this machine has no
microphone"; call `getUserMedia` and read `track.label`.

Before your first successful `getUserMedia` call you also get at most one entry per kind, with
`deviceId`, `label` and `groupId` all empty strings. That is the W3C privacy rule rather than a
gap: capture once, and the following `enumerateDevices` fills the names in.

## What will bite you

### Never send an empty string

`channel.send('')` **closes the channel.** Not "drops the message" — closes it, and everything
you send afterwards is lost.

It gives you no signal at the call site. `send` returns normally, throws nothing, and
`readyState` is still `open` on the very next line; the channel goes to `closing` a moment later,
on its own. Messages sent *before* the empty one still arrive. Sending `'before'`, then `''`:

```
readyState before empty send: open
readyState after empty send:  open
B received: "before"
readyState 1.5 s later:       closing
```

That combination is what makes this so confusing in the field. Nothing fails where the mistake
is, the data that vanishes is the data that came *after*, and the channel dies a beat later — so
it reads as a race somewhere else in your protocol.

This is an upstream defect in GStreamer 1.28.5, not something the package can work around.
GStreamer's data channel builds a zero-length buffer for the empty-string path, where RFC 8831
§ 6.6 requires one zero byte — SCTP cannot carry an empty user message at all, which is exactly
why the spec spends a byte on saying so.

Guard the call site:

```ts
if (text.length > 0) channel.send(text);
```

If an empty payload means something in your protocol, give it a one-byte encoding of its own
rather than sending nothing — a single-character sentinel, or a JSON envelope such as
`{"type":"ping"}`, both of which survive the trip.

### Large messages throw rather than vanish

`send` throws an `OperationError` `DOMException` above the SCTP maximum message size. Read the
real ceiling off the transport rather than assuming one:

```ts
console.log(`max message size: ${pcA.sctp?.maxMessageSize}`);
```

```
max message size: 262144
```

That value comes from the peer's `a=max-message-size` SDP attribute, and falls back to 262144
bytes — as in the loopback above, where neither side advertises one. A `0` means unlimited.
Frame anything larger yourself.

The throw is the feature. Before it existed an oversize `send` returned normally and the frame
simply never arrived, which is a much longer afternoon than a typed error.

## Where it runs

`@gjsify/webrtc` declares GJS and the browser, and nothing else. On `--app browser` it resolves
to the browser's own native WebRTC, so one source file builds both ways and you can run the two
side by side and compare them line by line.

There is no `--app node` build. The backend is a GStreamer pipeline reached through a typelib,
which Node, Bun and Deno have no route to — so anything built on this package should declare
`gjs` in its `gjsify.runtimes`, and a `--runtime node` request then fails with an explanation
rather than a crash.

## Related

- [WebRTC Loopback](/gjsify/showcases/webrtc-loopback/) — the data-channel handshake as a runnable showcase, in GJS and in the browser.
- [WebRTC Video](/gjsify/showcases/webrtc-video/) — `getUserMedia` into a GTK 4 `Gtk.Picture` via `video.srcObject`.
- [Web API packages](/gjsify/packages/web/) — what else `@gjsify/webrtc` covers and which GNOME libraries back it.
