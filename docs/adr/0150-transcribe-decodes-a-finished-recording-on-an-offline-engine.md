# 150. `transcribe()` decodes a finished recording on an offline engine

- Status: **Proposed** (2026-11-20)
- Date: 2026-11-20
- Deciders: Pascal Garber
- Amends [ADR 0127](0127-speech-recognition-on-local-engines.md) (adds the offline path and the
  first parakeet entry; the streaming session is unchanged).
- Related: [ADR 0132](0132-ai-capabilities-share-one-shape.md) § 5 (manifest, store),
  `packages/web/speech-recognition`, `packages/web/media-capture`, `packages/web/sherpa-native`

## Context

`SpeechRecognition` is a live session. Two consumers hold a FINISHED recording instead: a
push-to-talk buffer and a voice-note file (Ogg/Opus). They want one answer, from the best model
that fits, not interim events.

## Decision

1. **A facade, not a second session.** `transcribe(source, { lang?, phrases?, signal?, model? })`
   takes 16 kHz mono Float32 PCM, a path or a `Gio.File`, and resolves
   `{ text, language, engine }`. `language` is `null` when the engine does not say.
2. **Files decode through `@gjsify/media-capture`** (`openPcmSource({ file })`). There is no second
   GStreamer chain.
3. **An `OfflineEngine` port** (`open`, `transcribe`, `close`, `hotwords`, `name`) mirrors
   `RecognizerEngine`. A second backend (whisper.cpp, `@gjsify/whisper-native`) is one more
   factory. A scripted `createFakeOfflineEngine()` serves the specs and consumers.
4. **First backend: sherpa-onnx `OfflineRecognizer` with `parakeet-tdt-0.6b-v3-int8`** (CC-BY-4.0,
   623 MiB, 25 languages with language detection). The manifest entry has a `kind`
   (`streaming` | `offline`); `modelFor`, `available()` and `install()` take `kind` and default to
   `streaming`, so `SpeechRecognition` never picks the offline model.
5. **`phrases` are not applied yet.** The C shim passes no BPE vocabulary or modeling unit, which a
   NeMo transducer needs to encode a hotword, so the engine reports `hotwords: false` and
   `transcribe()` drops the phrases. Fixing it is a sherpa-native change and needs a prebuild
   rebuild; until then the manifest entry says `hotwords: false`.

## Consequences

- One more 623 MiB download, on `install({ langs, kind: 'offline' })`, never bundled.
- Aborting stops reading and queues no decode; a decode already running in the engine finishes.
