# @gjsify/webaudio

Web Audio API implementation for GJS backed by GStreamer 1.0. Provides `AudioContext` (with `decodeAudioData` via GStreamer's `decodebin`), `AudioBufferSourceNode`, `GainNode`, `AudioParam`, `AudioBuffer`, and `HTMLAudioElement`. Phase 1 implementation.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webaudio

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webaudio
yarn add @gjsify/webaudio
```

## Usage

```typescript
import { AudioContext, AudioBuffer, GainNode } from '@gjsify/webaudio';

const ctx = new AudioContext();

// Decode audio data fetched from disk or network
const response = await fetch('/sound.ogg');
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

// Play it with a gain node
const source = ctx.createBufferSource();
source.buffer = audioBuffer;
const gain = ctx.createGain();
gain.gain.value = 0.8;
source.connect(gain);
gain.connect(ctx.destination);
source.start();
```

## Audio output selection

On `ensureGstInit()` (the first `AudioContext`, `decodeAudioData`, or any
other GStreamer-touching call), this package sets the `openalsink` GStreamer
plugin feature's rank to `Gst.Rank.NONE` in the **process-wide** GStreamer
registry — it affects every pipeline in the process, including ones built
outside this package.

Why: `autoaudiosink` (the element behind `AudioContext` playback) tries
registered audio sinks in rank order until one opens. `openalsink` is the
one candidate whose `open()` does not fail fast: on a host with no
reachable PipeWire/Pulse/ALSA, OpenAL Soft's device backend runs its own
nested connection probe synchronously inside the GStreamer state change,
which can stall the whole process for tens of seconds (measured in CI —
`[ALSOFT] Failed to connect PipeWire` followed by 30+ seconds of silence).
`autoaudiosink` already falls back to a silent `fakesink` when nothing
opens, in well under 100ms — deranking `openalsink` restores that existing
fallback instead of leaving it reachable through the one candidate that
defeats it.

Set `GJSIFY_GST_KEEP_OPENAL=1` to opt out, if a host genuinely needs OpenAL
Soft as its audio backend. This also un-deranks `openalsrc`/`openalsink`
for `@gjsify/webrtc` if both are loaded in the same process — the two
packages share the one GStreamer registry.

## License

MIT
