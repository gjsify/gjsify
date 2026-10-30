# 127. `SpeechRecognition` on GJS runs on local engines behind Vala bridges, with capture, VAD and machine fit as their own packages

- Status: **Proposed** (2026-10-30)
- Date: 2026-10-30
- Deciders: Pascal Garber
- Related: [ADR 0121](0121-speech-synthesis-on-gjs-via-libspiel.md) (the other half of Web
  Speech, and where the backend-precedence shape comes from),
  [ADR 0123](0123-node-sqlite-runs-on-libsqlite3-through-a-vala-bridge.md) (the thin Vala bridge
  as a template), [ADR 0017](0017-native-package-distribution.md) (per-target prebuild packages),
  [ADR 0021](0021-launcher-free-prebuild-resolution.md) (how the typelib is found),
  [ADR 0075](0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md) (a GObject shim over a
  vendored native library);
  `packages/web/webrtc`, `packages/web/webaudio`, `packages/web/speech-synthesis`

## Context

ADR 0121 gave GJS the synthesis half of Web Speech. The recognition half —
`SpeechRecognition` and its event and result classes — is still missing, and in browsers it is
the half that is a cloud service: Chrome ships `webkitSpeechRecognition` as a Google endpoint,
and the on-device additions to the spec (`processLocally`, `available()`, `install()`) are recent.
gjsify has no cloud account to spend and no wish for one, so the question is not "which service"
but "which local engine, reached how".

The need is measured. [Lotse](https://github.com/JumpLink/lotse) asks for a spoken conversation
mode (its ADR 0009 and ADR 0010) with a budget of **500 ms from end of speech to text**, and its
`docs/voice/spracherkennung.md` records what the candidates actually do on this hardware. The
table below is from 2026-10-28, and the circumstance matters: it was taken while another process
held the GPU at 97 % with 7.1 of 8 GB VRAM in use.

| Engine / model | WER | end-to-end | footprint |
|---|---|---|---|
| whisper.cpp `large-v3-turbo` q5_0, Vulkan | 7.3 % / 10.8 % | 412 / 422 ms | 548 MB model |
| sherpa-onnx `parakeet-tdt-0.6b-v3` int8, CPU | 12.0 % / 13.1 % | 239 / 339 ms | 641 MB, 1.1 GB RSS |
| sherpa-onnx streaming `zipformer-de-kroko`, CPU | 15.3 % / 16.5 % | 32 / 53 ms | 68 MB |
| whisper.cpp CPU, `small` and up | — | 2–10 s | misses the budget |

Three findings come out of it. **No single engine wins**: the accurate one needs a GPU, the fast
one is a streaming model that is 8 points worse, and the best CPU compromise costs a gigabyte of
RSS. **Every engine mishears project vocabulary** — `gjsify` and `Paperless` come back wrong from
all of them, and only `large-v3-turbo` gets `Flatpak`, `TypeScript` and `Pull-Request 2394`
right — so a term list is not a nicety. And **a GPU that is present is not a GPU that is
free**: the Vulkan run above was 2.5–3× slower than the same model on an idle GPU, while every
static check (device present, driver loaded, VRAM free) said yes.

Voxtral was measured too and is not a candidate: asked to transcribe, it answers the audio
instead of writing it down. It stays a cloud chat model.

Two neighbours already exist and must not be duplicated. `@gjsify/webrtc` implements
`getUserMedia` over a `pipewiresrc` / `pulsesrc` / `v4l2src` chain, and `@gjsify/webaudio`
already drives GStreamer. A third capture path would be the third place to fix the same bug.

Outside this repo there is working prior art for the machine-fit question.
[Stamped](https://github.com/correctiv/stamped) picks a semantic-search backend at run time with
four pieces — a Vulkan hint, a GPU guard file, a battery check and an ordered probe with a time
budget — and a phone assistant on the same workstation has the voice-activity half: Silero VAD
with the minimum silence dropped from its 550 ms default to 300 ms, because 550 ms is added to
every single reply, and a separate turn detector deciding whether a pause actually ends a turn.

## Decision

1. **`@gjsify/speech-recognition` implements the W3C Web Speech recognition API on GJS**, and
   registers `SpeechRecognition`, `SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent`,
   `SpeechRecognitionResultList`, `SpeechRecognitionResult` and `SpeechRecognitionAlternative`
   through the usual `globals-map` entries. The supported surface is `lang`, `continuous`,
   `interimResults`, `maxAlternatives`, `start()` / `stop()` / `abort()` and the full event set
   (`start`, `audiostart`, `soundstart`, `speechstart`, `speechend`, `soundend`, `audioend`,
   `result`, `nomatch`, `error`, `end`). `grammars` and `serviceURI` are NOT implemented:
   JSGF is dead in browsers too, and there is no service to point at.
2. **A term list is spelled the standard way.** Contextual biasing uses the spec's `phrases`
   (`SpeechRecognitionPhrase` with a `boost`), not a gjsify-only option, and maps to
   whisper.cpp's initial prompt and sherpa-onnx's hotwords. `boost` is advisory — an engine that
   has no weight takes the phrase and ignores the number. This is what answers Lotse ADR 0010
   decision 9's term list, and what makes `gjsify` transcribable at all.
3. **`processLocally` is always true, and model download is expressed through the spec's
   on-device additions**: `SpeechRecognition.available()` reports whether this language can run
   here or must be fetched, and `install()` fetches it. Setting `processLocally = false` raises
   rather than silently reaching a network. Nothing in gjsify talks to a recognition service; an
   app that wants one brings its own `SpeechRecognition`.
4. **Two engines, each for what it is good at, behind one internal backend interface.**
   whisper.cpp with the Vulkan backend produces accurate finals; sherpa-onnx on CPU produces
   interim results from the streaming zipformer and finals from parakeet where no GPU is usable.
   A third engine is then a package, not a fork.
5. **The engines are reached through thin Vala/GObject bridges, not a subprocess.**
   `@gjsify/whisper-native` and `@gjsify/sherpa-native` wrap the upstream C APIs as
   `gi://GjsifyWhisper?version=1.0` and `gi://GjsifySherpa?version=1.0`, distributed per ADR 0017
   and resolved per ADR 0021, shaped like `@gjsify/sqlite-native` (ADR 0123): the C API and
   nothing else, with every W3C semantic staying in TypeScript. A subprocess was weighed and
   rejected — it costs either a process per utterance or a resident server to supervise, it moves
   every PCM frame through a pipe, it puts the model load on a lifetime we do not own, and inside
   Flatpak there is no host binary to call, so the engine would have to be bundled anyway. Once it
   is bundled, a typelib is the cheaper of the two, and the mechanism already exists.
6. **No system library takes precedence here, unlike ADR 0121** — distros ship no libwhisper and
   no libsherpa-onnx, so the prebuild *is* the backend. The `probeSpiel()` precedence shape is
   kept in the backend module so a future packaged library can be preferred without a redesign,
   and `absent` (no typelib) stays distinct from `failed` (a typelib whose library will not open).
7. **Build cost decides what ships first, not what the package supports.** sherpa-onnx on CPU is
   the floor every target gets; whisper.cpp with Vulkan needs the Vulkan SDK and `glslc` in the
   build image, so it ships for `linux-x64` first and reaches other targets as their CI can build
   it. `@gjsify/speech-recognition` must be fully usable with only the floor present.
8. **Models are never bundled.** They are fetched on first use into
   `GLib.get_user_cache_dir()/gjsify/speech-models/`, verified against a digest and size recorded
   in a manifest in the package, and surfaced through `available()` / `install()` so the app can
   show the 548 MB.
9. **Capture is not reinvented: the GStreamer chain moves into `@gjsify/media-capture`** and
   `@gjsify/webrtc` consumes it instead of carrying its own. Recognition takes PCM from a
   `MediaStream` when it is handed one, and otherwise opens a 16 kHz mono source through that same
   chain. One chain, one place to fix it.
10. **`@gjsify/vad` is its own package and does not depend on recognition.** Silero v5 through the
    `sherpa-native` bridge, which already embeds it, so there is no second ONNX runtime in the
    tree. WebRTC's VAD is rejected: it is energy-based and fires on keyboard clatter. The default
    minimum silence is **300 ms, not Silero's 550 ms** — the default is added to every reply. The
    package reports speech start and end and says nothing about turns; whether a pause ends a turn
    is the consumer's decision, made by its own turn detector.
11. **`@gjsify/machine-fit` holds the four generic pieces extracted from Stamped**: `hasVulkan()`
    as a hint, a GPU guard whose marker file is written BEFORE the attempt (a hung driver
    `abort()`s the process, so only a marker that already exists survives to warn the next start),
    `onBattery()` via `/sys/class/power_supply` and `pmset` on darwin, and
    `probeBackends(candidates, budget)` — run them in order against a wall-clock budget and
    return the first that fits, plus a recommendation.
12. **The probe is the only evidence that counts, and the tables stay with the consumer.**
    `machine-fit` knows how to probe, never what to probe: the candidate list and the budget come
    from the caller, so `@gjsify/speech-recognition` owns the engine candidates and Lotse or
    Stamped owns its budget. The automatic choice is made once and recorded; an explicit setting
    or `GJSIFY_SPEECH_BACKEND` always wins over a probe.
13. **Order of work**, cheapest and least speculative first: (1) extract
    `@gjsify/media-capture`, (2) `@gjsify/sherpa-native` and `@gjsify/vad` — the CPU floor, with
    no GPU question in it, (3) `@gjsify/speech-recognition` on the streaming zipformer, which is
    the whole W3C surface including interim results at 32/53 ms, (4) `@gjsify/whisper-native` and
    the accurate-finals backend, (5) `@gjsify/machine-fit` and the probe that chooses between
    them — last, because choosing is only a problem once there are two backends.
14. **No test plays or records audible sound.** WAV fixtures in, `fakesink` out, and
    `audiotestsrc` / `filesrc` for the stream path, as in ADR 0121. Accuracy is asserted as "the
    final contains these words", never as an exact string, because the mishearings above are a
    measurement and not a regression. Latency is asserted per engine class as a budget, and both
    skip on `absent` rather than failing. A real model is never downloaded by a PR job — one
    scheduled job does that. `machine-fit`'s probe is tested against an injected clock and fake
    candidates, never a real GPU.

## Consequences

- Six new packages (`speech-recognition`, `media-capture`, `vad`, `machine-fit`,
  `whisper-native`, `sherpa-native`) plus a per-target prebuild package per bridge under ADR 0017.
  The dependency arrows point one way: recognition → vad, media-capture, machine-fit, bridges.
- `@gjsify/webrtc` is refactored onto `@gjsify/media-capture` in step 1. Its `getUserMedia` tests
  are the gate for that move; the package's public surface does not change.
- The Linux CI image gains the Vulkan SDK and `glslc`, and the prebuild matrix gains onnxruntime.
  This is the single largest cost of the decision, and the reason step 4 is step 4.
- A first run costs a download the app has to explain: 68 MB for streaming, 548 MB for accurate
  finals, 641 MB for parakeet. An offline host with no cached model has no recognition, and
  `available()` is how it says so.
- Licences differ between the engines (whisper.cpp MIT, sherpa-onnx Apache-2.0) and between the
  models, which are not all permissive. Every model entry in the manifest records its licence,
  and a model whose licence forbids redistribution is fetched from upstream, never mirrored.
- The `machine-fit` extraction touches a repo outside this one. It is not blocked on this ADR and
  does not block it: per Lotse ADR 0010 it waits until stage 2 needs a choice between backends,
  which is step 5 here.
- Accuracy on this workstation is capped at roughly 7 % WER by the best local model that fits in
  the budget. An app that needs better has to wait for better local models, not for this package.

## Implementation

1. Track the five steps of decision 13 as one entry in `status/open-todos/README.md`, with the
   measurement table above as its acceptance reference.
2. Pin `available()`, `install()` and `processLocally` against the current Web Speech spec text
   when the package is written; they are the newest part of the surface and the names in this ADR
   are the ones as of 2026-10-30.
3. Record the engine candidate table and the 500 ms budget in `@gjsify/speech-recognition`'s own
   docs, not here — this ADR owns the shape, the package owns the numbers it probes with.
