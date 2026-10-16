# @gjsify/gi-runtime-android

A **NativeScript plugin** that puts the GObject-Introspection runtime into an Android
APK: [`@gjsify/node-gi`](../node-gi)'s `libnode_gi.so`, the GLib / GObject / Gio
closure it links against, and their typelibs — for `arm64-v8a` and `x86_64`.

Add it as a dependency and `requireGi` works on the device. No `jniLibs` directory in
`App_Resources`, no hand-copied `.so`, no typelib path to configure.

```jsonc
// package.json of a NativeScript app
"dependencies": {
    "@gjsify/gi-runtime-android": "^0.60.0"
}
```

> **Published by CI, built from a hand-built sysroot.** `release.yml`'s
> `publish-gi-runtime-android` job cross-builds `libnode_gi.so`, builds the AAR and publishes
> it on every release that touches node-gi ([§ Releasing](#releasing), #2187). Only the GI
> prefix it is built from (the sysroot, [gjsify/android-sysroot](https://github.com/gjsify/android-sysroot))
> is still built by hand.

Tier 3 (experimental). Stage 4 of
[ADR 0105](../../../docs/adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md).

## Why an AAR, and not `prebuilds/`

Nothing on Android resolves a `.node` file or a `node_modules` path at runtime. The
APK's `lib/<abi>/` is the only place `dlopen` looks without an absolute path, and only
the Android build system puts anything there. So the packaging envelope IS the delivery
mechanism: NativeScript's gradle scans every dependency's `platforms/android` for
`**/*.aar` and adds each hit as an `implementation` dependency, after which AGP merges
the AAR's `jni/<abi>/` into the APK's native libraries and its `assets/**` into the app
assets.

That is also why this is a package of its own rather than a directory inside
`@gjsify/node-gi`. npm has no per-platform file filtering: a `platforms/android/` inside
node-gi would make **every** transitive Node consumer a NativeScript plugin and put a
33 MB AAR in every `npm install`. node-gi stays installable with zero Android bytes.

**One package, both ABIs** — not two per-ABI packages. A universal APK and gradle's
`abiFilters` both work from one AAR, and the app author adds one dependency.

**The addon travels WITH the GI stack.** `libnode_gi.so` names its GI libraries in
`DT_NEEDED`, so the loader resolves them before a line of JavaScript runs: an addon
built against one GLib and shipped beside another is a startup crash, not a version
warning. One artifact, one linked unit, one `sha256` per file in `gi-runtime.json`.

## Layout

```
platforms/
  THIRD-PARTY-NOTICES.md             generated; what the AAR carries, per project
  android/
    include.gradle                   COMMITTED — fails the app's build if the AAR is absent
    gi-runtime-android.aar           the payload (gitignored, built)
    gi-runtime.json                  what went in: sizes, sha256, the closure, the typelib set
```

Inside the AAR:

```
AndroidManifest.xml                  package + minSdkVersion 24; nothing else
classes.jar                          empty — AGP expects the entry to exist
jni/<abi>/libnode_gi.so              the node-gi addon
jni/<abi>/*.so                       the measured GI closure (14 libraries)
assets/app/girepository-1.0/*.typelib
```

The typelib path is not a choice: NativeScript extracts the APK's `assets/app/**` to
`<filesDir>/app`, which makes that directory `<filesDir>/app/girepository-1.0` on the
device — exactly `host.nativescript.js`'s default for `__NODE_GI_TYPELIB_PATH`. The two
agree on purpose, so an app installing this plugin configures no paths.

## The payload is built, never committed

Same arrangement as the `@gjsify/gtk-runtime-*` bundles' `gtk/`. A fresh checkout has no
AAR, which is what `include.gradle` is committed for: it turns the absence into a gradle
failure that names the build command, instead of an APK that dies in `dlopen` at startup.

The inputs are pinned by sha256 in [`build-inputs.json`](./build-inputs.json): the GLib /
GObject-Introspection prefix, released per ABI in
[gjsify/android-sysroot](https://github.com/gjsify/android-sysroot), and the `optimized`
runtime AAR of the published `@nativescript/android`. Besides them the build needs only the
pinned NDK.

```sh
NDK=~/Android/Sdk/ndk/27.1.12297006
IN=/tmp/gi-runtime-android-inputs

# 0. the pinned inputs: $IN/sysroot and $IN/nativescript
node scripts/fetch-build-inputs.mjs --out "$IN"

# 1. the addon, per ABI — @gjsify/node-gi's own cross-build, needing node-addon-api
(cd ../node-gi && npm install --no-audit --no-fund --ignore-scripts)
for abi in arm64-v8a x86_64; do
  node ../node-gi/scripts/build-android.mjs --abi "$abi" --ndk "$NDK" \
      --gi-sysroot "$IN/sysroot" --napi-lib "$IN/nativescript" --out /tmp/gi-android/"$abi"
done

# 2. the bundle
node scripts/build-gi-runtime-android.mjs --ndk "$NDK" --gi-sysroot "$IN/sysroot" \
    --node-gi-lib /tmp/gi-android --license-corpus "$IN/sysroot/share/licenses"
```

The prefix is not built in CI because g-ir-scanner has to *run* a dumper compiled for the
target, which needs an emulator or a device. android-sysroot's README holds that recipe;
a new prefix is a new release there plus a bump of the tag and both digests here.

`--typelib-dir <abi>=<dir>` (repeatable) points at typelibs outside
`<gi-sysroot>/lib/<abi>/girepository-1.0`, for a GI build tree that is not installed.

## Releasing

`release.yml`'s `publish-gi-runtime-android` job runs the three steps above on
`ubuntu-latest` and publishes through the Trusted Publisher, like every other runtime
bundle. Its bytes depend on the pinned inputs and the node-gi sources, not on the
version: built from the 2026.10.12 prefix, the AAR is byte-identical to the 0.62.0 one
that was published by hand (sha256 `ada5b59b…`); only `THIRD-PARTY-NOTICES.md` beside it
gained the licence texts.

## What the build decides, and refuses

**The closure is measured, never listed.** The library set is the transitive `DT_NEEDED`
walk from `libnode_gi.so` through the GI prefix, so a dependency added upstream arrives
on its own and one dropped upstream leaves. A hand-written list drifts into either a
missing library (a crash on the device) or a dead one (megabytes in every APK), and both
are invisible in a checkout. Anything the walk cannot resolve inside the prefix must be
provided by **Android** or **NativeScript** — `SYSTEM_PROVIDED` says which, by name, and
a fourth answer fails the build.

Measured against the prefix above: **14 bundled** libraries, **7 system-provided**
(`libc`, `libm`, `libdl`, `liblog`, `libandroid`, `libz`, `libNativeScript`).

**The typelib set follows the closure.** The prefix offers 21 typelibs; the libraries
behind 14 of them are not in the closure (GTK, Pango, HarfBuzz, graphene, libadwaita),
so they are dropped. Shipping `Gtk-4.0.typelib` anyway would let `requireGi('Gtk')` find
a typelib, resolve against a `libgtk-4.so` that is not in the APK, and die in
`g_module_open` — a runtime failure that looks like a node-gi bug and is really a build
that copied a directory. The gate is `planTypelibSet` from
[`../scripts/typelib-backers.mjs`](../scripts/typelib-backers.mjs), the same one the
darwin and win32 bundles use; its `blocked` case fails the build when an unbacked typelib
*cannot* be dropped because a shipped namespace depends on it. **7 typelibs ship**: GLib,
GObject, Gio, GioUnix, GLibUnix, GModule, GIRepository.

**The typelibs are checked for ABI-neutrality.** An AAR has one `assets/` tree and no
per-ABI variant of it, so they come from one declared source ABI and are used by all of
them — sound only while they are neutral, and `.typelib` blobs are not neutral in
general, because they record struct sizes and field offsets. Every typelib is therefore
compared across every requested ABI, and an **undeclared** divergence fails the build.
Measured here: 6 of the 7 are byte-identical across `arm64-v8a` and `x86_64`; the
seventh and its consequence are recorded in
[`typelib-abi-divergence.json`](./typelib-abi-divergence.json).

**Every bundled library is attributed.** [`licenses/bundled-projects.json`](./licenses/bundled-projects.json)
maps soname → project; a soname the closure grew with no entry fails the notice
generation rather than shipping unattributed. The table is a NAME MAP and states no
terms; the terms are the licence texts android-sysroot copies from every subproject's
source tree into `share/licenses/`, which `--license-corpus` embeds in the notice. A build
without a corpus (a bare meson build tree ships none) names each project and its upstream
and says plainly that the text is not embedded — an unspecific true claim instead of an
SPDX expression written from recollection, which is what `bundled-license` refuses on
win32 for the same reason.

## Size

| | `arm64-v8a` | `x86_64` |
|---|---|---|
| stripped native libraries | 15.5 MB | 16.7 MB |

`llvm-strip --strip-unneeded` — not `--strip-all`, which on a shared library removes the
dynamic symbols the loader resolves through. The AAR stores uncompressed (33 MB for both
ABIs); AGP recompresses into the APK, so the AAR's own size is not the APK's. An
`abiFilters` build carries one column.

About **8 MB of each column is cairo's** — `libcairo`, `libcairo-gobject`, `libpixman-1`,
`libfreetype`, `libfontconfig`, `libpng16`, `libxml2`, pulled in because `libnode_gi.so`
links cairo for its canvas support. An app using only GObject and Gio pays for it. A
node-gi build without cairo would halve the payload and is not in scope here.

## API

The payload is consumed by **gradle**, not by JavaScript — nothing has to import this
package for the plugin to work. `index.js` is the host-side view for a build script, a
device harness or a report that wants to know whether the payload is present and what is
in it:

```js
import { isPresent, aarPath, deviceTypelibSubdir, readRuntimeManifest } from '@gjsify/gi-runtime-android';
```

`readRuntimeManifest()` returns `gi-runtime.json` — the ABIs, the GI prefix the payload
was built from, every library and typelib with its size and `sha256`, and the AAR's own
digest — or `null` when the payload was never built.
