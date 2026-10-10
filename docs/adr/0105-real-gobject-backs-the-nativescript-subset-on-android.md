# 105. Real GObject can back the NativeScript subset on Android, and is its oracle there

- Status: **Proposed**
- Date: 2026-10-10
- Deciders: Pascal Garber
- Related: [ADR 0003](0003-package-tiering.md) (new packages start at tier 3),
  [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) (the GObject subset and
  its oracle), [ADR 0098](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md),
  [ADR 0099](0099-gio-settings-runs-on-the-browser-and-nativescript.md) (`backend`),
  [ADR 0100](0100-file-dialog-and-gio-file-run-on-the-browser-and-nativescript.md),
  [ADR 0104](0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
  (track B, whose stage 4 this builds on)

## Context

ADR 0096 to 0100 re-create a GObject, Application, Settings and file subset in pure JavaScript for
the browser and NativeScript. The browser has no GObject, so that is the only way there. On
NativeScript Android it no longer is: ADR 0104 track B runs real libgobject, libgio and
libgirepository inside a stock NativeScript 9.1 app through node-gi (stage 4: the ALooper pump,
both ABIs build uv-free, probe cases pass on an `x86_64` emulator).

**Read from the sources** (`packages/web/adwaita-core`, `packages/nativescript-bridge/adwaita`):

- The subset's behaviour lives once, in `@gjsify/adwaita-core` (`gobject.ts`, 1036 lines): the
  per-instance property store, the signal registry, `bindProperties`, `constructRegistered`.
  `createGObject(door)` wraps it; the NativeScript port's `src/namespace/gobject.ts` supplies the
  door. A NativeScript widget is a `@nativescript/core` `View`.
- **The only seam today is `GObjectDoor`, and it sits on the wrong side for this ADR.** It abstracts
  the widget model (`dispatch`, `listen`, `createFromTree`, `attach`, `register`). The engine under
  it (`GObjectObject`, `connectInstance`, `notifyInstance`, `bindProperties`) is imported by name,
  so nothing can replace it.
- `Gio.Settings` already has a `backend` seam (ADR 0099 § 7). `Gio.File` and `Application` have
  per-port implementations (ADR 0098, 0100) and no engine seam.
- **The oracle exists, on desktop.** `gobject.gjs.spec.ts` runs the shared `GOBJECT_VECTORS`
  (`conformance/gobject.ts`, 668 lines) against real `gi://GObject` under GJS. The driver takes a
  `GObjectSubject` holding a `GObjectNamespace`. A subject built from node-gi's GObject is another
  value of the same type.

**Measured** (copies under `~/.cache`, `llvm-strip --strip-unneeded`, NDK 27.1.12297006; the repo
is untouched):

| Stripped | `arm64-v8a` | `x86_64` |
|---|---|---|
| glib, gobject, gio, gmodule, girepository, ffi, intl | 6 249 400 B | 6 112 080 B |
| `libnode_gi.so` | 851 416 B | 855 480 B |
| total | 7.10 MB | 6.97 MB |

Of the core, gio is 2.71 MB and glib 2.63 MB. Typelibs, one set for both ABIs: GLib 230 588 B,
GObject 66 424 B, Gio 362 032 B, together 659 044 B (GModule, GioUnix and GLibUnix add 18 216 B).
Compressed APK delta: not measured. The stage 3 probe app was 57 MB (`x86_64`) with all of it.

**Startup, stage 3, `x86_64` emulator:** `require` of `libnode_gi.so` 3.6 ms; first
`requireNamespace` of GLib, GObject and Gio 0.09, 0.04 and 0.06 ms; cold start of the whole app
1008 ms, PSS 122 MB. The delta against an app without node-gi is not measured.

## Decision

### 1. The subset API stays the contract

`GObjectNamespace`, the `GOBJECT_VECTORS` and the other conformance vectors define what an
Adwaita author may rely on. The pure-JS implementation stays the default on every target and the
only one in the browser. A feature enters the contract by ADR 0096 § 2's rule (the gap report plus
a vector), never because the real backend happens to have it.

### 2. An opt-in real backend on NativeScript Android

Behind one switch (a build flag and a runtime import, both off by default) the contract is
implemented on node-gi: properties and `notify`, signals, `bind_property`, `GListModel`, real
`Gio.Settings` (GSettings schemas compiled, a `dconf`-less memory or keyfile backend), real
`Gio.File`. The pure-JS package stays loadable without it; a consumer that does not opt in ships
none of the native bytes above.

**The seam this needs is a second one: an engine, below the door.** `createGObject(door, engine)`
with `engine` defaulting to today's pure-JS functions. The engine owns instance state, signal
connect/emit, notify, binding and class registration. The door keeps owning widgets.

**The twin is a bridge; a real subclass is the goal.** A NativeScript widget is a `View`, and a
class has one prototype chain: today it cannot also extend `GObject.Object`. Until it can, the
real backend gives each registered instance a GObject twin (a `GObject.registerClass` object
holding its properties and signals), and the widget delegates to it. The twin is what
`bind_property` and `GListModel` consumers see. Whether the twin holds for GtkBuilder-like
construction order (ADR 0096 § 3 step 4) is stage 1's question.

The twin's surface is chosen so that replacing it by a real subclass changes no consumer: they
reach properties and signals only through the engine interface, never through the twin object.
Two routes lead there, neither decided here: invert the ownership (the widget is a GObject
subclass that owns its `View`, if NativeScript's layout accepts a non-`View` wrapper), or C′,
where the widgets are real GTK subclasses by construction.

### 3. Real GObject is the oracle on the device

The conformance vectors gain a third subject beside GJS and the pure-JS subset: node-gi's
GObject, run on an Android emulator or device. A vector that fails on node-gi but holds on GJS is
a node-gi bug (fixed at the core, in `packages/node-gi`). A vector that holds on the real
GObject but fails on the subset is a divergence of the re-creation, and it fails a test instead
of reaching a consumer. The same suite then runs against the pure-JS subset on the same device,
so both subjects share one environment.

### 4. Staging relative to ADR 0104

B (done) → B′ (this ADR) → C′ (GTK rendering hosted on a NativeScript worker, spike in
progress) → A (GJS port). B′ reuses B's node-gi build and typelibs unchanged; C′ adds the GTK
typelibs and a render host; A reuses the GI stack but not the JS host. B′ needs no GTK.

### 5. Threading

JavaScript and GObject share the UI thread. Stage 4 measured that: an async Gio call completes
with no explicit pump, and a 50 ms `timeout_add` armed after startup fired after 50.4 ms. Limits
that bind this ADR: a blocking `GLib.MainLoop.run()` is unsupported (it starves the looper that
feeds the pump), and the thread-safe function's `ref`/`unref` are no-ops, so GObject work does
not keep the process alive. A GObject emitting from another thread is not covered.

### 6. iOS

The pure-JS subset remains the iOS path. The NativeScript Android docs state that the Node-API
surface is shared byte-for-byte with the iOS runtime, so node-gi's source is plausibly loadable
there. Nothing else is known: no GLib or girepository cross-build for iOS was attempted, and
loading unsigned dylibs on iOS is not reasoned here. Open.

### 7. Declarations: no new slots

`runtimes.nativescript` and `nativescriptPlatforms` of `@gjsify/adwaita-nativescript` stay as
they are (`native`; `android`, `ios`); the real backend is not a new runtime. The engine and the
node-gi subject live in a new package, tier 3 by ADR 0003, with `nativescriptPlatforms:
["android"]`. `android-arm64`/`android-x64` enter `gjsify.platforms` of node-gi only when ADR 0104
stage 4 ships a loadable prebuild.

## Consequences

- Android apps that opt in get real GObject semantics for what they use, at about 7 MB of stripped
  native code plus 0.66 MB of typelibs per ABI.
- The pure-JS subset gets a stricter check than GJS gives it on desktop: the same vectors, on the
  platform where it is shipped.
- adwaita-core grows an engine interface; the pure-JS engine is today's code behind it, not a
  rewrite.
- Two code paths per consumer-visible behaviour on Android. The oracle runs keep them equal.

## Alternatives rejected

- **Make real GObject the Android default.** Costs the bytes above for every app, and leaves the
  browser and iOS on a different implementation than Android with no check between them.
- **Drop the pure-JS subset.** The browser has no GObject. It is also the iOS path.
- **Use GObject only as a test oracle, never as a backend.** Cheap, and stage 0 below delivers it,
  but a backend is what lets a consumer use `GListModel` or a real `Gio.Settings` today.
- **Make widgets GObject subclasses directly, now.** One prototype chain; see § 2. Deferred, not
  dropped: the twin keeps that door open.

## What this does not decide

- The engine's exact type surface (stage 1).
- iOS (§ 6).
- Whether the node-gi GObject namespace matches GJS's `registerClass` meta keys closely enough
  for the vectors; the first oracle run answers it.
- GTK on the device (C′) and a GJS port (A).
- Which route replaces the twin by a real subclass (§ 2).

## Implementation

Each stage ends with a measurement, recorded in a report under `docs/reports/`.

0. Oracle only: build a `GObjectSubject` from node-gi and run `GOBJECT_VECTORS` on the `x86_64`
   emulator against it and against the pure-JS subset. Measurement: pass/fail per vector row on
   each subject, and vectors that differ from GJS.
1. Extract the engine interface in adwaita-core; the default engine passes the unchanged vectors.
   Measurement: no bundle-size change in the browser build.
2. The node-gi engine with GObject twins for registered classes. Measurement: the vectors pass on
   device; per-instance construction cost against the pure-JS engine.
3. Settings and `Gio.File` on real Gio. Measurement: the ADR 0099 and 0100 vectors on device.
4. Packaging: GI `.so` files and typelibs as a NativeScript plugin. Measurement: APK delta per ABI,
   compressed, and cold-start delta against an app without it, on an arm64 device.
