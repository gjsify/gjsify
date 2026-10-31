# @gjsify/sherpa-native

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)'s C API as a Vala/GObject bridge,
built as one relocatable shared library plus its GObject-Introspection typelib — so
`gi://GjsifySherpa?version=1.0` gives GJS a Silero voice activity detector and
streaming/whole-utterance speech recognizers on a host that has neither sherpa-onnx nor
onnxruntime installed.

This is the backend of [`@gjsify/vad`](../vad/README.md). It contains no policy of its
own: no model cache, no default model path, no chunking, no timing.

## What it is

sherpa-onnx is an **inference runtime**, not a model. Each of its three engines is an
opaque handle created from a nested C struct of file paths and numbers, and the struct is
the part JavaScript cannot express: GJS has no way to lay out
`SherpaOnnxOnlineRecognizerConfig` or hand sherpa-onnx a `const float*`. That is this
package's entire job.

| ships | from |
|---|---|
| `libgjsifysherpa.so` + `libonnxruntime.so` + `GjsifySherpa-1.0.typelib`, per target, in `@gjsify/sherpa-native-<os>-<arch>` | this package's meson build |
| `loadNativeSherpa()` / `hasNativeSherpa()` / `getLoadError()` | `src/ts/index.ts` |
| generated `GjsifySherpa-1.0` types | `src/ts/gjsifysherpa-1.0.d.ts` — `npm run build:gir-types` |

**No model is bundled, ever** (ADR 0127 decision 14). Model licences differ from
sherpa-onnx's own Apache-2.0, several forbid redistribution, and the smallest useful one
is larger than this library. Every class takes its files from the caller.

Recognizers are **transducer-only** (encoder + decoder + joiner + tokens). Whisper is a
different model layout with a different config struct and belongs in a separate
`@gjsify/whisper-native`, not in a `model_type` switch here.

## The API

Three independent classes, each a GObject with construct properties and a separate
`open()`. Construction never touches the filesystem or allocates an engine; `open()` is
where paths are checked, the ~50 MB of model weights are mapped and onnxruntime builds its
session. So a caller can configure a detector, decide it is not needed, and drop it for
free — and a failure to open is an exception at one named point rather than inside a
constructor.

```js
import GjsifySherpa from 'gi://GjsifySherpa?version=1.0';

const vad = new GjsifySherpa.Vad({
    model: '/path/to/silero_vad.onnx',
    min_silence_duration: 0.3,    // seconds; also the default, per ADR 0127 decision 8
});
vad.open();

vad.accept(samples);              // float32, -1..1, any length
while (vad.has_segment()) {
    const [got, speech, start] = vad.next_segment();   // samples, and where they began
}
vad.close();
```

`accept()` takes **any chunk size**: `VoiceActivityDetectorAcceptWaveform` buffers
internally and runs the model whenever it has `window_size` (512) samples, so a caller
feeds it whatever its source produces and never pads.

`next_segment()` is the `read`/`pop` half of a `peek`/`read`/`pop` trio in the C shim:
`has_segment()` asks, `next_segment()` copies the samples out and advances. A segment is
the audio between a speech start and the silence that ended it — the detector reports
boundaries, never "turns"; whose turn it is is an application's question.

It returns a **boolean plus two out parameters** rather than a nullable array, and that is
a measurement rather than a preference: under gjs a NULL C array of length 0 arrives as an
empty `Array`, so a `float[]?` return collapses "nothing is queued" and "here is a segment"
into one value `=== null` cannot tell apart.

```js
const rec = new GjsifySherpa.OnlineRecognizer({
    encoder: enc, decoder: dec, joiner: join, tokens: tok,
});
rec.open();
const stream = rec.create_stream();
stream.accept(16000, samples);
while (stream.is_ready()) stream.decode();
const text = stream.get_text();        // also get_json() for timestamps + per-token data
if (stream.is_endpoint()) stream.reset();
stream.close();
```

`OfflineRecognizer` is the same shape for a whole utterance: `accept()`, `decode()`,
`get_text()`, with no `is_ready`/`is_endpoint`/`reset`.

### Lifetime

A stream holds a strong reference on its recognizer, so a recognizer cannot be finalised
under a live stream, and `recognizer.close()` closes its streams first — it keeps an
`unowned` list of them. That is the idiom
[`@gjsify/sqlite-native`](../../node/sqlite-native/src/vala/database.vala) established for
a handle that owns child handles; without it, a GC in the wrong order is a use-after-free
inside sherpa-onnx rather than an exception.

Every method used before `open()` or after `close()` throws `SherpaError.NOT_OPEN` — the
other two members are `MODEL_MISSING`, which names the file, and `OPEN_FAILED`, which is
sherpa-onnx refusing a configuration for a reason it only writes to stderr. `close()` is
idempotent and also runs from `dispose`, so forgetting it leaks nothing.

### From TypeScript

```ts
import { hasNativeSherpa, loadNativeSherpa } from '@gjsify/sherpa-native';

const sherpa = loadNativeSherpa();   // null when no prebuild for this platform
if (sherpa) {
    sherpa.version();                // '2.0.1'
    sherpa.onnxruntime_version();    // '1.28.2'
}
```

Loading is `loadOptionalNativeModule` from `@gjsify/utils/core`: absent is an answer, with
the cause in `getLoadError()`. It resolves through `imports.gi.*` rather than a static
`gi://` import on purpose — a static specifier is resolved during ESM linking, before
`GI_TYPELIB_PATH` is set, so the prebuild would be invisible to it.

## Building

```sh
gjsify workspace @gjsify/sherpa-native run build:prebuilds   # meson + stage-prebuild
gjsify workspace @gjsify/sherpa-native run test:meson
```

`meson setup` fetches the pinned sherpa-onnx checkout and CMake then fetches eigen,
kaldi-native-fbank, kaldi-decoder, kissfft, kaldifst, openfst, utf8proc,
simple-sentencepiece and nlohmann/json, so **the first configure needs network access**
even though every revision is pinned. It also wants the onnxruntime **shared** release zip
(~35 MB) — see the subproject bullet below for why shared; CMake caches it and will not
re-fetch.

`libstdc++.a` must be installed, because `libgjsifysherpa.so` is linked with
`-static-libstdc++`. Not because no libstdc++ may be in the process — `libonnxruntime.so`
beside it has its own DT_NEEDED on `libstdc++.so.6` — but to keep this library from adding
a **second, higher GLIBCXX floor** on top of the engine's. The engine is built by GCC 4.8
and asks for `GLIBCXX_3.4.19`; the same code compiled by Fedora 44's GCC 16 and linked
dynamically asks for `GLIBCXX_3.4.30`. The C++ that crosses between bridge and engine is
sherpa-onnx's use of onnxruntime's **C** API, so the two libstdc++ copies never meet an
object of each other's. **This does not need root** — the package can be unpacked into a
scratch directory and pointed at with `-B`:

```sh
dnf download libstdc++-static                       # works unprivileged
rpm2cpio libstdc++-static-*.rpm | (cd /tmp/stdcxxa && cpio -idm)
cc -B/tmp/stdcxxa/usr/lib/gcc/x86_64-redhat-linux/16/ -print-file-name=libstdc++.a
```

`meson.build` **probes** for the archive (`cc -print-file-name=libstdc++.a`, accepted only
as an absolute path that exists) rather than hardcoding one, warns when it is missing, and
only then passes `--require-static-libstdcxx` to the ELF test. Without the probe the
failure surfaces four dependencies deep, as simple-sentencepiece reporting "requires a
compiler supporting at least C++14 … upgrade GCC to at least version 7.0".

What `-static-libstdc++` does **not** buy is a low glibc floor — that is set by the build
image, for every prebuild in this repository alike. Measured here on Fedora 44:
`sqrtf@GLIBC_2.43` and `log10f@GLIBC_2.43` from the feature maths, plus
`__isoc23_strtoll@GLIBC_2.38`. glibc 2.43 re-versions those float-math symbols and the
linker binds the newest default version available, so building there raises the
requirement with no source change — which is exactly why `prebuilds.yml` pins
`fedora:43` and says so at length above its `container:`. The CI artifact therefore has a
lower floor than a local Fedora 44 build; do not read a local measurement as the shipped
one.

Five other things in `meson.build` are worth knowing:

- **sherpa-onnx is a CMake subproject** (`cmake.subproject()`), the pattern
  [`@gjsify/gamepad-native`](../gamepad-native/meson.build) uses for SDL3 — sherpa-onnx
  has no meson build. It is built with `BUILD_SHARED_LIBS=OFF`, and the target to link is
  `sherpa-onnx-c-api`.
- **onnxruntime is the one thing that is NOT static**, and this is the package's single
  most load-bearing measurement. The prebuilt `libonnxruntime.a` (GCC 4.8) and the
  host-GCC `libsherpa_onnx_core.a` both define the same 54 weak vague-linkage symbols —
  among them all nine members of `std::__detail::_Scanner<char>`, whose mangled name is
  stable across GCC versions while its layout is not, because libstdc++ puts
  `regex_traits` in `std::__cxx11` but `_Scanner` in plain `std::__detail`. The linker
  dedupes them, `DeviceDiscovery::GetPciBusId` then builds an old-layout `_Scanner` through
  a new-layout constructor, and the first `Vad.open()` dies in `free(): invalid pointer`.
  The fix is a `patch_directory` overlay on the wrap
  ([`subprojects/packagefiles/sherpa-onnx-shared-onnxruntime/`](subprojects/packagefiles/sherpa-onnx-shared-onnxruntime/cmake/onnxruntime-linux-x86_64-static.cmake))
  that swaps upstream's static x86_64 fetch file for upstream's own shared one, so
  `libonnxruntime.so` travels in the prebuild and is found through RUNPATH `$ORIGIN`. The
  overlay is **per architecture**: `meson.build` maps arch → overlay file and `error()`s on
  a linux arch it has no entry for, rather than falling back to the static file that
  crashes.
- **`sherpa_inc` must be declared after `cmake.subproject()`**, because that call is what
  materialises the checkout, and because sherpa-onnx sets its include path with a
  directory-scoped `include_directories()` that meson's cmake module cannot read off the
  target.
- **The C shim is its own `static_library`**, and both the shared library and the smoke
  test consume `shim.extract_all_objects(recursive: false)`. `extract_all_objects` on a
  target with Vala sources does not work: ninja has no rule for the Vala-generated `.c.o`
  outside the library target. The shared library takes the **objects**, not
  `link_whole` — an archive's symbols would be localised by `--exclude-libs,ALL`.
- **Symbols are hidden twice**: `-Wl,--exclude-libs,ALL` for the static archives, plus a
  version script (`src/c/gjsify-sherpa.map`) exporting one `gjsify_sherpa_*` glob that
  covers both the Vala API and the shim. Measured on the built artifact: 168 exported
  symbols, all `gjsify_sherpa_*`, and no onnxruntime symbol at all — so this file cannot
  collide with a host onnxruntime.

Measured DT_NEEDED on the static-libstdc++ build — **6 entries**: `libglib-2.0.so.0`,
`libgobject-2.0.so.0`, `libonnxruntime.so`, `libm.so.6`, `libmvec.so.1`, `libc.so.6`.
Nothing else: no libstdc++, no libgcc_s. RUNPATH is `$ORIGIN` and no RPATH, which is the
ADR 0017 prebuild layout, not an accident, and it is also the only thing that resolves the
deliberately unversioned `libonnxruntime.so` to the sibling rather than to a distribution's
`libonnxruntime.so.1`. `libmvec` is part of glibc and arrives through `-lm` with the feature
maths auto-vectorised; it is in `check-elf-deps.py`'s allow-list for that reason.

The engine's own surface is measured from the other side in the same test: `libonnxruntime.so`
exports exactly `OrtGetApiBase`, `OrtSessionOptionsAppendExecutionProvider_CPU` and the
version node `VERS_1.28.2`, and its GLIBCXX floor is 3.4.19 — asserted at ≤ 3.4.20 so that
a wrap bump to an archive from a newer toolchain reds the test instead of silently costing
the prebuild its portability.

The link uses `-Wl,--strip-all`, not the `--strip-debug` the sibling packages use. Measured
by relinking the same objects both ways: 5,113,824 bytes with `--strip-debug`,
**4,298,944 with `--strip-all`** — 0.8 MB of `.symtab` that is sherpa-onnx's complete static
symbol table and that nothing reads. `.dynsym` is untouched, so the ELF read-back still
measures the exports.

### The linux-x64 prebuild is built by CI, not committed

`gjsify.platforms` declares `linux-x64`, but `@gjsify/sherpa-native-linux-x64` carries
`gjsify.platformsUncommitted` and ships no `prebuilds/` directory in git — the
[`@gjsify/napi-linux-x64`](../../napi/napi-linux-x64/package.json) arrangement. The two
`.so` files are 29.9 MiB together — 4.1 MiB of bridge and 25.8 MiB of engine — against the
largest prebuild this repository commits at 12.8 MB (`rolldown-native-linux-x64`), and they
would be re-committed in full on every sherpa-onnx bump. `prebuilds.yml` builds them on its
own `sherpa-native-prebuild` job; a local `build:prebuilds` stages them into the child
package, where `.gitignore` keeps them out of a commit.

For the same reason `build:gir-types` reads `--girDirectories=build` — the meson build
directory — rather than the child's `prebuilds/linux-x64` as `sqlite-native` does. There
is no staged artifact to generate types from.

## Testing

```sh
gjsify workspace @gjsify/sherpa-native run test:meson
```

- `shim-smoke` — C, links the shim's objects directly and reports the two versions. It is
  the leg that fails first and most legibly when the subproject or the link breaks.
- `elf-deps` — reads DT_NEEDED, RUNPATH and the exported symbol table back off both built
  files (`test/check-elf-deps.py`), and asserts no dynamic libstdc++ in the bridge when the
  archive probe succeeded.
- `api-gjs` — imports `gi://GjsifySherpa?version=1.0` under `gjs` from the build directory
  and drives the detector and both recognizers: construct properties read back their
  defaults, a missing model is refused by path, a closed object throws. This is what
  proves the GIR, the typelib and the library agree.
- `vad-model-gjs` — the one leg that opens a real onnxruntime session, because opening a
  session was the only thing that ever saw the heap corruption the overlay fixes. It exits
  **77 (skip)** unless a Silero model is cached at
  `~/.cache/gjsify/speech-models/silero_vad_v5.onnx` or named by
  `GJSIFY_SHERPA_VAD_MODEL`, so it is a regression guard where a model exists and silent
  where one does not.

**Nothing in the suite downloads a model.** What that costs in coverage, stated plainly:
the detector is exercised against real weights wherever a model is cached, and has been
run by hand on Fedora 44 / x86_64 / GCC 16 against two 16 kHz recordings (one segment
each, boundaries within a chunk of the audible ones). **The two recognizers have not been
run against real weights at all** — they are compiled, their construct properties, path
refusal and lifecycle are tested, and that is the whole of it. Transducer weights are
~250 MB and a download does not belong in `meson test`; the gap closes when the scheduled
model job of ADR 0127 exists.

**No test ever produces audible sound or opens a microphone** (ADR 0127). Audio in is a
`float[]` or a WAV fixture; there is no output path in this package at all.

## Updating sherpa-onnx

`subprojects/sherpa-onnx.wrap` pins the tag `v2.0.1` with `depth = 1`, which resolves to
commit `af2d8d81dbfa61c4cea4c568da78f3982edca005`. A shallow clone can fetch a tag; move
off `depth = 1` if the pin ever has to become a non-tip commit.

To update: change the `revision`, **re-check the overlay against the new upstream
`cmake/onnxruntime-linux-x86_64-shared.cmake`** (its header file says what to diff and
why), `rm -rf subprojects/sherpa-onnx` so meson re-applies the patch to a fresh checkout —
it only patches a checkout it created itself — then rebuild, run the tests, and re-measure
the numbers in this file: exported symbols, DT_NEEDED, the engine's floor and the stripped
file sizes. Only GLib/GObject, `libonnxruntime.so`, libm/libmvec and libc may appear, and
no exported symbol outside `gjsify_sherpa_*`. The onnxruntime version moves with
sherpa-onnx's own `cmake/onnxruntime.cmake`, which also means the `VERS_` node asserted in
`check-elf-deps.py` moves; `shim-smoke` prints what it actually got.

The C shim is the whole surface that knows sherpa-onnx's structs
(`src/c/gjsify-sherpa-shim.h`); the VAPI below it binds nothing but scalars, strings and
opaque pointers. A struct that changes upstream therefore breaks one file, with a C
compiler error, instead of silently mis-reading memory through a hand-written VAPI.

## License

This package is MIT.

The **prebuilt libraries** in `@gjsify/sherpa-native-linux-x64` are `MIT AND Apache-2.0`:
`libgjsifysherpa.so` has sherpa-onnx (© the k2-fsa authors, Apache-2.0) linked in
statically, and `libonnxruntime.so` beside it is a verbatim copy of Microsoft's
onnxruntime (MIT) as redistributed by the
[onnxruntime-libs](https://github.com/csukuangfj/onnxruntime-libs) release the overlay
pins. The pinned revision in `subprojects/sherpa-onnx.wrap` is the corresponding source. Model weights are **not** covered — they are never shipped, and each
carries its own licence from whoever trained it. See
[`docs/attribution.md`](../../../docs/attribution.md).
