# 132. AI capabilities on GJS share one shape: the web API where one exists, the built-in AI pattern where none does, and a remote engine only when the app registers one

- Status: **Proposed** (2026-11-03)
- Date: 2026-11-03
- Deciders: Pascal Garber
- Amends [ADR 0121](0121-speech-synthesis-on-gjs-via-libspiel.md) § 4 and
  [ADR 0127](0127-speech-recognition-on-local-engines.md) § 3 and § 8. Both stay in force for
  everything else.
- Related: [ADR 0003](0003-package-tiering.md) (tiers),
  [ADR 0017](0017-native-package-distribution.md) (per-target prebuilds),
  [ADR 0123](0123-node-sqlite-runs-on-libsqlite3-through-a-vala-bridge.md) (the thin Vala bridge);
  `packages/web/speech-synthesis`, `packages/web/vad`, `packages/web/sherpa-native`,
  `packages/web/media-capture`

## Context

Three apps built on gjsify now run machine-learning models, and each has drawn its own seam:

- [Lotse](https://github.com/JumpLink/lotse) speaks and listens. Its ADR 0009 defines
  `SpeechToText` and `TextToSpeech` interfaces in `@lotse/core`, with local engines (Spiel,
  later whisper.cpp) and cloud engines (Mistral, a configurable TTS server URL), and its
  ADR 0010 § 6 makes the cloud "the last candidate, never a silent fallback".
- [Stamped](https://github.com/correctiv/stamped) embeds a mail corpus for semantic search.
  `@stamped/semantic` defines an `Embedder` (`modelId`, `dimensions`, `backend`, `embedQuery`,
  `embedDocuments`) and runs EmbeddingGemma 2 as GGUF through `node-llama-cpp` on
  `@gjsify/napi`. Local is not negotiable there: an embedding API would receive the leak itself.
  It ships its model with the app, and it owns the GPU guard, battery check and backend probe that
  ADR 0127 § 11 plans to extract into `@gjsify/machine-fit`.
- An image-generation app has an `ImageEngine` (`name`, `generate(request, { signal })`,
  `close()`) over stable-diffusion.cpp through `@gjsify/napi`, written to import nothing from
  the app so it can move into gjsify. A remote engine and a crash-isolating worker are its open
  TODOs.

gjsify's side so far is speech: `@gjsify/speech-synthesis` on libspiel (ADR 0121) and the
recognition track of ADR 0127, of which `media-capture`, `sherpa-native` and `vad` exist. Both
ADRs keep the network out: "an app that wants one brings its own". For one capability that is
cheap. With four it is not: each app re-implements engine selection, the never-silent-cloud rule,
download progress, the model cache and the GPU guard, and does it differently. The person's
machine is the same in every app, yet each app asks it again whether it is fast enough.

**What the web standardises, as of 2026-11-03:**

| Capability | Web API | State |
|---|---|---|
| Speech synthesis | `speechSynthesis` (Web Speech) | Shipped everywhere |
| Speech recognition | `SpeechRecognition` (Web Speech), with on-device `processLocally`, `available()`, `install()` | API shipped; on-device additions recent |
| Translation, language detection | `Translator`, `LanguageDetector` (WebML CG) | Shipped in Chrome only |
| Summarising, writing, rewriting | `Summarizer`, `Writer`, `Rewriter` (WebML CG) | Chrome; partly behind origin trials |
| Free-form prompting | `LanguageModel` (Prompt API, WebML CG) | Chrome; other engines not committed |
| Low-level inference | WebNN (W3C) | Candidate Recommendation; too low-level to be an app API |
| Embeddings, image generation | — | Nothing |

The WebML CG APIs share one lifecycle, and that lifecycle is what matters here even where the
capability itself has no spec: `availability(options)` answers `"unavailable"`, `"downloadable"`,
`"downloading"` or `"available"` without side effects, `create({ ...options, monitor, signal })`
returns an instance and reports download progress through `monitor`, and `destroy()` releases
it. That is the same question as ADR 0127's `available()` / `install()`, asked the same way for
every capability.

For the network side, the de-facto standard is the OpenAI-compatible HTTP surface
(`/v1/audio/transcriptions`, `/v1/audio/speech`, `/v1/embeddings`, `/v1/images/generations`).
Ollama, LocalAI, vLLM, llama.cpp's server and a LAN box running any of them speak it, so one
client covers "my laptop is too weak, but the desktop next door is not" as well as a cloud
vendor.

Underneath, the engines collapse onto two native runtimes: **ggml** (whisper.cpp, llama.cpp,
stable-diffusion.cpp) and **onnxruntime** (sherpa-onnx). They are reached three different ways
today: a Vala bridge (ADR 0127), a prebuilt N-API addon in-process (image generation), and
`node-llama-cpp` over `@gjsify/napi` with a `child_process` shim (Stamped). GPU engines crash in
ways a JS exception does not cover: a hung driver `abort()`s the process, which is why Stamped
writes its GPU guard marker before the attempt.

## Decision

1. **Where a web API exists, gjsify implements that API and registers it as a global.** Speech
   is already done this way (ADR 0121, ADR 0127). The WebML CG APIs (`Translator`,
   `LanguageDetector`, `Summarizer`, `Writer`, `Rewriter`, `LanguageModel`) are implemented
   **only when a consumer needs one**, each pinned to the spec text of the day it is written. A
   Chrome-only API is still the best name available. It is not a reason to build ahead of need.
2. **Where none exists, gjsify defines its own API in the WebML CG lifecycle shape**: static
   `availability(options)` with the same four states, `create(options)` taking `monitor` and
   `signal`, an instance with `destroy()`, and `AbortSignal` on every long call. These APIs are
   **named exports, not globals**: there is no standard name to claim, and a gjsify-only
   global would look like a web API to code that feature-detects it. Two are decided now:
   - **`@gjsify/embeddings`**: `Embedder`. The instance exposes `modelId` and `dimensions` so an
     index can record what produced it. Query and document input are distinguished in the API,
     because instruction-tuned models such as EmbeddingGemma prefix them differently. Vectors are
     `Float32Array`, and a non-finite vector is an error, never a return value. This is
     Stamped's `Embedder` moved and renamed, not a new design.
   - **`@gjsify/image-generation`**: `ImageGenerator`, from the image-generation app's
     `ImageEngine`, with `close()` becoming `destroy()`.
3. **Every capability has one engine interface, exported from an `/engine` subpath**, which the
   gjsify engines implement and an app may implement too. That is the whole extension story: a
   vendor API gjsify does not ship (Mistral's Voxtral, a TTS server) is an app-side engine behind
   the same interface, not a fork of the package. The instance reports which engine it runs on
   (`engine`: name plus `local` / `remote`), so a surface can say "the cloud is listening"
   (Lotse ADR 0010 § 6) without knowing engine internals.
4. **gjsify still contacts no service on its own, but it now ships the remote engine.** This
   amends ADR 0121 § 4 and ADR 0127 § 3. "Remote" means gjsify as a **client**: a remote engine
   sends the request to a server someone else runs (Ollama on the desktop next door, a LocalAI
   box, a cloud vendor) and gets the result back. No app becomes a server through this ADR;
   offering an API is out of scope. `@gjsify/openai-compatible` provides client engines for the
   four OpenAI-compatible endpoints above. They exist only when an app **registers** one with a
   base URL and a credential; nothing is registered by default, and gjsify stores no key (the app
   passes it, e.g. from libsecret as Lotse ADR 0009 § 6 does). Selection follows the Web Speech
   rule everywhere: `processLocally: true` forbids every remote engine; otherwise a registered
   remote engine is a candidate **after** every local one, used only when no local engine fits
   (decision 6). With no remote engine registered, the behaviour is exactly ADR 0127's.
   `SpeechRecognition.processLocally = false` no longer raises when a remote engine is
   registered; it still raises when none is.
5. **One model store: `@gjsify/model-store`.** This generalises ADR 0127 § 8 and moves
   `@gjsify/vad`'s cache code into it. Models live under
   `GLib.get_user_cache_dir()/gjsify/models/<capability>/`, `speech-models/` becomes
   `models/speech/`, and the first release reads the old path once. Every model has a manifest
   entry in the package that uses it: upstream URL, digest, size, licence, and whether
   redistribution is allowed. A model is fetched from upstream, never mirrored, unless its
   licence allows it. Download progress drives the `monitor` of decision 2, so every app can
   show the same "548 MB, 40 %". Three sources resolve in order: a path the app configures (a
   model the person already has on disk), a model the **app** ships read-only in its data dir
   (Stamped does this; ADR 0127's "never bundled" binds gjsify packages, not apps), then the
   cache, downloading if allowed. Digests are checked for every source.
6. **Machine fit applies to every capability, not only speech.** ADR 0127 § 11–12 stand
   unchanged: `@gjsify/machine-fit` probes, the consumer owns candidates and budgets, an explicit
   setting wins, and nothing probes on battery. This ADR adds two rules. Every GPU engine of
   every capability writes the same GPU guard marker, so a driver that hung under one app warns
   the next app too. Remote engines are never probed with real input; they are ranked last
   and taken when no local candidate fits the budget.
7. **Native runtimes: new engines get a Vala bridge; the existing N-API engines may move in as
   they are.** ADR 0127 § 5's reasons still hold, so a bridge is the target. But moving Stamped's
   and the image-generation app's engines into gjsify first, behind the new interface, is worth
   more than rewriting them first. The rewrite follows when the bridge exists. Each bridge links
   its runtime statically with hidden symbols, as `sherpa-native` does with onnxruntime, so two
   ggml copies in one process are a size cost, not a clash. A shared ggml bridge is weighed when
   the second ggml engine lands in gjsify, measured on prebuild size, not assumed.
8. **Process isolation is an engine decision the API already admits.** Every long call is async
   and takes and returns transferable data (`Float32Array`, `Uint8Array`), so an engine may run
   in a child process without changing its interface. The child runs on
   `child_process.fork`, which [ADR 0133](0133-fork-and-worker-share-one-ipc-channel.md) adds by
   moving `worker_threads`' existing IPC channel into its own package. No engine gets its own
   subprocess plumbing.
9. **All new packages start at tier 3** (ADR 0003) and move up per capability as consumers ship
   on them.
10. **Order of work**, driven by consumers and never ahead of one: (1) `@gjsify/model-store`,
    extracted from `@gjsify/vad`, and the cache-path move; (2) ADR 0127's steps 3–5 continue
    unchanged on it; (3) `@gjsify/embeddings` with Stamped's engine moved in, then Stamped
    switches. Its `fork` shim goes once ADR 0133 lands, independent of this order; (4) `@gjsify/image-generation` with the image-generation app's engine;
    (5) `@gjsify/openai-compatible`, when the first consumer registers a remote engine;
    (6) a WebML CG API only when a consumer asks for it.
11. **Tests follow ADR 0127 § 14**: fake engines and fixtures, no real model fetched by a PR job,
    one scheduled job that does. Remote engines are tested against a local fake HTTP server,
    never a real service. The store is tested against an injected fetch and a temporary cache
    dir.

## Consequences

- Five more packages (`model-store`, `embeddings`, `image-generation`, `openai-compatible`, plus
  a prebuild per new bridge), on top of ADR 0127's six. The arrows point one way: capability →
  model-store, machine-fit, engines. `openai-compatible` depends on capability `/engine` subpaths,
  never the reverse.
- Lotse's `SpeechToText` / `TextToSpeech`, Stamped's `Embedder` and the image-generation app's
  `ImageEngine` become thin adapters, then go away. The cloud rule of Lotse ADR 0010 § 6 is
  enforced in gjsify instead of in each app.
- The "no cloud in gjsify" sentence of ADR 0121 and ADR 0127 becomes "no cloud unless the app
  registers one". The code that talks to a network now lives in gjsify and must be reviewed as
  such: no default URL, no telemetry, no key on disk.
- Sharing models between apps works on the host. Inside Flatpak each app has its own cache dir,
  so sharing there needs either the configured path of decision 5 or a portal. Until then, two
  Flatpak apps download the same model twice.
- The WebML CG APIs may change or stay Chrome-only. Pinning per implementation keeps a rename
  a local change. A gjsify-only API that later gets a spec is migrated like any other breaking
  change under ADR 0008.
- Licence handling becomes a store duty for every capability, not a per-app one: the manifest
  carries it, and a model whose terms add restrictions the app's licence forbids (Stamped ruled
  out EmbeddingGemma 1 that way) is refused at manifest review, not at runtime.

## Implementation

1. Once accepted, track decision 10 as one entry in `status/open-todos/README.md`, next to
   ADR 0127's.
2. Mark ADR 0121 and ADR 0127 "Amended by ADR 0132" in their headers when this is accepted, not
   before.
3. Pin the WebML CG lifecycle (`availability`, `create`, `monitor`, `destroy`) against the spec
   text when `@gjsify/embeddings` is written; the names here are those of 2026-11-03.
