# `@gjsify/integration-nativescript-gi` — the GI runtime on a real device

The measurement of **ADR 0105 stage 4**: an Android app that gets the whole
GObject-Introspection runtime from **one dependency** — `@gjsify/gi-runtime-android` —
opts the real-Gio GObject engine in at app level, and runs
`@gjsify/adwaita-core`'s conformance vectors against it on the device.

No hand-copied `libnode_gi.so`, no `App_Resources/Android/jniLibs`, no typelib
configuration. If the claim behind the plugin is true, adding it to `dependencies`
and calling `useRealGObjectEngine(requireGi)` is the entire integration, and that
is what this suite is here to find out.

## The two runs

```sh
npm install                                 # the @gjsify/* deps are file: paths — see .npmrc
npm run test:android                        # SUBJECT: the app opts in → engine 'real-gio'
npm run test:android:pure-js                # CONTROL: same APK payload, opt-in define off
npm run size:android                        # what the plugin costs the APK, from one build
```

`ANDROID_SERIAL=<serial>` picks the device when several are attached (adb's own
variable). `node scripts/run-on-device.mjs --keep` leaves the app installed; by
default it is uninstalled again, because a device this runs on is usually shared.

The two runs differ in **one value**: the build-time define `__GJSIFY_GI_OPT_IN__`
(`vite.config.ts`). Same sources, same plugin dependency, same `lib/<abi>/*.so` and
same `assets/app/girepository-1.0/*.typelib` in the APK. So what they compare is the
app's *decision*, not the presence of the payload — which is the point of an
explicit opt-in: pure JS stays the default even when the bytes are right there.

## What is asserted

| spec | subject |
|---|---|
| `app/specs/loader.probe.ts` | which link of node-gi's native-require chain fires under Vite's ESM output, and that `requireGi('GLib','2.0')` reaches the addon |
| `app/specs/engine.ts` | `gobjectEngineName()` **and** `@gjsify/adwaita-nativescript/gobject`'s `engineName` report the expected engine; a second opt-in is refused, not silently honoured |
| `app/specs/gobject.vectors.ts` | `GOBJECT_VECTORS` against `createSubsetSubject(registeredEngine())` — the engine the app really got |
| `app/specs/list-store.ts` | `LIST_ITEMS_CHANGED_VECTORS` through a real `Gio.ListStore`, with item identity counted off the live model |
| `app/specs/settings.ts` | `SETTINGS_VECTORS` through real `Gio.Settings` (memory backend); the schema is compiled on the host by `scripts/compile-schemas.mjs` and travels as base64 |
| `app/specs/file-chooser.ts` | `FILE_CHOOSER_VECTORS` through real `Gio.File` with a Gtk stand-in (the payload has no Gtk typelib) |

The GObject subject is **imported, not re-made**: `createSubsetSubject` ships from
`@gjsify/adwaita-gobject-native`, and `engine.node-gi.spec.ts` drives the same door
on the CI host. The two legs differ only in where `requireGi` comes from, which is
the plugin's claim — it adds a payload, not a dialect. A second copy of that door is
how the claim would quietly stop being true.

The payload specs run **only in the opted-in run**: calling `requireGi` in the
control run would load `libnode_gi.so` anyway and the comparison would stop being
a pure-JS one.

## A failed opt-in is a failed case, not a crash

`useRealGObjectEngine` throws when real GObject is unreachable — it never falls back.
`app/opt-in.ts` records that error instead of rethrowing, and `app/app.ts` reports it
as **one** failed case and runs no vectors. Both halves are deliberate: a throw out of
the opt-in module kills the module graph, so the run produces no markers at all and the
message naming the missing ABI or typelib stays buried in logcat; ignoring it would let
the pure-JS engine back the subset and every vector would PASS, reporting a successful
real-GObject measurement that never happened.

## Import order is load-bearing

`app/app.ts` imports `./opt-in.js` **first**, above `@nativescript/core` and above every
spec. The core's engine slot freezes on its first read, and
`@gjsify/adwaita-nativescript/gobject` reads it in its module body. Move that line down
and the port builds on the default engine, the opt-in throws "registered too late", and
the run reports `pure-js` from an APK that carries the whole payload. There is no way to
make this the framework's problem — component modules call `registerClass` at module
load, so a lazily resolved engine would already be too late.

## Why a custom reporter and a duplicated runner

Same reasons as `tests/integration/nativescript/`: `@gjsify/unit`'s `run()` calls
`process.exit()` (absent on NS V8, silently swallowed), does not export its counters,
and would drag GJS-aware paths into the bundle. The reporter here adds one marker over
that suite's — `INFO <suite> :: <text>` — for facts the device is the only witness to:
which loader link fired, which ABI loaded, what GLib answered. They tally nothing; a run
that reports "18/18 passed" and nothing else cannot answer "on what", and that question
is most of stage 4.

The runner is this suite's own, following the in-repo precedent that each device harness
owns one (the NS showcases do the same). It needs different steps — a payload-present
check, the `dependencies.json` plugin assertion, two parameterised runs — and a shared
runner would grow a flag per suite.

## Not wired into CI, excluded from the workspace

It needs the NS CLI, an adb device, and a payload that can only be built on a machine
with an Android GI prefix (`packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs`;
`status/pending-npm-bootstrap.json` records that step). So, like
`tests/integration/autobahn/`, it is excluded from the root `workspaces` array and run by
hand. `npm install` here is a separate install tree, and the `@gjsify/*` dependencies are
`file:` paths into this checkout with `install-links=false` so they stay **symlinks**: the
suite exists to measure *this worktree*, and a copy taken at install time would keep
reporting results for bytes nobody can point at any more.

## The device the numbers in the report came from

Samsung Galaxy S9 (`starlte`, arm64-v8a, Android 10 / API 29), plus the universal APK's
x86_64 half for the emulator. The APK is built with `abiFilters "arm64-v8a", "x86_64"` —
exactly the two ABIs the plugin carries.
