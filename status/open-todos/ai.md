<!-- Authored Open-TODO sections — area: AI capabilities (ADR 0121, 0127, 0132, 0136).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `@gjsify/speech-recognition` on the streaming zipformer

ADR 0127 § 13 step 3, on top of `@gjsify/sherpa-native` and `@gjsify/vad`: the W3C
`SpeechRecognition` surface including interim results.

### `@gjsify/whisper-native` as the accurate-finals backend

ADR 0127 § 13 step 4. The first second backend, so the first place where `probeBackends`
from `@gjsify/machine-fit` chooses between two.

### Switch Stamped to `@gjsify/embeddings`

ADR 0132 § 10 step 3. Blocked on the first npm publish of `@gjsify/embeddings`. Stamped keeps
its own `gpuGuardDir` and GPU switch; its `fork` shim goes now that ADR 0133 has landed.

### A gjsify-bundled dynamic import of a module with top-level await never settles on GJS

Found moving the llama.cpp engine in: `await import('node-llama-cpp')` in a `--app gjs` bundle
hangs without an error, while the static import and the same dynamic import bundled for Node
work. `@gjsify/embeddings/llama` imports node-llama-cpp statically until this is fixed. Issue #2546.

### Wire `checkFit` into every capability's `availability()`

ADR 0136 Implementation step 3: each capability package answers `unavailable` before download
when `checkFit` says `none`. The footprint inputs for its models are documented in that package.

### `@gjsify/image-generation` with the image-generation app's engine

ADR 0132 § 10 step 4.

### `@gjsify/openai-compatible` once a consumer registers a remote engine

ADR 0132 § 4 and § 10 step 5: client engines for the OpenAI-compatible endpoints, never
registered by default. Also the client for servers `@gjsify/local-ai-servers` finds (ADR 0136 § 4).

### A WebML CG API only when a consumer asks for one

ADR 0132 § 10 step 6. Nothing to do until a consumer names the API it needs.
