# @gjsify/spiel-native

[libspiel](https://github.com/project-spiel/libspiel), the GNOME **Spiel**
speech-synthesis client library, built as one relocatable shared library plus its
GObject-Introspection typelib — so `gi://Spiel?version=1.0` can be imported on a host
that has no libspiel installed.

This is the backend of [`@gjsify/speech-synthesis`](../speech-synthesis/README.md). It
contains no speech API of its own.

## What it is

Spiel is a **D-Bus protocol**, not an engine. A client discovers *speech providers* by
their well-known names on the session bus, asks them to synthesise, and plays the audio
they stream back through GStreamer. libspiel is the client half; the voices live in
separate processes (`ai.piper.Speech.Provider`, `org.espeak.Speech.Provider`, …).

| ships | from |
|---|---|
| `libspiel-1.0.so` + `Spiel-1.0.typelib`, per target, in `@gjsify/spiel-native-<os>-<arch>` | this package's meson build |
| `probeSpiel()` / `requireSpiel()` | `src/ts/index.ts` |
| hand-written `Spiel-1.0` types | `src/ts/namespace.ts` — there is no `@girs/spiel-1.0` on npm |

Linux only, and that is not a gap to fill later: macOS and Windows have no session bus
and no provider implementation, so a prebuild there would load and then find nothing,
permanently.

## The API

```ts
import { probeSpiel, requireSpiel } from '@gjsify/spiel-native';

const probe = probeSpiel();
// probe.source     'system' | 'prebuild' | 'absent'
// probe.module     the Spiel namespace, or null exactly when absent
// probe.typelibDir where the typelib was loaded from, or null
// probe.reason     one sentence naming what is missing, or null
// probe.error      the underlying Error, for a caller that logs a cause
```

`probeSpiel()` is memoised and **never throws** — absent is an answer, not a fault, and a
caller deciding how to degrade should not have to guard the question. `requireSpiel()` is
the same answer as a namespace or a throw whose `cause` is `probe.error`.

It is a capability query, in the shape `hasGamepadBackend()` established: it says the
namespace is usable, not that this host has a voice. It deliberately does **not**
construct a `Spiel.Speaker`, which would open the session bus and D-Bus-activate every
installed provider.

### A system libspiel wins

A host libspiel takes precedence over the prebuild: it is the distribution's, it is the
build every installed provider was made against, and it gets security updates we do not
ship.

That needs work, because it is the opposite of the default. Every mechanism that
registers an ADR 0017 prebuild **prepends** it — `activateNativePrebuilds()`, the
`--app gjs` bundle prologue, and the `gjsify` launcher's `GI_TYPELIB_PATH`. All three are
right for a bridge whose library exists nowhere else (ADR 0023); for a library the host
may genuinely have, the precedence is backwards. So `probeSpiel()` prepends the system
directory *again*, after them, and therefore ahead of them.

"The system directory" is measured, not guessed: it is the directory the running process
loaded `GLib-2.0.typelib` from (`Repository.get_typelib_path('GLib')`). GJS has GLib
loaded before any of our code runs and its typelib is never a prebuild, so that is the
host's own `girepository-1.0` — with no table of `/usr/lib64`-shaped candidates to keep
current per architecture and distribution. The prepend is conditional on
`Spiel-1.0.typelib` actually being in it, so the search path of every other namespace in
the process is left alone.

## Provider discovery, and Flatpak

From `spiel-registry.c`: libspiel calls `ListActivatableNames` and then `ListNames` on the
session bus, keeps every name ending in `.Speech.Provider` (`PROVIDER_SUFFIX`), and
subscribes to `ActivatableServicesChanged` + `NameOwnerChanged` to stay current. There is
no central registry and no GSettings requirement — libspiel installs
`org.monotonous.libspiel` but works without it.

**A Flatpak app therefore needs an explicit D-Bus permission, or it sees zero voices.**
Measured on Fedora 44 against a sandboxed app (`gdbus` inside `app.devsuite.Ptyxis`), with
two providers running on the host:

| finish args | `*.Speech.Provider` visible |
|---|---|
| *(default sandbox, no talk-name)* | **none** — in neither `ListActivatableNames` nor `ListNames` |
| `--talk-name=ai.piper.Speech.Provider` | yes, that one |
| `--talk-name=ai.piper.*` | yes |
| `--socket=session-bus` | yes, everything (and that is the point — it is full bus access) |
| `--talk-name=*.Speech.Provider` | rejected: `error: Invalid dbus name` |
| `--talk-name=ai.*.Speech.Provider` | rejected: `error: Invalid dbus name` |
| `--talk-name=ai.*` / `org.*` / `*` | rejected: `error: Invalid dbus name` |

Flatpak's name matching is **prefix-only**. There is no pattern that means "any provider",
because the `.Speech.Provider` suffix is the discriminator and a suffix wildcard is not
expressible. So an app ships either one `--talk-name` per provider it supports, or
`--socket=session-bus`. No Flatpak template in this repository has been changed for Spiel;
an app that wants speech makes that trade itself, with this table to make it with.

## No audible output in tests

`Spiel.Speaker` has a `sink` property (a `GstElement`) which replaces the autoaudiosink.
Point it at a `fakesink` or a `filesink` and synthesis runs end to end in silence.

The GIR marks `Speaker:sink` `introspectable="0"`, so the property **accessor silently
does nothing**:

```js
speaker.sink = fakesink;                 // no-op, no warning
speaker.set_property('sink', fakesink);  // works
```

(Related GJS trap met while measuring this: `GObject.type_class_ref(gtype)` returns a boxed
`TypeClass` with no `find_property` — use the class-level `Spiel.Speaker.find_property()`
/ `list_properties()`. And `Provider:well-known-name` is deprecated since 1.0.4; read
`provider.identifier`.)

## Building

```sh
gjsify workspace @gjsify/spiel-native run build:prebuilds   # meson + stage-prebuild
```

`meson setup` clones the two pinned upstream checkouts, so the first setup needs network
access. Three things in `meson.build` are worth knowing:

- **libspeechprovider is linked statically** (`default_library=static`,
  `introspection=false`). It is libspiel's own dependency; vendoring it as a second shared
  object would mean a second typelib and an `$ORIGIN` RUNPATH to find it. One file ships.
- **libspeechprovider is pinned in OUR top-level `subprojects/`**, not left to libspiel's
  own wrap, because libspiel resolves its interface XML through
  `meson.global_source_root() / 'subprojects' / 'libspeechprovider'` — from *our* root.
- **Symbols are hidden with a version script**, applied with
  `add_global_link_arguments('-Wl,--version-script=…')` before `subproject()`, so it covers
  the subproject's objects too. Measured on the built artifact: 89 exported symbols, all
  `spiel_*`, none else.

The versioned SONAME is handled without patching upstream: `cp -L` to a plain
`libspiel-1.0.so`, rewrite the `.gir`'s `shared-library`, recompile the typelib with
`--shared-library libspiel-1.0.so`. The ELF SONAME stays `libspiel-1.0.so.1`, which is
harmless — nothing links against this file, it is `dlopen`ed by name.

Measured DT_NEEDED: `libgio-2.0`, `libgobject-2.0`, `libglib-2.0`, `libgstreamer-1.0`,
`libgstaudio-1.0`, `libgstbase-1.0`, `libc`. No RUNPATH, no RPATH.

**arm64 is built by CI only** (`prebuilds.yml`, the `ubuntu-24.04-arm` leg).

## Testing

```sh
gjsify workspace @gjsify/spiel-native run test:meson
```

- `elf-deps` — reads DT_NEEDED, RUNPATH and the exported symbol table back off the built
  file (`test/check-elf-deps.py`).
- `load-typelib-gjs` — imports `gi://Spiel?version=1.0` under `gjs` from the build
  directory and touches the classes, which is what proves the rewritten GIR and the
  recompiled typelib agree with the library.
- `speak-fakesink-gjs` — the end-to-end one, **opt-in**: it needs a session bus with real
  providers, so it exits 77 (skip) unless `GJSIFY_SPIEL_LIVE=1`. With it set, measured on
  Fedora 44: 2 providers, 5 voices, `utterance-started` → `utterance-finished` into a
  `fakesink`. Silent by construction.

## Updating libspiel

Both wraps pin a **commit**, not a tag, and `subprojects/libspiel.wrap` carries no
`depth=1` — a shallow clone cannot fetch a non-tip revision.

The pin is a commit on purpose: the newest upstream tag is `SPIEL_1_0_4` (2025-04-03),
which predates the subproject-tracking fix this build needs under meson < 1.14, and
upstream's own `meson.build` already reads 1.0.5 with no tag cut. Move to a tag as soon as
one exists at or past the pinned commit.

To update: change the `revision` in `subprojects/libspiel.wrap` (and
`libspeechprovider.wrap` if its 1.0.x moves), rebuild, run the tests, and re-measure the
two numbers above — exported symbols and DT_NEEDED. Only GLib/GObject/Gio, GStreamer and
libc may appear.

## License

This package is MIT.

The **prebuilt library** in `@gjsify/spiel-native-linux-x64` /
`-linux-arm64` is `MIT AND LGPL-2.1-or-later`: it contains libspiel and, statically
linked, libspeechprovider — both © the Spiel contributors, both LGPL-2.1-or-later. The
pinned commits in `subprojects/*.wrap` are the corresponding source those packages'
recipients are entitled to, and the shared library is relinkable against a modified
libspiel by replacing the file. See [`docs/attribution.md`](../../../docs/attribution.md).
