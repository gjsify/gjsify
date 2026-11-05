# @gjsify/model-store

Where an AI model lives, whether it is there, and how it gets there: one store per capability (speech, embeddings, image generation), with streaming download, SHA-256 verification, progress in the WebML CG `monitor` shape, and three sources in a fixed order. Pure TypeScript on `node:*` APIs: it runs under plain Node as well as under GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: tested against a temporary directory and an injected `fetch`; no test downloads a model. Design: ADR 0132 § 5.

## Installation

```bash
gjsify install @gjsify/model-store
```

## Usage

The manifest belongs to the package (or app) that uses the models. Every field is measured from the real file.

```typescript
import { ModelStore, type ModelEntry } from '@gjsify/model-store';

const MODELS: readonly ModelEntry[] = [
    {
        id: 'silero-v5',
        file: 'silero_vad_v5.onnx',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx',
        bytes: 2313101,
        sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
        license: 'MIT',
        redistributable: true,
    },
];

const store = new ModelStore({ capability: 'speech', models: MODELS });

if (store.availability('silero-v5') === 'downloadable') {
    await store.install('silero-v5', {
        monitor: (m) => m.addEventListener('downloadprogress', (e) => console.log(e.receivedBytes, e.loaded)),
    });
}
const path = await store.resolve('silero-v5');
```

## Sources, in order

1. **A configured path** — `resolve(id, { path })`, for a model the person already has. It must exist and have the manifest's size; otherwise `locate()` throws instead of silently downloading.
2. **The app's data dirs** — `appDataDirs`, read-only, for an app that ships a model whose `redistributable` is `true`.
3. **The cache** — `<user cache>/gjsify/models/<capability>/`, which `install()` downloads into. `<user cache>` is `$XDG_CACHE_HOME` or `~/.cache` as GLib answers it (`%LOCALAPPDATA%` on Windows).

`legacyDirs` names directories an older release cached into; a matching file is moved into the cache the first time it is looked up.

Digests: a downloaded file is hashed while it streams and only renamed into place once it matches, so the cache is checked by size afterwards. A configured or app-shipped file is hashed by `resolve()` once per process (remembered per size and mtime). `locate()` and `availability()` are synchronous and read no model bytes.

The store never answers `unavailable` itself: that is the capability's call (no engine, or `checkFit` from `@gjsify/machine-fit` says `none`).

## License

MIT
