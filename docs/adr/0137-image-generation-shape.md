# 137. Image generation follows the shared AI shape: `ImageGenerator`, web types for the data, sd.cpp as an in-process engine

- Status: **Accepted**
- Date: 2026-11-07
- Deciders: Pascal Garber
- Related: [ADR 0132](0132-ai-capabilities-share-one-shape.md) (§ 2 the class, § 3 the engine
  interface, § 5 the model store, § 7 runtimes, § 8 isolation; § 10 step 4 is this package),
  [ADR 0133](0133-fork-and-worker-share-one-ipc-channel.md) (`fork` and the IPC channel),
  [ADR 0136](0136-machine-fit-checks-memory-and-finds-local-servers.md) (`checkFit` before
  download), [ADR 0017](0017-native-package-distribution.md) (per-target prebuilds for the
  addon), `packages/gjs/embeddings` (the sibling mirrored here), `packages/gjs/model-store`,
  `packages/gjs/machine-fit`

## Context

ADR 0132 § 10 step 4 names this package: `@gjsify/image-generation`, with an image-generation
app's engine moved in. That engine drives stable-diffusion.cpp (sd.cpp) in-process — a N-API
addon, loaded through `@gjsify/napi`, exposing `generate` and
`setProgressCallback(({ step, steps, time }) => …)` — and it was written to import nothing from
the app so it can move. Its open TODOs are a remote engine and a crash-isolating worker.

The frame around it is decided, and since `@gjsify/embeddings` landed it exists as code: the
WebML CG lifecycle (`availability()` in four states, `create({ monitor, signal })`, `destroy()`,
`AbortSignal` on every long call), one engine interface per capability on an `/engine` subpath,
one model store, `checkFit` before download, one GPU guard. This ADR mirrors that sibling rather
than designing a second shape.

What the frame left open is this capability's own surface:

- No web API exists to copy — ADR 0132's table lists embeddings and image generation as the two
  capabilities with nothing — so request and result are ours to design. The app's
  `generate(request, { signal })` never said what `request` was.
- The engine produces a PNG; which JS type crosses the seam? `Blob` and `File` exist as web
  globals from `@gjsify/buffer`, `ImageData` exists in `packages/dom/canvas2d-core`, and
  `AbortSignal` already rides every long call in the frame.
- In-process or subprocess: the engine exists as an in-process addon, and wrapping the `sd` CLI
  in a subprocess instead would isolate crashes for free; ADR 0132 § 7 lets the existing engine
  move in as it is, and ADR 0133 has since built the `fork`/IPC plumbing that gives an
  in-process engine the same isolation when a caller wants it.
- Memory: ADR 0136's estimate is weights, KV cache and overhead, and a diffusion model has no KV
  cache — its working set scales with resolution instead.
- The store's `ModelEntry` is one file, and a diffusion setup can be several: a base checkpoint
  plus LoRAs, or a separate VAE.

## Decision

1. **The public class is `ImageGenerator`, mirroring `Embedder`.** Static
   `availability({ engine })` delegates to the engine factory the app chose; static
   `create({ engine, monitor, signal })` starts it; the instance reports `engine` (`EngineInfo`)
   and `modelId`, takes one `generate()` at a time, and `destroy()` waits for the running call
   and frees the engine — the app's `close()` becomes `destroy()`, as ADR 0132 § 2 ruled. The
   class owns the checks every engine would otherwise repeat: request validation (positive
   integers where given) and the destroyed state; defaults, upper bounds and alignment are the
   engine's. Aborting a call rejects the caller at once; the queue still waits for the engine to
   settle.
2. **One engine interface on an `/engine` subpath, under the sibling's names.** `ImageEngine`
   (`info`, `modelId`, `generate(request, { signal, onProgress })`, `destroy()`),
   `ImageEngineFactory` (`info`, `availability()`, `create({ monitor, signal })`),
   `EngineInfo { name, locality: 'local' | 'remote' }` and the four `Availability` states,
   identical to `@gjsify/embeddings`' so a surface can treat capabilities alike. Named exports,
   no global (ADR 0132 § 2); a vendor gjsify does not ship is an app-side factory, not a fork
   of the package.
3. **Request and result are web types.** `ImageRequest` is
   `{ prompt, negativePrompt?, width?, height?, steps?, guidance?, seed?, sampler?, scheduler?, loras?, init? }` — one
   image per call; batching is added when a consumer needs it. `scheduler` is passed straight to sd.cpp; `loras` is an array of verified file paths with multipliers, fetched app-side through `downloadVerified`. `ImageResult` carries `blob`,
   the PNG exactly as the engine wrote it (no re-encode), plus `width`, `height`, the `seed`
   the engine used (so a liked image can be reproduced) and `modelId`. `Blob` is
   `@gjsify/buffer`'s web global; `decode(result)` returns `canvas2d-core`'s `ImageData` for
   the surfaces that paint, as an export of this package. An empty or truncated `Blob` is an
   error, never a return value.
4. **The lifecycle is the WebML CG one, monitor included.** `availability()` has no side effects
   and never downloads. `create()` starts the engine, which installs a missing model through the
   store — driving the caller's `monitor` (`CreateMonitorCallback`) with `downloadprogress`
   (`loaded`, `receivedBytes`, `totalBytes`) — then loads. Imports are static: a bundled dynamic
   import with top-level await hangs on GJS (issue #2546), which is why `embeddings` imports
   statically too.
5. **`checkFit` sits in the engine's `availability()`, before any download** (ADR 0136 § 1 and
   § 6). The sd.cpp engine's model entry carries a measured `footprintBytes` — measured, not
   derived from the file size; a diffusion model's working set scales with resolution, so the
   number is taken at the entry's default size — and `availability()` reads machine memory and
   answers `unavailable` only when `checkFit(entry.footprintBytes, memory)` says `none`. The
   store never answers `unavailable` itself; whether a placement is fast enough stays the
   probe's question, at `create()`, on the consumer's budget (ADR 0132 § 6).
6. **The GPU guard is reused unchanged.** `createGpuGuard({ dir: defaultGuardDir('gjsify') })` —
   the same marker directory every capability writes (ADR 0132 § 6), so a driver that hung under
   one app warns the next. sd.cpp under Vulkan fails the way llama.cpp does: a wedged driver
   aborts the process, which no JS exception covers. The engine wraps each `generate()` in
   `during()` — marker before a GPU-backend run, cleared after a clean return — so a call that
   hangs, or aborts the process mid-run, leaves the marker standing for the next GPU attempt
   anywhere. CPU-only runs skip the guard, and nothing runs on battery.
7. **The first gjsify engine is the app's engine moved in as it is: in-process.** A N-API addon
   around sd.cpp, loaded through `@gjsify/napi` behind ADR 0017's per-target prebuilds, exposing
   `generate` and `setProgressCallback`; the image crosses the seam as the PNG bytes the addon
   produced, and `generate()` is async, so the interface admits it (ADR 0132 § 8). Crash
   isolation is not the default and not the engine's job: a caller who wants it hosts the
   engine in a child of its own through `fork` on `@gjsify/ipc-channel` (ADR 0133) — GJS-to-GJS
   takes `'advanced'`, so the image buffer transfers; a mixed pairing takes `'json'` — which is
   also how the app's crash-isolating-worker TODO is answered. No engine builds subprocess
   plumbing beyond that.
8. **What stays in the app:** provider engines — a vendor image API is an app-side factory, and
   the OpenAI-compatible client for `/v1/images/generations` is ADR 0132 § 10 step 5's package,
   registered by the app, never by default; the model library — which models surface, checkpoint
   versus LoRA, is the app's manifest decision (ADR 0132 § 5: the entry lives in the package
   that uses the model); downloads from third-party catalogues that need a login or an
   agreement, built on `downloadVerified` (streaming digest, atomic rename, an `Authorization`
   header) with the app supplying URL, size, digest and token; and every surface — progress,
   seed controls, gallery.

## Alternatives considered

- **`ImageData` as the primary result.** Every engine would decode, every save would re-encode,
  and the engine's PNG — already correct — would pass through two conversions. The
  `Blob` is what the engine produced; decode is one helper for the surfaces that paint.
- **A subprocess around the `sd` CLI.** Crash isolation for free and no prebuilds, but it
  discards the addon — its progress callback, its in-memory handoff — for argv marshalling and
  a PNG read back from disk, and makes the app provision a binary. ADR 0133's `fork` gives the
  in-process engine the same isolation when a caller asks for it.
- **A gjsify-only global** (`imageGeneration`, say). Rejected in ADR 0132 § 2 for every
  spec-less capability: there is no standard name to claim, and a gjsify-only global would look
  like a web API to code that feature-detects one.
- **Engine-private subprocess plumbing.** Each engine would re-derive framing and transfer;
  ADR 0132 § 8 already forbids it — the channel is ADR 0133's, once.

## Consequences

- One more capability package at tier 3 (ADR 0132 § 9), arrows pointing one way:
  image-generation → model-store, machine-fit. The sd.cpp engine is a native addon: it rides
  ADR 0017's per-target prebuilds through `@gjsify/napi`, and a prebuild missing for the
  current runtime is what `availability()` must notice and report.
- The app's engine becomes a thin adapter and then goes away (ADR 0132's consequence, one step
  closer), and its crash-isolating-worker TODO is answered by the `fork` pattern, not by new
  engine code.
- `Availability`, `EngineInfo` and `EngineCreateOptions` are defined here again, as `embeddings`
  defines them; a third capability repeating them is the trigger to extract the vocabulary into
  its own module.
- `decode()` ships a small pure-TypeScript PNG decoder (decision 1): written code — `node:zlib`
  inflate and unfilter — and a clear error for every PNG outside the 8-bit RGB/RGBA,
  non-interlaced subset.
- `ModelEntry` in model-store breaks (decision 2): a deliberate 0.x break — nothing outside the
  monorepo uses it yet — with embeddings and vad migrating in the same change, as its own PR.
- A multi-gigabyte model that cannot fit is ruled out before its download prompt, and a `none`
  is re-checked when the person asks (ADR 0136), not cached forever.

## Decisions on the open questions

The first review left these five open; the maintainer has since ruled on each. Every entry
gives the decision, a one-sentence reason, and the consequence:

1. **PNG decode.** `ImageResult.blob` (PNG) is the contract, and `decode()` returns `ImageData`
   through one small pure-TypeScript decoder: `node:zlib` inflate + unfilter, 8-bit RGB/RGBA,
   non-interlaced; anything else throws a clear error. *Reason:* no GdkPixbuf dependency — the
   same result on Node, GJS and any runtime, no system library. *Consequence:* the decoder is
   written code in this package, and a PNG outside that subset — interlaced, 16-bit, palette —
   fails loudly instead of decoding.
2. **Multi-file models.** model-store's `ModelEntry` grows
   `files: readonly { file, url, bytes, sha256 }[]`: a model is one or more verified files
   placed together. *Reason:* sherpa speech models and Flux-style image models are multi-file,
   so this is a model-store concern, not an image one. *Consequence:* a deliberate breaking
   change to the published 0.x API — nothing outside the monorepo uses it yet — with embeddings
   and vad migrating in the same change, tracked as its own PR; LoRAs chosen per request stay
   app-side, single files fetched with `downloadVerified`.
3. **No default model entry.** `create()` requires a model; omitting it is a clear error.
   *Reason:* WebML CG's `availability()`/`create()` leave model choice to the implementer, our
   implementer is the app, and a multi-gigabyte default is a licence and maintenance burden.
   *Consequence:* every entry is app-side; a known-good default can be added later, additively.
4. **Generation progress.** `generate(request, { signal, onProgress })` reports
   `{ step, steps, seconds }` — a deliberate deviation; no spec names one. *Reason:* the engine
   already reports step progress and a UI needs it. *Consequence:* engines map their native
   progress callbacks onto that triple, and callers who only cancel keep passing `{ signal }`.
5. **Sampler vocabulary.** `sampler?: string` in `ImageRequest`; the engine validates and
   rejects unknown names with a clear error listing the valid ones. *Reason:* a new sampler in
   the engine works without a package release. *Consequence:* a misspelled sampler is a
   run-time error, not a compile-time one — the listing error is the mitigation.
6. **Scheduler, LoRAs and an init image (amendment 2026-11-10).** `ImageRequest` also carries
   `scheduler?: string`, `loras?: readonly { path: string; multiplier: number }[]` and
   `init?: InitImage` (img2img: RGB pixels plus a `strength` from 0 to 1), because the first
   consumer uses all three per call.
   *Reason:* sd.cpp exposes scheduler choice and per-request LoRA application, both needed by
   the app's UI. `scheduler` is passed straight to the engine like `sampler`; LoRAs are verified
   file paths supplied by the app, not store entries, because a person mixes and matches LoRAs
   per image. *Consequence:* `ImageGenerator` validates that every `path` is non-empty and every
   `multiplier` is finite; the engine maps them onto its native option shape.
7. **Local files (amendment 2026-11-11).** The sd.cpp engine takes `{ local: LocalImageModel }`
   as an alternative to `{ store, model }`: paths to a checkpoint (and optional VAE and LLM)
   that the person already has. *Reason:* an app that lets people pick their own checkpoints
   has no manifest to hash; forcing a store entry would mean inventing digests it cannot know.
   *Consequence:* nothing is fetched or verified, `availability()` is `available` or
   `unavailable` (never `downloadable`), `create()` names the missing files, and the memory fit
   check runs only when `footprintBytes` is given. Both forms share one engine body behind an
   internal model-source seam.
