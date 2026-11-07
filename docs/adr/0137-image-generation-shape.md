# 137. Image generation follows the shared AI shape: `ImageGenerator`, web types for the data, sd.cpp as a subprocess engine

- Status: **Proposed**
- Date: 2026-11-07
- Deciders: Pascal Garber
- Related: [ADR 0132](0132-ai-capabilities-share-one-shape.md) (§ 2 the class, § 3 the engine
  interface, § 5 the model store, § 7 runtimes, § 8 isolation; § 10 step 4 is this package),
  [ADR 0133](0133-fork-and-worker-share-one-ipc-channel.md) (`fork` and the IPC channel),
  [ADR 0136](0136-machine-fit-checks-memory-and-finds-local-servers.md) (`checkFit` before
  download), `packages/gjs/embeddings` (the sibling mirrored here), `packages/gjs/model-store`,
  `packages/gjs/machine-fit`

## Context

ADR 0132 § 10 step 4 names this package: `@gjsify/image-generation`, with an image-generation
app's engine moved in. That engine drives stable-diffusion.cpp (sd.cpp) — it launches the `sd`
binary as a subprocess and reads the PNG the child writes — and it was written to import nothing
from the app so it can move. Its open TODOs are a remote engine and a crash-isolating worker.

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
- Subprocess or in-process: the subprocess shape exists and isolates crashes for free; ADR 0132
  § 7 lets the existing engines move in as they are, with a Vala bridge as the later target; and
  ADR 0133 has since built the `fork`/IPC plumbing an in-process engine would need for the same
  isolation.
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
   (`info`, `modelId`, `generate(request, { signal })`, `destroy()`), `ImageEngineFactory`
   (`info`, `availability()`, `create({ monitor, signal })`), `EngineInfo { name, locality:
   'local' | 'remote' }` and the four `Availability` states, identical to `@gjsify/embeddings`'
   so a surface can treat capabilities alike. Named exports, no global (ADR 0132 § 2); a vendor
   gjsify does not ship is an app-side factory, not a fork of the package.
3. **Request and result are web types.** `ImageRequest` is `{ prompt, negativePrompt?, width?,
   height?, steps?, guidance?, seed? }` — one image per call; batching is added when a consumer
   needs it. `ImageResult` carries `blob`, the PNG exactly as the engine wrote it (no
   re-encode), plus `width`, `height`, the `seed` the engine used (so a liked image can be
   reproduced) and `modelId`. `Blob` is `@gjsify/buffer`'s web global; `decode(result)` returns
   `canvas2d-core`'s `ImageData` for the surfaces that paint, as an export of this package. An
   empty or truncated `Blob` is an error, never a return value.
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
   aborts the process, which no JS exception covers. The subprocess engine wraps the child's run
   in `during()` — marker before a GPU-backend launch, cleared after a clean exit — so a child
   that hangs or aborts leaves the marker standing for the next GPU attempt anywhere. CPU-only
   runs skip the guard, and nothing runs on battery.
7. **The first gjsify engine wraps the `sd` binary as a subprocess**, the app's engine moved in
   as it is: request to argv, PNG from the child. Crash isolation comes free (a GPU abort kills
   the child, not the app, which can offer a retry), no per-target N-API prebuild is needed
   before ADR 0132 § 7's bridge exists (ADR 0017's cost deferred), and `spawn` runs under GJS
   and plain Node alike. The interface already admits in-process (ADR 0132 § 8): `generate()`
   is async and the image crosses as bytes. When an in-process engine lands — an N-API addon,
   later the Vala bridge — it runs inside a child of its own through `fork` on
   `@gjsify/ipc-channel` (ADR 0133): GJS-to-GJS takes `'advanced'`, so the image buffer
   transfers; a mixed pairing takes `'json'`. No engine builds subprocess plumbing beyond that.
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
  and the subprocess engine's PNG — already correct — would pass through two conversions. The
  `Blob` is what the engine produced; decode is one helper for the surfaces that paint.
- **In-process first.** It would move the crash-isolation TODO from free to ADR 0133's whole
  job, and buy per-target prebuilds before the bridge exists. Reconsidered when the bridge
  lands, measured on prebuild size, not assumed (ADR 0132 § 7's own rule).
- **A gjsify-only global** (`imageGeneration`, say). Rejected in ADR 0132 § 2 for every
  spec-less capability: there is no standard name to claim, and a gjsify-only global would look
  like a web API to code that feature-detects one.
- **Engine-private subprocess plumbing.** Each engine would re-derive framing and transfer;
  ADR 0132 § 8 already forbids it — the channel is ADR 0133's, once.

## Consequences

- One more capability package at tier 3 (ADR 0132 § 9), arrows pointing one way:
  image-generation → model-store, machine-fit. The sd.cpp engine adds a run-time dependency on
  the `sd` binary, which the app or the person provides, and whose absence `availability()` must
  notice.
- The app's engine becomes a thin adapter and then goes away (ADR 0132's consequence, one step
  closer), and its crash-isolating-worker TODO is answered by the subprocess shape itself.
- `Availability`, `EngineInfo` and `EngineCreateOptions` are defined here again, as `embeddings`
  defines them; a third capability repeating them is the trigger to extract the vocabulary into
  its own module.
- `decode()` needs a PNG decoder: GdkPixbuf is there under GJS; a pure-TypeScript one is not
  written yet (open question 1).
- A multi-gigabyte model that cannot fit is ruled out before its download prompt, and a `none`
  is re-checked when the person asks (ADR 0136), not cached forever.

## Open questions

1. **PNG decode.** Through GdkPixbuf under GJS only, or a pure-TS decoder so `decode()` also
   works under plain Node — and does the decoder live here, in `@gjsify/buffer`, or beside
   `canvas2d-core`?
2. **Multi-file models.** Does `ModelEntry` grow setups (checkpoint + LoRAs + VAE), or does the
   app compose single-file entries and pass the set to the engine? Settled with the first
   consumer that ships a LoRA.
3. **A default model entry.** Does the package manifest one known-good checkpoint (measured
   `footprintBytes`, licence permitting redistribution), or is every entry app-side and the
   gjsify engine ships none?
4. **Generation progress.** `downloadprogress` covers the model, but a 30–120 s generation has
   no event in this shape: opaque with `AbortSignal` only, or a per-step callback the engine
   reports and no spec names?
5. **Sampler vocabulary.** Samplers are engine-specific words. A closed union in `ImageRequest`
   (portable, reviewed per engine) or an engine options record (honest, unportable)?
