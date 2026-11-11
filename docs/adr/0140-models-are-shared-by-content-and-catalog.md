# 140. Models are shared by content and by catalog: one entry list, one blob per SHA-256, the Hugging Face cache as a source

- Status: **Accepted**
- Date: 2026-11-11
- Deciders: Pascal Garber
- Amends [ADR 0132](0132-ai-capabilities-share-one-shape.md) § 5 (the manifest no longer lives only
  in the package that uses the model; three sources become four).
- Related: [ADR 0127](0127-speech-recognition-on-local-engines.md) § 8,
  [ADR 0136](0136-machine-fit-checks-memory-and-finds-local-servers.md) (local servers are the
  other way to reuse a model someone already runs), `packages/gjs/model-store`,
  `packages/web/vad`, `packages/gjs/embeddings`

## Context

Every app that embeds a capability needs the same weights: a Silero VAD for speech, the same
Whisper or Piper file for STT/TTS, the same embedding model. ADR 0132 § 5 gave all apps one cache
(`<user cache>/gjsify/models/<capability>/<id>/`), so two apps that name the same entry already
share it. Three gaps stayed open:

1. **The manifest is per package.** Two packages (or an app and a package) that list the same file
   under different ids or file names download it twice. Nothing checks that their `bytes` and
   `sha256` agree.
2. **The cache is keyed by name, not by content.** A model installed under capability `speech` and
   the identical file under `embeddings` are two copies.
3. **Models a person already has are only reachable through a path they type in.** Many people
   already hold GGUF/ONNX files in the Hugging Face cache (`~/.cache/huggingface/hub`), the most
   widespread de-facto layout there is.

No AI standard defines a cache location. XDG (and the platform equivalents) is the only one, and
we already use it. The WebML CG shapes (`availability`, `monitor`) cover state and progress, not
storage.

## Decision

1. **One catalog of file facts: `@gjsify/model-store/catalog`.** A subpath of the existing
   package, not a new package: a new `@gjsify/*` name needs a manual npm first-publish before the
   release that ships it (`docs/publishing.md`), and its dependents are skipped until then. The
   catalog holds only what must be identical everywhere: id, capability, files (url, bytes,
   sha256), licence, `redistributable`, description. Behaviour that belongs to one capability
   (VAD window size, embedding templates and dimensions, memory footprint) stays in that
   capability's package and is composed on top of the catalog entry. Every field is measured from
   the real file; the pin of a revision in the URL stays mandatory.
2. **One blob per SHA-256.** `install()` writes the verified file as a hard link to
   `<user cache>/gjsify/models/blobs/<sha256>`; the entry directory keeps the file under its
   upstream name. A second entry with the same digest is linked instead of downloaded.
   `uninstall()` removes a blob when no entry references it (link count 1). If linking is not
   possible (another filesystem, FAT), the entry keeps a plain file and no blob is made: sharing
   degrades, nothing breaks. No symlinks (Windows, Android). `dedupe()` adopts a cache that
   existed before this change. The digest is verified on download; later reads are checked by
   size, as before.
3. **The Hugging Face cache is a fourth, read-only source**, after our cache and before the
   download: `HF_HUB_CACHE`, `$HF_HOME/hub`, or `~/.cache/huggingface/hub`. A file matches by its
   pinned `huggingface.co/<org>/<repo>/resolve/<rev>/…` URL or by `blobs/<sha256>` (LFS files are
   stored under their SHA-256). Size is checked on locate, the digest once per process on
   resolve. We never write into it or delete from it.
4. **Out of scope, stated so it is not mistaken for an oversight.** Flatpak gives every app its
   own cache, so apps in different sandboxes do not share; sharing there needs a
   `--filesystem` grant or a local server (ADR 0136). In a browser there is no file cache; OPFS or
   the Cache API would be the equivalent and is not built. macOS and Android use the same
   resolution as Linux and are not measured.

## Consequences

- Adding STT or TTS to a second app costs one catalog reference, not a second download and not a
  second hand-copied manifest.
- The catalog is data in a versioned package: a new model reaches apps with the next release of
  `@gjsify/model-store`. That is the price of one source of truth.
- `ModelSource` gains `'huggingface'`; code that switches on it needs a case.
- A cache written before this change keeps working untouched and is only deduplicated when
  `dedupe()` runs.

## Implementation

`packages/gjs/model-store` (`src/store.ts`, `src/catalog/`), with `@gjsify/vad` and
`@gjsify/embeddings` composing their entries from the catalog.
