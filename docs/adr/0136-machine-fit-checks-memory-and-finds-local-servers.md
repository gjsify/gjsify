# 136. Machine fit rules a model out by memory before download, and local inference servers are found by their own package

- Status: **Accepted** (2026-11-05)
- Date: 2026-11-05
- Deciders: Pascal Garber
- Amends [ADR 0127](0127-speech-recognition-on-local-engines.md) § 11 and § 13, and makes one
  narrow exception to [ADR 0132](0132-ai-capabilities-share-one-shape.md) § 3. Both stay in force
  for everything else, including ADR 0127 § 12: the probe is the only evidence of speed.
- Related: [ADR 0003](0003-package-tiering.md) (tiers); `packages/gjs/machine-fit`,
  `packages/gjs/local-ai-servers`

## Context

ADR 0127 § 12 makes the probe the only evidence that counts: load the engine, run a short input,
measure it against the consumer's budget. That is right for speed. It cannot answer the question
`availability()` has to answer first: is a model worth downloading at all? A probe needs the
model on disk, and a 5 GB download to learn that it does not fit in 8 GB of VRAM is the worst
outcome a download prompt can produce. Memory, unlike speed, can be read without loading
anything: RAM from `node:os`, VRAM from sysfs or `nvidia-smi`, unified memory from `sysctl`.

The second gap is a model that is already loaded. People who run local models usually run them
in Ollama, LM Studio or llama.cpp's `llama-server`. An app that loads its own copy of the same
model into the same GPU doubles the memory and often no longer fits. Every one of these servers
speaks the OpenAI-compatible API ADR 0132 § 4 already covers, so the missing piece is only
finding them.

The open-source tool llmfit (MIT) answers "which models fit this machine" from a hardware read
and a memory formula. Its formula (weights, KV cache, overhead) and its use of free rather than
total VRAM are taken as ideas here; no code is taken. It does not account for models another
server already holds, and it ranks speed from a static table, which § 12 rules out.

## Decision

1. **`@gjsify/machine-fit` gains a static memory check that can only rule out.**
   `readMachineMemory()` reads RAM and every GPU's memory, `estimateFootprint()` adds weights, KV
   cache and overhead, and `checkFit(bytes, memory)` answers a placement: `gpu`, `gpu+cpu`,
   `cpu`, `unknown` or `none`. Only `none` is a verdict. It feeds `availability()`, which
   answers `unavailable` before any download. The other four mean "not ruled out", and there is
   no "slow" state: whether a placement is fast enough is still decided by the probe at
   create/start, as § 12 says.
2. **The check counts FREE memory, and an unknown is never zero.** A GPU's free memory is its
   total minus what is in use by any process, so a model Ollama already holds counts against it
   without asking Ollama. Unified memory is capped by available RAM. A GPU whose memory cannot be
   read (an NVIDIA card without `nvidia-smi`, any non-NVIDIA GPU on Windows) is `unknown`, which
   rules nothing out. Everything is read without native code: sysfs, `nvidia-smi`, `sysctl` and
   `node:os`. Apple silicon's GPU share is `iogpu.wired_limit_mb` when set, else 75 % of RAM, an
   approximation of Metal's `recommendedMaxWorkingSetSize`, which needs Metal to read.
3. **The numbers stay with the consumer**, as § 12 already says for candidates and budgets.
   Bits per weight, KV bytes per token and engine overhead are inputs to `estimateFootprint`;
   `machine-fit` holds no table of quantizations or model families.
4. **Local inference servers are found by their own optional package,
   `@gjsify/local-ai-servers`.** `discoverLocalServers()` returns each server it found with its
   OpenAI base URL and its models, each with a loaded state and, where the server reports it, the
   VRAM it holds. The app calls it explicitly; `availability()` never does, and no capability
   package depends on it. It asks only fixed loopback addresses (Ollama on 11434 or
   `OLLAMA_HOST`, LM Studio on 1234, `llama-server` on 8080), with a short timeout per request.
   It never scans ports or the LAN. A response that does not have the expected shape means "not
   that server". Requests to a server found this way go through the app's own OpenAI-compatible
   client (ADR 0132 § 4), never through this package.
5. **The exception to ADR 0132 § 3.** That decision keeps provider-specific code out of gjsify.
   `local-ai-servers` carries code for three named servers, and that is allowed only because it
   is limited to read-only listing endpoints on loopback: no inference, no login, no remote host.
   A server that needs its own inference protocol is still an app-side engine.
6. **Order of work: `machine-fit` is extracted now, not last.** ADR 0127 § 13 put it at step 5
   because choosing between backends only matters once there are two. The memory check matters
   before there is one: `@gjsify/embeddings` and `@gjsify/image-generation` (ADR 0132 § 10) need
   it in their first `availability()`. The probe, guard and hints from § 11 move with it; their
   behaviour is unchanged. The rest of § 13's order stands.
7. **Both packages live in `packages/gjs/`, at tier 3**, beside `@gjsify/dav`: pure TypeScript
   on `node:*` and `fetch`, so they run under plain Node as well as under GJS, with the `@gjsify/*`
   substitutions declared as dependencies. Tests use made-up machines and mocked server
   responses; no test reads real hardware or needs a running server.

## Consequences

- A model that cannot fit is ruled out before its download. A model that fits by memory can
  still turn out too slow; the probe tells, and the app picks another candidate as before.
- Free memory changes. A `none` while another app holds the GPU can be wrong once that app
  exits, so an app re-checks when the user asks instead of caching `none` forever.
- Memory on Windows without NVIDIA, on Intel Macs and on integrated Intel GPUs on Linux is mostly
  `unknown` or bounded by RAM. The package declares that per OS (ADR 0018) instead of guessing.
- An app that offers the loaded model from Ollama reuses its memory. It also depends on a server
  the user controls, which may unload or vanish; the app treats that endpoint like any other
  remote engine.
- Stamped keeps its own copies of the guard, battery and Vulkan code until it switches to the
  package. That switch is Stamped's change, not this one.

## Implementation

1. `@gjsify/machine-fit` and `@gjsify/local-ai-servers` land with this ADR, both in
   `status/pending-npm-bootstrap.json` until their names exist on npm.
2. ADR 0127 and ADR 0132 are accepted in the same change, and their open work is tracked in
   `status/open-todos/ai.md`.
3. Wire `checkFit` into `availability()` in each capability package as it is written, starting
   with `@gjsify/embeddings`. The footprint inputs for its models live in that package's docs.
