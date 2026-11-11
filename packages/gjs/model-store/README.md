# @gjsify/model-store

Where an AI model lives, whether it is there, and how it gets there: one store per capability (speech, embeddings, image generation), with streaming download, SHA-256 verification, progress in the WebML CG `monitor` shape, and four sources in a fixed order. A model entry is one or more files placed together under their own directory. Pure TypeScript on `node:*` APIs: it runs under plain Node as well as under GJS.

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
4. **The Hugging Face hub cache** — read-only. Enabled by default at `$HF_HUB_CACHE`, `$HF_HOME/hub` or `~/.cache/huggingface/hub`; disable with `huggingFaceCache: false` or point it elsewhere with a string. A file is found when its `url` matches `https://huggingface.co/<org>/<repo>/resolve/<rev>/<path>` and the corresponding `models--<org>--<repo>/snapshots/<rev>/<path>` exists, or when any `models--*/blobs/<sha256>` matches the manifest digest.

`legacyDirs` names directories an older release cached into; matching files are moved into the cache the first time they are looked up.

Digests: downloaded files are hashed while they stream and only renamed into place once they match, so the cache is checked by size afterwards. Configured, app-shipped and HF-cache files are hashed by `resolve()` once per process (remembered per size and mtime). `locate()` and `availability()` are synchronous and read no model bytes.

The store never answers `unavailable` itself: that is the capability's call (no engine, or `checkFit` from `@gjsify/machine-fit` says `none`).

## Content-addressed deduplication

Files with the same SHA-256 are stored once under `<root>/blobs/<sha256>` and hard-linked into each entry directory. If two model ids share the same file it is downloaded only once; `uninstall()` removes a blob only when it is the last hard link. If hard-linking is not supported (different filesystem, FAT, `EPERM`) the store silently falls back to a plain file per entry and keeps no blob for it.

`await store.dedupe()` migrates pre-existing plain-file caches: it hashes every installed cache file, hard-links unique content into `blobs/`, replaces duplicate plain files with hard links to the shared blob, and removes orphan blobs. It serialises against concurrent `install()` / `uninstall()` calls.

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

`bytes` and `sha256` are optional checks, but the returned values always report what was actually received. The file is written under a temporary name and renamed into place only after the checks pass; verification failures remove the partial file.

## Resuming interrupted downloads

`downloadVerified` keeps a partial file next to the destination (`<dest>.part`) and sends `Range: bytes=<partial>-` on the next call. A `206 Partial Content` response appends to the partial, a `200` response restarts from scratch, and a `416 Range Not Satisfiable` either verifies the already-complete partial or discards it and restarts once. The SHA-256 is computed over the whole file after it is complete. Abort and network errors leave the partial in place so the next call can resume; only a hash/size mismatch deletes it.

Concurrent calls for the same destination are serialized so two writers cannot corrupt the partial file.

## The catalog

`@gjsify/model-store/catalog` is the shared home for measured model file facts. A capability package — or an app with its own models — imports an entry and adds the behaviour fields that only it knows about:

```typescript
import { requireCatalogEntry } from '@gjsify/model-store/catalog';

const vadModel = {
    ...requireCatalogEntry('speech', 'silero-v5'),
    sampleRate: 16000,
    windowSize: 512,
};
```

Entries carry `id`, `files` (`file`, `url`, `bytes`, `sha256`), `license`, `redistributable`, `description`, and a `capability` string. The `capability` field is stripped while composing so the resulting `ModelEntry` stays byte-identical to the old per-package manifests.

`catalogFor(capability)`, `findCatalogEntry(capability, id)`, and `requireCatalogEntry(capability, id)` look entries up; `requireCatalogEntry` throws `RangeError` naming the known ids, mirroring `requireVadModel`.

### Adding a model

1. Download the real upstream file.
2. Measure `bytes` (exact file size) and `sha256` (lowercase hex).
3. Pin the URL to a fixed revision so a re-upload fails the digest instead of silently changing vectors.
4. Add the entry to the per-capability module under `packages/gjs/model-store/src/catalog/`.
5. Add a capability package or app spec that asserts the composed entry's file facts match the catalog.

## Limitations

- Flatpak gives every app its own `XDG_CACHE_HOME`, so sharing the cache or blobs across separate Flatpak apps does not happen.
- Legacy cache files (and plain-file fallbacks when hard-linking fails) are size-checked only, the same as before deduplication was introduced.
- Where a filesystem reports no inode or link count (`0`, as GJS does for some), `dedupe()` links nothing and orphan blobs are never removed: both fail safe.
- The Hugging Face source is strictly read-only: `install()`, `uninstall()` and `dedupe()` never create, modify or delete files inside the HF hub directory. `@gjsify/vad` turns it off, because its synchronous path cannot check a digest.

## License

MIT
