# @gjsify/image-generation

Image generation in the WebML CG lifecycle shape: an `ImageGenerator` with `availability()`, `create({ monitor, signal })` and `destroy()`, a pure-TypeScript PNG decoder, and a local stable-diffusion.cpp engine for diffusion models on Node and GJS. The engine is a parameter, so an app can plug in a remote provider without gjsify shipping it.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: the `ImageGenerator` and the engine's availability logic are unit-tested on Node and GJS; the sd.cpp engine is tested against a fake addon only. No real model has run through this port yet. Design: ADR 0137.

## Installation

```bash
gjsify install @gjsify/image-generation
```

The root export needs nothing else. The sd.cpp engine needs its optional peers:

```bash
gjsify install stable-diffusion-cpp-node-api @stable-diffusion-cpp-node-api/linux-x64 @stable-diffusion-cpp-node-api/linux-x64-vulkan
gjsify install @gjsify/napi   # GJS only
```

## Usage

```typescript
import { ImageGenerator, decode } from '@gjsify/image-generation';
import { sdCppImageGeneration } from '@gjsify/image-generation/sdcpp';

const engine = sdCppImageGeneration({ store, model: 'my-model' });

if ((await ImageGenerator.availability({ engine })) !== 'unavailable') {
    const generator = await ImageGenerator.create({
        engine,
        monitor: (m) => m.addEventListener('downloadprogress', (e) => console.log(e.loaded)),
    });
    const result = await generator.generate({ prompt: 'a cat in a spaceship' });
    const image = await decode(result.blob);   // { width, height, data: Uint8ClampedArray }
    await generator.destroy();
}
```

`create()` downloads the model when it is missing (through `@gjsify/model-store`, digest-checked) and loads it. `availability()` reads no model bytes: it checks for the prebuilt binaries, the model file, and whether the machine has the memory for it (`@gjsify/machine-fit`).

## Exports

- **`.`** — `ImageGenerator`, `decode()`, and the types around them.
- **`./engine`** — the `ImageEngine` / `ImageEngineFactory` interfaces for writing an engine of your own, local or remote.
- **`./sdcpp`** — `sdCppImageGeneration(options)`, the engine factory that wraps stable-diffusion.cpp.

What `ImageGenerator` guarantees for every engine:

- One `generate()` runs at a time; later calls queue behind it.
- Requests are validated before they reach the engine (positive integers where given, valid init image, finite LoRA multipliers).
- An aborted `signal` rejects at once. A signal that is already aborted never reaches the engine.
- `destroy()` waits for the calls it has already accepted, then frees the engine. Later calls reject.

## The sd.cpp engine

| Option | Default | |
|---|---|---|
| `store` | — | a `ModelStore<ImageModelEntry>` with the model manifest |
| `model` | — | an id from the store |
| `gpu` | `auto` | a `GpuSetting`, e.g. `parseGpuSetting(env.MYAPP_GPU)` from `@gjsify/machine-fit` |
| `gpuGuardDir` | shared by all gjsify GPU engines | where the GPU guard keeps its pin |
| `probe` | live machine probe | the machine `availability()` asks |

The model entry extends `ModelEntry` with sd.cpp-specific roles:

- `diffusionModel`: which file in `entry.files` is the diffusion checkpoint (required).
- `vae`: optional VAE file name.
- `llm`: optional text-encoder / LLM file name (e.g. Qwen for Z-Image).
- `backend`: optional per-module device assignment, e.g. `te=cpu`.
- `defaultWidth` / `defaultHeight`: the size the footprint was measured at.
- `footprintBytes`: measured working set at the default size.

`ImageRequest` carries `prompt`, optional `negativePrompt`, `width`, `height`, `steps`, `guidance`, `seed`, `sampler`, `scheduler`, `loras` and an `init` image for img2img.

**The GPU guard.** A Vulkan driver can hang a process instead of failing. Before going to the GPU, the engine leaves a pin in `gpuGuardDir` and removes it when the work finishes. A pin left over from a crash keeps the next run on the CPU and reports it through `onGpuPinned`. `gpu: 'on'` removes the pin.

### Bundling for GJS

`./sdcpp` imports `@gjsify/napi` statically. Evaluating the module loads no addon and no model. The import is static because a bundled dynamic `import('@gjsify/napi')` never settles on GJS: its modules with top-level await become lazy async initialisers, and the import hangs without an error.

On GJS the native addon is loaded through `@gjsify/napi`. Start the app with `gjsify run` so the napi typelib is found.

On macOS and Windows the sd.cpp engine runs on Node only, because the GJS route loads stable-diffusion-cpp-node-api's Linux prebuilt binaries.

## License

MIT
