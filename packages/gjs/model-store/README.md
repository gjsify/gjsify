# @gjsify/model-store

Where an AI model lives, whether it is there, and how it gets there: one store per capability (speech, embeddings, image generation), with streaming download, SHA-256 verification, progress in the WebML CG `monitor` shape, and three sources in a fixed order. A model entry is one or more files placed together under their own directory. Pure TypeScript on `node:*` APIs: it runs under plain Node as well as under GJS.

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
        files: [
            {
                file: 'silero_vad_v5.onnx',
                url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx',
                bytes: 2313101,
                sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
            },
        ],
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
const { dir, files } = await store.resolve('silero-v5');
const modelPath = files['silero_vad_v5.onnx'];
```

## Sources, in order

1. **A configured path** — `resolve(id, { path })`, for a model the person already has. It must contain every file with the manifest's size; otherwise `locate()` throws instead of silently downloading.
2. **The app's data dirs** — `appDataDirs`, read-only, for an app that ships a model whose `redistributable` is `true`. Each entry lives in a subdirectory named by its id.
3. **The cache** — `<user cache>/gjsify/models/<capability>/<id>/`, which `install()` downloads into. Every entry has its own directory so several models can each carry a `tokens.txt` without collision. `<user cache>` is `$XDG_CACHE_HOME` or `~/.cache` as GLib answers it (`%LOCALAPPDATA%` on Windows).

`legacyDirs` names directories an older release cached into; matching files are moved into the cache the first time they are looked up.

Digests: downloaded files are hashed while they stream and only renamed into place once they match, so the cache is checked by size afterwards. Configured or app-shipped files are hashed by `resolve()` once per process (remembered per size and mtime). `locate()` and `availability()` are synchronous and read no model bytes.

The store never answers `unavailable` itself: that is the capability's call (no engine, or `checkFit` from `@gjsify/machine-fit` says `none`).

## Downloading a file you did not plan for: `downloadVerified`

Not every model comes from a fixed manifest. For a one-off download that still needs streaming verification and an atomic rename, use the standalone helper:

```typescript
import { downloadVerified } from '@gjsify/model-store';

const { bytes, sha256 } = await downloadVerified({
    url: 'https://example.org/one-off.bin',
    dest: '/tmp/one-off.bin',
    bytes: 2313101,
    sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
    headers: { Authorization: 'Bearer token' },
    monitor: (m) => m.addEventListener('downloadprogress', (e) => console.log(e.loaded)),
});
```

`bytes` and `sha256` are optional checks, but the returned values always report what was actually received. The file is written under a temporary name and renamed into place only after the checks pass; failures remove the partial file.

## License

MIT
