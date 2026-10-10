# 104. Real GTK and GI on Android are opt-in tracks beside the NativeScript port

- Status: **Proposed**
- Date: 2026-10-09
- Deciders: Pascal Garber
- Related: [ADR 0003](0003-package-tiering.md) (new packages start at tier 3),
  [ADR 0018](0018-os-axis-declaration.md) (`gjsify.os` and `gjsify.platforms`),
  [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) and
  [ADR 0098](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md) (the subsets the
  NativeScript port re-creates),
  [ADR 0101](0101-portals-are-the-platform-seam-below-the-gtk-api.md) (the Android driver row),
  the measurement [reports/2026-10-09-gtk-android-probe.md](../reports/2026-10-09-gtk-android-probe.md)

## Context

gjsify reaches Android today through NativeScript: `@gjsify/adwaita-nativescript` rebuilds
Adwaita's widgets as native NativeScript components (design-identity axis 4), and ADR 0096 to 0100
re-create the GObject, Application, Settings and file APIs as true subsets on top of it. Nothing of
GLib or GTK runs on the device.

Since GTK 4.18, GDK has an Android backend (`refs/gtk/gdk/android/`), and pixiewood
(`refs/gtk-android-builder`) turns a Meson GTK app into an APK. Apps ship that way: Tuba's
`build-aux/android/pixiewood.xml` and `.github/workflows/android.yml` (`refs/tuba`).

**Measured on an SDK 36 emulator** (the report; arm64 APKs under ARM translation):

- Adwaita renders unchanged; touch and text input reach GTK. Cold start 181 ms (Adwaita Demo) and
  1.75 s (Tuba), PSS about 160 MB, APK 35 and 53 MB.
- Android's accessibility tree holds ONE `SurfaceView`; TalkBack sees no widget.
- Selecting a non-text list row raises the soft keyboard.
- EGL init failed in the emulator; GTK fell back to software rendering. Not yet checked on a device.
- Tuba's APK already carries `libgirepository-2.0.so`, `libffi.so`, GLib, GObject and Gio. Typelibs
  are not built; its manifest has `-Dgtk:introspection` commented out.

**Read from the sources:**

- **GDK owns an Activity — but not the main thread.** `gdk_android_initialize (env, classloader,
  context)` (`gdkandroidinit.c:181`) is the only entry point `libgtk-4.so` exports for this, and
  GDK's toplevel then claims an `org.gtk.android.ToplevelActivity`. pixiewood builds that shape: a
  `main()` calling `g_application_run` and a Meson target with `android_exe_type: 'application'`
  (`refs/gtk-android-builder/README.md`). The GTK main loop is *not* the process's main loop,
  though: `RuntimeApplication.startRuntime()` runs it on a dedicated `g_thread_new ("GTK Thread",
  …)` while the Android UI thread blocks in `GlibContext.blockForMain()` — a `g_idle_add_full()` on
  the default GMainContext plus a `CountDownLatch` (`gdkandroidruntime.c:226-342`,
  `gdk/android/glue/java/org/gtk/android/`). Every call the Java glue makes crosses that boundary
  explicitly, which is why some other thread can own the default context instead (stage 5).
- **GTK's accessibility backend has no Android branch.** `gtk/a11y/gtkaccesskitroot.c` picks
  `accesskit_windows_*`, `accesskit_macos_*` or `accesskit_unix_adapter`; AccessKit itself is off by
  default (`meson.options`: `accesskit` `disabled`). Whether `accesskit-c` offers an Android adapter
  was not checked.
- **GTK's file chooser already has an Android mode** (`gtkfilechoosernative.c`, `MODE_ANDROID`, under
  `GDK_WINDOWING_ANDROID`). ADR 0101's Android driver row comes for free on this path.
- **NativeScript Android has Node-API since 9.1.0.** `refs/nativescript-android` is pinned at
  9.0.5 and contains no `node_api.h`, which is how this ADR first read it. The released runtime
  vendors Node's own `js_native_api` sources, with the libuv parts rebuilt on its Android looper;
  `napi_get_uv_event_loop` always fails there. node-gi (axis 5) is a Node-API addon. Stage 3
  measured it inside a stock 9.1.1 app.

Three ways to use this were raised: (A) GJS itself as the app binary in a pixiewood APK, (B) real GI
on Android, headless, for GLib/Gio/Soup, and (C) real GTK rendering as an alternative to the port.

## Decision

### 1. The NativeScript port stays the Android default

`@gjsify/adwaita-nativescript` and the subsets of ADR 0096 to 0100 are not replaced. A GTK surface
without an accessibility tree cannot be the default renderer of a framework whose apps must be
accessible. B and C are additional, opt-in tracks.

### 2. Track B: GI on Android, through node-gi

GLib, Gio, Soup and json-glib are cross-built with their typelibs by pixiewood, for `aarch64` and
`x86_64` — with introspection forced on and the helpers stage 1 documents, until pixiewood does it
itself. JavaScript reaches them through node-gi, the same addon as on desktop Node.
No second GI binding is written.

The Node-API host is NativeScript's own runtime (9.1.0 and later). Track B therefore runs inside
the NativeScript port's apps, beside the native widgets; it needs no pixiewood process and no
fork of the runtime. On the event loop, node-gi compiles its libuv bridge out on Android and pumps
GLib from the runtime's looper instead (looper fds and a timerfd feed a thread-safe function that
drains the context). It does not use the JS-timer pump of Bun and Deno. A Java bridge from
NativeScript to `libgirepository` is rejected in § Alternatives.

### 3. Track C: GTK renders, in GDK's own Activity

A GTK window lives in `org.gtk.android.ToplevelActivity`; a `NativeScriptActivity` cannot become
one. What that does not require is a pixiewood process. NativeScript owns the `Application`, not
every Activity in the APK, and GTK's loop does not need the process's main thread — so a stock
NativeScript APK can declare `ToplevelActivity` beside `NativeScriptActivity`, start it from JS,
and run GTK on a Worker thread whose default GMainContext node-gi's ALooper pump iterates.
**Stage 5 measured that** (track C′,
[report](../reports/2026-10-10-gtk-on-a-nativescript-worker.md)): the window renders, input reaches
the worker's JS, and the UI thread keeps running NativeScript.

A track-C app is therefore a NativeScript APK plus GDK's Activity, and it reuses B's host as well
as B's binding and GI stack, adding the GTK, Adwaita and GDK typelibs. A pixiewood process with an
engine of its own stays a possible second shape, unplanned.

The same app source runs on desktop GJS, on desktop Node through node-gi, and in a track-C APK.
That is the reason for this track: the app is GNOME code, unchanged, rather than a port.

Before a track-C build is offered to app authors, three gates hold, each with a measurement on an
arm64 device: an accessibility tree TalkBack can walk, no soft keyboard on non-text focus, and
GPU rendering. Until all three pass, the track stays tier 3 and its docs say it is not accessible.
The first arm64 run ([report](../reports/2026-10-10-gtk-on-a-nativescript-worker-arm64.md))
passed GPU rendering (GL renderer, median 60 fps), failed accessibility (the window is one opaque
view; the GTK build has no accessibility backend and no Android bridge) and half-passed the
keyboard (programmatic focus shows it, a tap on an entry does not focus it).
gjsify does not ship an accessibility bridge of its own for GTK; that belongs in GTK. Gaps found
there are reported as `Upstream (GTK, file by hand): …` issues in our repo.

### 4. Track A is a gjsify project, but not planned yet

GJS as the app binary needs SpiderMonkey and GJS cross-built for Android. That belongs to gjsify,
but it is a larger undertaking than B or C, so this ADR does not plan it. It gets its own ADR when
it is scheduled.

### 5. Declarations: no new runtime slot

Code on B or C runs on node-gi, so it is the `node` runtime slot (axis 5); nothing on the runtime
axis changes. What changes is the OS axis. Node reports `process.platform === 'android'`, so a
node-gi prebuild for Android is `android-arm64` / `android-x64` in `gjsify.platforms`, in the one
spelling ADR 0018 fixes. `android` enters the OS-axis vocabulary with the first loadable prebuild,
not before (`gjsify.platforms` promises no target without an artifact behind it).

## Consequences

- A GNOME app has two ways onto Android: the NativeScript port (native widgets, accessible) and a
  real-GTK APK (identical rendering, GNOME code unchanged, not accessible today). The app author
  chooses; gjsify documents the difference.
- node-gi gains a mobile target. Its prebuild and CI matrix grow by two Android triplets once stage 4
  lands.
- `refs/gtk-android-builder` and `refs/tuba` are the references for the build; GTK's own Android
  sources are already in `refs/gtk`.
- Real hardware confirms the accessibility gap is GTK's: no backend in the build, no Android bridge.
  Track C cannot leave tier 3 until GTK gains one.
- Both tracks depend on an experimental GTK backend. A GTK release can break them, and the tier-3
  label says so.

## Alternatives rejected

- **Real GTK replaces the NativeScript port.** No accessibility tree, a keyboard that opens without
  a text field. Measured, not assumed.
- **A GTK surface inside a NativeScript Activity.** GDK's toplevel claims a whole
  `ToplevelActivity` and drives its view, its lifecycle callbacks and its input; hanging a
  `GdkSurface` in a `NativeScriptActivity`'s view tree would leave that Activity with two owners, a
  lifecycle bug by construction. Stage 5 gives GTK an Activity of its own in the same APK instead,
  which is a different thing.
- **A Java (JNI) GI binding for the NativeScript runtime.** A second GI binding to maintain beside
  node-gi, with its own marshalling bugs. node-gi exists and is tested.
- **A webview with the browser port.** That already exists (`@gjsify/adwaita-web`) and is not real
  GTK; it answers none of the three questions.

## What this does not decide

- The JS host for a track-C app that is not a NativeScript APK. Stage 5 answers the NativeScript
  case; a pixiewood process needs an engine of its own, and which one is open.
- Which thread owns the GLib pump, as a contract. `startMainLoop()` is per thread and silently
  pumps nothing when another thread already holds the context; stage 5 relied on that. The stage
  that productizes track C makes ownership explicit.
- iOS. GDK has no iOS backend.
- Whether gjsify's CLI grows a `gjsify build --app android` or calls pixiewood directly. That is
  decided when stage 5 has a working APK to wrap.
- Distribution: Play Store, F-Droid, APK size budgets.

## Implementation

Each stage ends with a measurement, recorded in a report under `docs/reports/`.

0. Probe GTK's Android backend on an emulator. **Done:** the report linked above.
1. Build a minimal GI stack with pixiewood (`aarch64`, `x86_64`, introspection on), and from a C
   `main()` load the Gio and Gtk typelibs with `gi_repository_require`. Proves the typelibs work on
   the device. **Done:** [report](../reports/2026-10-10-gi-in-a-pixiewood-apk.md) — all checks
   pass on both ABIs, including calls through libffi. pixiewood does not support this out of the
   box: introspection is forced off or resolves to off on a cross build, typelibs never reach the
   APK, three namespaces (cairo, fontconfig, freetype2) are never built, and the scanner needs an
   exe wrapper that runs the dumper on a device. Each is a small fix in pixiewood; until it lands,
   the report's helpers fill the gap. One typelib set serves every ABI.
2. Run the Adwaita Demo or Tuba on an arm64 device: EGL, frame times, the keyboard finding.
3. Find a Node-API host that loads node-gi on Android. **Done:**
   [report](../reports/2026-10-10-node-gi-on-nativescript-android.md) — NativeScript 9.1.1's own;
   node-gi's unchanged sources load in a stock app on both ABIs, and GLib, Gio and cairo calls,
   including an async Gio call, pass. Its libuv imports could not stay link-time imports: Bionic
   binds every symbol at `dlopen`.
4. Build node-gi for `android-arm64` and `android-x64`, run its test suite on the emulator (track B).
   **Partly done:** [report](../reports/2026-10-10-node-gi-android-stage-4.md). The libuv bridge is
   a compile-time guard (`NODE_GI_HAS_LIBUV`), not run-time lookups; on Android a native ALooper
   pump replaces it. Both ABIs build and link uv-free (`scripts/build-android.mjs`). On the
   `x86_64` emulator the probe cases pass with `@gjsify/node-gi` as a package dependency bundled by
   `@nativescript/webpack`. Not done: the full node-gi test suite on a device, an arm64 device
   run, the GI `.so` files and typelibs as a NativeScript plugin, and `android-*` entries in
   `gjsify.platforms` (they need a loadable prebuild). Limits: a blocking `GLib.MainLoop.run()` on
   the UI thread is unsupported, and the keep-alive ref/unref of the thread-safe function are
   no-ops.
5. A hello-Adwaita written in TypeScript, unchanged from its desktop form, rendering real GTK on
   Android (track C). **Done for the NativeScript shape** (track C′):
   [report](../reports/2026-10-10-gtk-on-a-nativescript-worker.md) — a stock NativeScript 9.1.1 APK
   keeping `com.tns.NativeScriptApplication`, with `org.gtk.android.ToplevelActivity` declared
   beside `NativeScriptActivity` and started from JS, and GTK's loop on a NativeScript Worker: a
   GTK4 + Adwaita window renders, `adb shell input tap` reaches the worker's JS handler, the worker
   reads `android.os.Build.MODEL` through NativeScript's metadata, and the UI thread logged 130
   one-second ticks at 1-2 ms drift throughout. Three node-gi additions carry it, all Android-only
   and opt-in: `androidInitGdk` (GDK's bring-up without GTK's `RuntimeApplication`, which a JS host
   cannot call), GLib's log handlers onto logcat, and a `JNI_OnLoad` the host triggers through one
   Java class in the app — NativeScript's `dlopen` of the addon runs none. An arm64 device run
   followed ([report](../reports/2026-10-10-gtk-on-a-nativescript-worker-arm64.md)): GPU rendering
   passes, the accessibility tree is empty, and the keyboard works only after programmatic focus.
   Not done: lifecycle handling, touch focus on an entry, and explicit per-thread pump ownership.

Follow-up work goes into `status/open-todos/nativescript.md` once this ADR is accepted.
