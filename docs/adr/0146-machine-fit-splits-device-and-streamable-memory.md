# 146. Machine fit tells device memory from streamable weights, and image generation sizes its compute by the request

- Status: **Accepted** (2026-11-15)
- Date: 2026-11-15
- Deciders: Pascal Garber
- Amends: [ADR 0136](0136-machine-fit-checks-memory-and-finds-local-servers.md) § 1 (what
  `checkFit` is asked) and [ADR 0137](0137-image-generation-shape.md) (where the image engine's
  footprint comes from). ADR 0136 § 2 and § 3 stay in force unchanged: free memory, unknown is
  never zero, and the numbers stay with the consumer.

## Context

ADR 0136 asks `checkFit` one number: the model's whole working set. That fits an engine that
keeps every weight resident while it computes. stable-diffusion.cpp no longer does. Since its
model manager landed, it plans placement itself (`auto-fit plan` in its log): weights stay in RAM
and are streamed to the GPU in blocks of about 200 MB, and under RAM pressure it maps them from
disk. Only the compute buffers must sit on the device that computes.

Measured on an 8 GB RX 6600 (Vulkan) with FLUX.2 Klein 4B Q8_0, its Qwen3 4B text encoder and the
Flux2 VAE, one step each (2026-11-14):

| Size | Latent tokens | Diffusion compute, flash attention | Without |
|---|---|---|---|
| 512² | 1024 | 329 MB | 491 MB |
| 768² | 2304 | 598 MB | 1191 MB |
| 1024² | 4096 | 1120 MB | 2705 MB |
| 1024×1536 | 6144 | 1489 MB | 5155 MB |

Three things follow:

1. **Summing the files against VRAM is wrong in both directions.** The three files total 12.7 GB,
   so `checkFit` would place this model `gpu+cpu` or `cpu` from the file sizes, yet it runs on
   the GPU. And it says nothing about the case that actually fails.
2. **What fails is the compute buffer, and it depends on the request.** Without flash attention
   the buffer grows with the square of the latent token count (≈ 93 bytes per token², which is
   one f32 score per attention head); with it, linearly (≈ 240 KB per token). 1024×1536 without
   flash attention needs 5.2 GB against a 5.5 GB device budget: whether it runs depends on what
   else holds VRAM, and when it does not, sd.cpp reports only "Image generation failed".
3. **`footprintBytes`, one number measured at the default size, cannot express this.** It is
   right at 512² and silent about 1536 px.

The same split already exists outside images: llama.cpp with partial offload keeps some layers in
RAM, Whisper keeps its decoder cache on the device. The split is generic; the numbers are not.

## Decision

1. **`checkFit` also accepts a split requirement.** Next to a number, `checkFit` takes
   `{ deviceBytes, streamableBytes?, diskBacked? }`:
   - `deviceBytes` must sit on the device that computes (compute buffers, activations, KV cache
     the engine will not offload);
   - `streamableBytes` may live in RAM and be moved to the device as needed (weights);
   - `diskBacked: true` says the engine can map them from disk when RAM is short, so RAM is not a
     hard limit for them.

   Placements keep their meaning: `gpu` when one GPU holds both parts, `gpu+cpu` when a dedicated
   GPU holds `deviceBytes` and RAM (or disk) the rest, `cpu` when RAM holds the device part and
   the rest, `unknown` and `none` as before. Only `none` is a verdict. A plain number keeps its
   current meaning exactly, so no existing caller changes. `estimateFootprint` stays as it is.
2. **Image generation estimates its compute per request, from a compute profile.** A
   `SdCppComputeProfile` (base bytes, bytes per latent token, attention bytes per token², pixels
   per latent token) turns width, height and flash attention into the diffusion compute buffer;
   the text encoder and the tiled VAE decode add their measured floors, and sd.cpp's own device
   reserve is added on top. Weights are the files' sizes, as `streamableBytes`, `diskBacked`. The
   phases run one after another, so the device part is their maximum, not their sum.
3. **The estimate is a lower bound, and one profile ships.** `@gjsify/image-generation` ships the
   profile measured above for FLUX.2 Klein 4B and uses it when a model names none. A larger model
   needs more, so for it the estimate is too small, which can only miss a warning, never refuse
   a model that would have run. That keeps ADR 0136 § 2's direction: when in doubt, do not rule
   out. Catalog entries and local models may carry their own profile; profiles stay in the
   consumer, never in `machine-fit` (ADR 0136 § 3).
4. **The check runs where the size is known.** `availability()` checks the default size, as
   before. `generate()` checks the request's size and flash-attention setting before handing it
   to sd.cpp, and when the result is `none` it throws a `QuotaExceededError` naming the size and,
   if flash attention is off, that turning it on shrinks the buffer. A measured `footprintBytes`
   still wins over the estimate where a catalog entry has one.
5. **The engine forwards sd.cpp's log.** `SdCppCommonOptions.onLog(level, text)` receives
   sd.cpp's log lines. Without it the compute-buffer and auto-fit lines are invisible, and they
   are what a profile for a new model is calibrated from.

## Consequences

- Apps on `@gjsify/image-generation` get a sentence instead of "Image generation failed" when a
  size cannot fit, and they get it before minutes of sampling, not after.
- Any engine with streamed or offloaded weights (llama.cpp layer offload, a future Whisper on the
  GPU) can state what it really needs, without `machine-fit` learning about that engine.
- Shipping one calibrated profile means other model families under-warn until someone measures
  them. The `onLog` hook is what makes measuring cheap.
- The numbers are sd.cpp's at the time of measuring. When its allocator changes, the profile
  goes stale in the safe direction only if the buffers shrink; a re-measure belongs in the bump
  that changes the sd.cpp version.

## Implementation

- `@gjsify/machine-fit`: `FitRequirement` type, `checkFit(bytes | FitRequirement, memory)`, specs
  for each placement with a split requirement, README section.
- `@gjsify/image-generation`: `SdCppComputeProfile`, `FLUX2_KLEIN_4B_COMPUTE`,
  `estimateSdCppRequirement(...)`, the check in `availability()` and `generate()`, `onLog`,
  specs on made-up machines, README section.
