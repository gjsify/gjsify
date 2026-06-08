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

## License

MIT
