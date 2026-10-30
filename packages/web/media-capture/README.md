# @gjsify/media-capture

The GStreamer capture chain for GJS: pick a microphone or camera source that actually opens, bind a device to it, express constraints as caps, and read 16 kHz mono PCM for speech recognition. [`@gjsify/webrtc`](../webrtc) builds `getUserMedia` on it; extracted from there per [ADR 0127](../../../docs/adr/0127-speech-recognition-on-local-engines.md). Tier 3 (experimental, [ADR 0003](../../../docs/adr/0003-package-tiering.md)) until promoted. GJS only.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/media-capture
```

Needs GStreamer with `gst-plugins-base` (`GstApp` typelib).

## PCM for speech recognition

```typescript
import { openPcmSource } from '@gjsify/media-capture';

const mic = openPcmSource({ sampleRate: 16000, format: 'S16LE' });
if (mic.synthetic) console.warn('no microphone opened; this is a test tone');

for await (const chunk of mic) {
    // chunk: Uint8Array of interleaved little-endian mono samples
    recognizer.feed(chunk);
    if (done) break; // leaving the loop stops the pipeline
}
```

`source ! audioconvert ! audioresample ! capsfilter ! appsink`. The default source is the capture chain's audio source; `deviceId` selects another, and `source` swaps in any `Gst.Element` (a file, a test tone). `read()` returns the next chunk or `null` at end of stream and rejects on a pipeline error; `stop()` is idempotent. The appsink is polled, never driven by `new-sample`, because that signal fires on GStreamer's streaming thread where GJS refuses to run JS. A reader that falls behind blocks the source (200 buffers deep) instead of losing audio.

## The capture chain

```typescript
import { openCapture } from '@gjsify/media-capture';

const { source, pipeline } = openCapture('video', { width: 640, height: 480, frameRate: 30 });
```

| Export | Does |
|---|---|
| `openCapture(kind, constraints)` | A source in a fresh NULL pipeline, with a capsfilter when a constraint maps to caps |
| `createAudioSource` / `createVideoSource` | The bare source element |
| `bindDevice(kind, element, deviceId)` | Writes `deviceId` to whichever of `device`, `target-object`, `path` the element declares; warns once when none |
| `isTestSource(element)` | True for `audiotestsrc` / `videotestsrc` |
| `buildAudioCaps` / `buildVideoCaps` | W3C constraints to a caps string |
| `ensureGstInit`, `excludeUnboundedAutodetectCandidates` | Lazy `Gst.init`; keeps `openalsrc`/`openalsink` out of autodetect |

Source order: `pipewiresrc`, `pulsesrc`, `autoaudiosrc` for audio; `pipewiresrc`, `v4l2src`, `autovideosrc` for video; then `audiotestsrc` / `videotestsrc`. A candidate is used only if it starts. The verdict is cached per process, so a device plugged in later is not seen until restart; elements are still made fresh per call.

## License

MIT
