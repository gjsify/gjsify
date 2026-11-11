# @gjsify/speech-recognition

W3C Web Speech `SpeechRecognition` for GJS, recognized **on this machine**: the streaming zipformer of [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) through [`@gjsify/sherpa-native`](../sherpa-native#readme), with speech boundaries from [`@gjsify/vad`](../vad#readme) and audio from [`@gjsify/media-capture`](../media-capture#readme). Nothing talks to a recognition service. Linux x64 only today. Tier 3 (experimental, [ADR 0003](../../../docs/adr/0003-package-tiering.md)) until promoted. This is step 3 of [ADR 0127](../../../docs/adr/0127-speech-recognition-on-local-engines.md).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/speech-recognition
```

## Usage

The model is not bundled. `available()` and `install()` are the spec's on-device additions (Web Speech draft of 27 Oct 2026):

```typescript
import '@gjsify/speech-recognition/register';

const options = { langs: ['de-DE'], processLocally: true };
if ((await SpeechRecognition.available(options)) === 'downloadable') {
    await SpeechRecognition.install(options);
}

const recognition = new SpeechRecognition();
recognition.lang = 'de-DE';
recognition.interimResults = true;
recognition.continuous = true;
recognition.onresult = (event) => {
    const result = event.results[event.resultIndex];
    console.log(result.isFinal ? 'final:' : 'interim:', result[0].transcript);
};
recognition.onerror = (event) => console.warn(event.error, event.message);
recognition.start();   // default capture device, 16 kHz mono
// …
recognition.stop();    // delivers the pending utterance, then `end`
```

Without `/register`, import the classes: `import { SpeechRecognition } from '@gjsify/speech-recognition'`.

## Surface

| Member | Behavior here |
|---|---|
| `start()` / `stop()` / `abort()` | per spec; `start()` while running throws `InvalidStateError`. `stop()` still delivers the pending utterance, `abort()` drops it |
| `start(track)` | the track is validated, but a real `MediaStreamTrack` fires `audio-capture` (not supported yet) |
| `lang`, `continuous`, `interimResults`, `maxAlternatives` | per spec. In continuous mode later transcripts are space-prefixed |
| `processLocally` | **always `true`**; setting `false` throws `NotSupportedError`. The spec default is `false`; ADR 0127 decision 3 overrides it, since there is no remote engine to fall back to |
| `phrases` | a plain array of `SpeechRecognitionPhrase` (`boost` in [0, 10]). The zipformer has no hotwords, so a non-empty list fires error `phrases-not-supported` |
| `grammars`, `serviceURI` | not implemented |
| `SpeechRecognition.available({ langs, processLocally })` | worst status over `langs`: `available` < `downloading` < `downloadable` < `unavailable`. A missing **engine** is `unavailable`, so a prompt never fetches a model for nothing. Invalid BCP 47 rejects with `SyntaxError` |
| `SpeechRecognition.install({ langs, processLocally })` | `true` once cached; `false` for empty or unsupported `langs`. `processLocally` is ignored |
| events | `start`, `audiostart`, `soundstart`, `speechstart`, `speechend`, `soundend`, `audioend`, `result`, `nomatch`, `error`, `end` |

Errors use the spec vocabulary plus `language-not-supported` (no model for `lang`), `phrases-not-supported`, `audio-capture` and `service-not-allowed`.

`hasRecognitionBackend()` / `describeRecognitionBackend()` say whether, and why not, an engine is there. `createFakeRecognizerEngine()` and the `engine` / `vad` / `source` members of `SpeechRecognitionInit` let an app test its handling without a model, a microphone or sound.

## Finalizing

The VAD (300 ms of silence) is the primary finalizer, so a final result lands roughly 300 ms after the speaker stops plus decoding. When the VAD model is not cached, the zipformer's own endpoint detection finalizes instead, which is later and less steady.

## Latency budget and engine candidates

[Lotse](https://github.com/JumpLink/lotse) needs a spoken conversation mode with **500 ms from end of speech to text**. Its measurements on an i9-10900K / RX 6600 (2026-10-28 to 30), as recorded in ADR 0127:

| Engine / model | WER | end-to-end | footprint |
|---|---|---|---|
| whisper.cpp `large-v3-turbo` q5_0, Vulkan, GPU idle | 7.3 % / 10.8 % | 428 / 457 ms | 548 MB model |
| the same, GPU computing | 7.3 % / 10.8 % | 1170 / 1420 ms | 548 MB model |
| sherpa-onnx `parakeet-tdt-0.6b-v3` int8, CPU | 12.0 % / 13.1 % | 239 / 339 ms | 641 MB, 1.1 GB RSS |
| sherpa-onnx streaming `zipformer-de-kroko`, CPU | 15.3 % / 16.5 % | 32 / 53 ms | 68 MB |
| whisper.cpp CPU, `small` and up | — | 2–18 s | misses the budget |

This package ships the **streaming zipformer** row: it is the only candidate that yields interim results and needs no GPU. Measured for `zipformer-de-kroko`: about **32 ms after the end of speech**, 183 MB RSS, CPU only. The whisper-native backend (accurate finals) and the machine-fit choice between backends are later ADR 0127 steps and not part of this package.

## Model

`sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06`, four files fetched through [`@gjsify/model-store`](../model-store#readme) (size and SHA-256 verified before a file reaches its place), cached under `models/speech/`. The licence is Kroko's community licence (advertised as CC-BY-SA; the model card says `license: other`), so the entry is marked `redistributable: false` — gjsify downloads it from upstream and never bundles it.

## Tests

No test plays or records sound. The session logic runs on a fake engine and a fake VAD; the GStreamer path reads `audiotestsrc`/`filesrc` into a `fakesink`-style reader. The real-engine suite skips unless the prebuild and the cached model are there, and no CI job downloads a model. Accuracy is asserted as "the final contains these words", never an exact string.

| Variable | Effect |
|---|---|
| `GJSIFY_SPEECHREC_TEST_WAV` | a 16 kHz mono WAV with speech, for the real-engine suite |
| `GJSIFY_SPEECHREC_EXPECT` | comma-separated words the final must contain |

## License

MIT
