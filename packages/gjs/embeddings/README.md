# @gjsify/embeddings

Text embeddings in the WebML CG lifecycle shape: an `Embedder` with `availability()`, `create({ monitor, signal })` and `destroy()`, vectors checked before they reach the caller, and a local llama.cpp engine that runs GGUF models on Node and on GJS. The engine is a parameter, so an app can plug in a remote provider without gjsify shipping it.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: the `Embedder` and the engine's availability logic are unit-tested on Node and GJS; the llama.cpp engine has been run by hand against a real model, on CPU and on Vulkan. Design: ADR 0132.

## Installation

```bash
gjsify install @gjsify/embeddings
```

The root export needs nothing else. The llama.cpp engine needs its optional peers:

```bash
gjsify install node-llama-cpp @node-llama-cpp/linux-x64 @node-llama-cpp/linux-x64-vulkan
gjsify install @gjsify/napi   # GJS only
```

## Usage

```typescript
import { Embedder } from '@gjsify/embeddings';
import { llamaEmbeddings } from '@gjsify/embeddings/llama';

const engine = llamaEmbeddings({ dimensions: 256 });

if ((await Embedder.availability({ engine })) !== 'unavailable') {
    const embedder = await Embedder.create({
        engine,
        monitor: (m) => m.addEventListener('downloadprogress', (e) => console.log(e.loaded)),
    });
    const query = await embedder.embedQuery('how do I renew a passport');
    const docs = await embedder.embedDocuments([{ title: 'Passports', text: 'Renewal takes six weeks.' }]);
    await embedder.destroy();
}
```

`create()` downloads the model when it is missing (through `@gjsify/model-store`, digest-checked) and loads it. `availability()` reads no model bytes: it checks for the prebuilt binaries, the model file, and whether the machine has the memory for it (`@gjsify/machine-fit`).

## Exports

- **`.`** — `Embedder` and the types around it.
- **`./engine`** — the `EmbeddingEngine` / `EmbeddingEngineFactory` interfaces, plus `checkVector`, `normalize`, `truncateVector` and `embedAcross` for writing an engine of your own, local or remote.
- **`./llama`** — `llamaEmbeddings(options)`, the model manifest `EMBEDDING_MODELS` and `collectGarbage`.

What `Embedder` guarantees for every engine:

- Every vector is a finite `Float32Array` of `dimensions` length, one per input.
- One call runs at a time; later calls queue behind it.
- An aborted `signal` rejects at once. A signal that is already aborted never reaches the engine.
- `destroy()` waits for the calls it has already accepted, then frees the model. Later calls reject.

## The llama.cpp engine

| Option | Default | |
|---|---|---|
| `model` | `embeddinggemma-2-q8_0` | an id from `EMBEDDING_MODELS` |
| `modelPath` | — | a directory containing the model files, checked against the manifest's sizes and digests |
| `dimensions` | the model's native size | one of the model's `truncations` (EmbeddingGemma: 768 or 256) |
| `gpu` | `auto` | a `GpuSetting`, e.g. `parseGpuSetting(env.MYAPP_GPU)` from `@gjsify/machine-fit` |
| `gpuGuardDir` | shared by all gjsify GPU engines | where the GPU guard keeps its pin |
| `collectGarbage` | `true` | run the GC after each `embedDocuments` on GJS |

Input longer than the model's context is cut, not rejected.

**The GPU guard.** A Vulkan driver can hang a process instead of failing. Before going to the GPU, the engine leaves a pin in `gpuGuardDir` and removes it when the work finishes. A pin left over from a crash keeps the next run on the CPU and reports it through `onGpuPinned`. `gpu: 'on'` removes the pin.

**`collectGarbage` on GJS.** SpiderMonkey decides when to collect from the size of the JS heap, but an embedding run's garbage is mostly native memory behind small wrapper objects. One measured run of 1500 documents grew from 0.85 GB to 1.8 GB; with one collection per batch it stayed at 0.85 GB. A collection inside a database transaction has broken commits before, so if you embed inside one, set `collectGarbage: false` and call `collectGarbage()` after the commit.

### Bundling for GJS

`./llama` imports `node-llama-cpp` statically. Evaluating the module loads no addon and no model. The import is static because a bundled dynamic `import('node-llama-cpp')` never settles on GJS: its modules with top-level await become lazy async initialisers, and the import hangs without an error.

The app bundle needs one alias, `ipull` → `ipull/node`:

```json
{ "gjsify": { "aliases": { "ipull": "ipull/node" } } }
```

gjsify resolves with the `browser` condition, and ipull's browser build lacks the `downloadFile` that node-llama-cpp's model downloader imports. This engine never downloads through ipull, but the barrel still has to link.

On GJS the native addon is loaded through `@gjsify/napi`. Start the app with `gjsify run` so the napi typelib is found.

On macOS and Windows the llama.cpp engine runs on Node only, because the GJS route loads node-llama-cpp's Linux prebuilt binaries.

## License

MIT
