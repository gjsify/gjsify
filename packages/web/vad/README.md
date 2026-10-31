# @gjsify/vad

Voice activity detection for GJS: [Silero VAD](https://github.com/snakers4/silero-vad) running on [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) through [`@gjsify/sherpa-native`](../sherpa-native#readme). It answers two questions about an audio stream — **when did speech start**, and **when did a stretch of speech end** — and nothing else. Linux x64 only today. Tier 3 (experimental, [ADR 0003](../../../docs/adr/0003-package-tiering.md)) until promoted. See [ADR 0127](../../../docs/adr/0127-speech-recognition-on-local-engines.md).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vad
```

## Usage

The model is not bundled, so the first run fetches it (2.2 MiB from upstream's release page, verified by size and SHA-256 before it reaches disk):

```typescript
import { available, install, createVad } from '@gjsify/vad';
import { openPcmSource } from '@gjsify/media-capture';

if (available() === 'downloadable') await install();

const vad = createVad();          // 16 kHz mono, 300 ms of silence ends a stretch
const source = openPcmSource({ sampleRate: 16000, format: 'S16LE' });

for await (const event of vad.run(source)) {
    if (event.type === 'speech-start') showListeningIndicator();
    else transcribe(event.samples); // Float32Array, mono, [-1, 1]
}
vad.close();
```

Feeding chunks by hand instead of handing over a source — any chunk length, the engine buffers the remainder:

```typescript
const vad = createVad({ model: 'silero-v5' });
vad.open();
for (const chunk of chunks) {
    for (const event of vad.accept(chunk, 'S16LE')) handle(event);
}
for (const event of vad.flush()) handle(event); // not optional, see below
vad.close();
```

`flush()` is not optional. The last utterance of a file or a stopped recording is followed by no silence, so nothing closes it and without a flush it is never reported at all.

## The two events

| | `speech-start` | `speech-end` |
|---|---|---|
| when | the detector *confirms* speech | a stretch has ended |
| carries | `at` — stream position in seconds | `start`, `end`, `duration`, `startSample`, `samples` |

`speech-start.at` is the **live edge** and it lags the acoustic onset: the detector has to hear `minSpeechMs` of speech before it commits. Measured on two 16 kHz recordings with the defaults, it confirmed at 0.67 s and 0.38 s for onsets that the matching `speech-end` later reported at 0.32 s and 0.03 s — about 0.35 s behind in both. That is the right behaviour for a "listening" indicator, which must not flicker on a cough; for *trimming* audio use `speech-end.start`, which is the onset itself.

A burst too short to keep (< `minSpeechMs`) produces a `speech-start` with no `speech-end`. It stays that way: inventing a zero-length end would make a cough indistinguishable from a word.

## What this package refuses to say

Whether a pause means the speaker is **finished**. That is a question about a conversation — how long this speaker usually hesitates, whether the sentence sounds complete, whether the app may interrupt — and it belongs to a turn detector above this layer, with its own policy. A VAD measures acoustics, so there is deliberately no `turn-end` to reach for.

`createFakeVadEngine()` is exported for exactly that consumer: a scripted engine that drives the event machine without a model or an inference run.

## Defaults

`createVad()` takes `minSilenceMs` **300** (ADR 0127 decision 10, not Silero's 550 — the whole wait is added to every reply), `minSpeechMs` 250, `maxSpeechMs` 20 000, `threshold` 0.5, `sampleRate` 16 000, `windowSize` 512, `numThreads` 1, `bufferSeconds` 30. A `maxSpeechMs` cut appears as a `speech-end` immediately followed by a fresh `speech-start`.

## Models

`available()` answers in the names the Web Speech on-device additions use: `available`, `downloading`, `downloadable`, `unavailable`. `unavailable` means there is **no native engine** on this host, not a missing file — fetching a model for an engine that is not installed is the one outcome a download prompt must never produce.

```typescript
import { listModels, install, uninstall, modelCacheDir } from '@gjsify/vad';

listModels();      // every entry with its availability, for a settings panel
await install('silero-v4', { onProgress: (p) => console.log(p.received, p.total) });
uninstall('silero-v4');
modelCacheDir();   // ~/.cache/gjsify/speech-models, shared with the other speech packages
```

`VadOptions.model` takes a manifest id (`silero-v5`, `silero-v4`) or a path — anything containing a path separator is used as given, which is how you point at a model this manifest does not know. An id must already be cached: resolving must not start a download behind a synchronous constructor.

The models are MIT-licensed by their authors and are **not** part of this package's licence.

## Without a native engine

```typescript
import { hasVadBackend, describeVadBackend } from '@gjsify/vad';

if (!hasVadBackend()) console.log(describeVadBackend());
```

`hasVadBackend()` is the quiet check. `describeVadBackend()` names the engine and onnxruntime versions, or says why there is none and which `@gjsify/sherpa-native-<os>-<arch>` to install.

## Audio input

`run()` accepts `@gjsify/media-capture`'s `openPcmSource()` **structurally** — neither package depends on the other, because a VAD that drags GStreamer in would be unusable on a stream that came from a file or a socket. Any async iterable of chunks works; a source that reports a `sampleRate` different from the detector's is refused, because resampled audio read at the wrong rate does not fail, it just reads as silence.

`Float32Array` and `Int16Array` chunks carry their own layout. A raw `Uint8Array` needs an explicit `'S16LE'` or `'F32LE'`: both are plausible for a byte buffer and guessing wrong produces audio that is silently wrong.

## Notes

- `gjsify run test` covers the event machine and the model cache with no engine, no model and no network. The real-engine suite skips unless a prebuild and a cached model are present, is file-only and never opens a microphone or plays sound; its speech leg additionally needs `GJSIFY_VAD_TEST_WAV` to name a 16 kHz mono PCM16 file, since no speech fixture is committed.
- One detector, one stream. `reset()` reuses it across unrelated recordings; `close()` is final.
