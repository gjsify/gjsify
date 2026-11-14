# 141. A Dock click reopens the application on macOS: a tiny native bridge adds the missing delegate method

- Status: **Accepted**
- Date: 2026-11-11
- Deciders: Pascal Garber
- Related: [ADR 0017](0017-native-package-distribution.md) (per-target native packages),
  [ADR 0023](0023-gtk-source-precedence.md) (bundle before system), [ADR 0074](0074-one-declared-macos-floor.md),
  `docs/prebuilds.md` § One GLib, `packages/framework/webkit-native` (the only Objective-C package today)

## Context

On macOS a click on the Dock icon of a running app that has no visible window is delivered to the
`NSApplicationDelegate` as `applicationShouldHandleReopen:hasVisibleWindows:`. GTK's delegate,
`GtkApplicationQuartzDelegate`, does not implement it in GTK 4.24.1, so the click is dropped and
`GApplication::activate` is never emitted. A background-resident app (status icon, `hold()`,
ADR 0129) can therefore never be brought back from the Dock. Upstream GTK fixed this on `main`
(GNOME/gtk c50deda, 2026-10-19); it is in no release.

Measured on macOS 27 / arm64, with a probe that `dlopen`s the library and asks the ObjC runtime:

| libgtk-4.1.dylib | `GtkApplicationQuartzDelegate` exists | `respondsToSelector:` reopen |
|---|---|---|
| Homebrew gtk4 4.24.1 | yes | **no** |
| `@gjsify/gtk-runtime-darwin-arm64` 0.54.0 and 0.64.11 | yes | **no** |

The delegate's method list is `initWithImpl:`, `applicationShouldTerminate:`, `application:openFiles:`,
`applicationSupportsSecureRestorableState:`. The selector *string* is present in the dylib (a
`strings | grep` suggests the method exists) but only as a reference — `class_respondsToSelector` is
the test. Also measured: `class_addMethod` on that class succeeds, and a second add returns NO, so
"add only if absent" is exactly the call's own semantics.

gjsify has no runtime Objective-C injection today. Its one ObjC source is the static
`webkit-native` shim, and the GTK runtime is a Homebrew bottle that gjsify repackages unmodified.

## Options

1. **Patch the bottle** (rebuild GTK with the upstream commit, or binary-patch the dylib).
   Rejected: it forks the runtime, costs a from-source GTK build per arch in CI, and the patch has to
   be re-carried until GTK releases. A bottle is deliberately unmodified (ADR 0023).
2. **Consumer shim** (Beifahrer minimises instead of hiding). Works for one app, hides the app from
   Mission-Control-style "hidden" semantics, and every consumer re-derives it. Rejected as the
   answer, kept as the stopgap.
3. **Wait for GTK 4.26.** No date; the bundle is pinned to a Homebrew bottle.
4. **A tiny native bridge in gjsify that adds the method through the ObjC runtime** (chosen).

## Decision

Option 4. A new darwin-only package, `@gjsify/gtk-quartz-native` (working name), ships a ~40-line
Objective-C library with one entry point, `gjsify_quartz_install_reopen_handler()`:

1. look up `GtkApplicationQuartzDelegate` with `objc_getClass`; return if the class is absent
   (GTK not loaded, or a future GTK renamed it);
2. `class_respondsToSelector(cls, applicationShouldHandleReopen:hasVisibleWindows:)`; return if YES.
   This is the **self-retirement**: once GTK ships the method the bridge does nothing, and the
   package can then be deleted without a flag day;
3. otherwise `class_addMethod` with an IMP that calls `g_application_activate(g_application_get_default())`
   when `hasVisibleWindows` is NO, and returns YES, so AppKit does not also try to open an untitled
   document. With visible windows it returns YES and does nothing, matching Cocoa's default.

The bridge links GLib by `dynamic_lookup` and GTK by path, as every darwin bridge does
(`docs/prebuilds.md` § One GLib), and is built with `buildtype=plain` and the 15.0 floor.

**Where it is called.** From the GTK host layer's application startup on darwin, after the
`Gtk.Application` exists and before `run()` — one call, not an app-author concern. It is reached
through `loadOptionalNativeModule()`, so a missing prebuild reads as "no handler" and never fails
an app.

**Test.** A GJS spec that loads the bridge, then, in the same process, instantiates
`GtkApplicationQuartzDelegate`, sends the selector with `hasVisibleWindows: NO`, and asserts the
GApplication's `activate` fired. A second case proves the guard: a stand-in class that already
implements the selector is left untouched. Neither needs a window; the windowed Dock-click path
stays a manual check (a synthetic Dock event cannot be sent headlessly).

## Consequences

- One more per-target package pair (arm64, x64) under ADR 0017, a row in
  `.github/prebuild-toolchain/darwin-bridges.mjs`, and a prebuild leg — the reason this ADR is
  separate from the implementation: it is a build-chain change, not a patch.
- The IMP lives in gjsify, so it must not hardcode app behaviour: it only emits `activate`.
- Consumers drop their minimise shim once they depend on a gjsify release that carries the bridge.
- The package is explicitly temporary: delete it when the bundled GTK answers YES to the selector
  (the probe above is the check; add it to the runtime bundle's verify step so the day is noticed).

## Node hosts

The bridge first shipped for GJS only: `installDockReopen()` handed `loadOptionalNativeModule` no
`imports.gi` on Node, it fell back to `globalThis.imports.gi` (GJS only) and answered `false`, and
`gjsify ship darwin --target macos-app` never staged the bridge's prebuilds. A Node (node-gi) `.app`
therefore never reopened on a Dock click. Both halves are fixed:

- **Load.** Without a GJS `imports.gi`, `installDockReopen` builds a one-namespace view
  `{ GjsifyQuartz: requireGi('GjsifyQuartz', '1.0') }` from `@gjsify/node-gi/gi`, resolved from the bundle's
  own location inside a `try` (the shape of the ADR 0087 `&optional` node shim). Typelib absent = no bridge =
  `false`, windows stay visible.
- **Ship.** `stageAppRuntime` stages the typelib into the staged GTK closure's `girepository-1.0/` and the
  dylib into its `lib/`. node-gi already puts exactly those two directories on GI's typelib and library
  search paths when the bundled GTK is in use (`activateBundledGtkRuntime`, `activateGiLibraryPath`), so
  the launcher gains no variable. Only an app that has the dependency (the `@gjsify/gtk-quartz-native-<target>`
  companion, found from the project or through `@gjsify/adwaita-app`) gets the two files; a facade without its
  companion is reported under `missing`, never fatal. The dylib is signed by the existing magic-number pass.

Rejected: `gi://GjsifyQuartz?version=1.0&optional` — it would put a namespace mapping into
`ship/gi-namespaces.ts` and `depends.ts` for every adwaita-app ship and change the GJS path. Also rejected:
`gjsify.ship.bundledTypelibs`, which flattens the tree.

Limits: with `GJSIFY_GTK_PREFER=system` node-gi does not search the closure, so the bridge is not found and
the result is `false`. The package manifest keeps `runtimes.node: "none"`: the package contains no
JavaScript; the Node lookup lives in `@gjsify/adwaita-app`. The windowed Dock click on a Node app is, like
the GJS one, a manual check.

## Implementation

`@gjsify/gtk-quartz-native` (GI namespace `GjsifyQuartz`, `packages/framework/gtk-quartz-native`) with its
arm64/x64 package pair, a `darwin-bridges.mjs` row, a `build-prebuilds-macos` leg (build, `meson test`,
load test, upload, two download steps), and the call site in `AdwaitaApp._onStartup`
(`installDockReopen`, `packages/framework/adwaita-app/src/dock-reopen.ts`).

Specs: `test/reopen-handler.m` (meson test: a real `GtkApplicationQuartzDelegate` instance, selector sent with
`hasVisibleWindows` NO fires `activate`, YES does not; a stand-in class that already has the selector is
left untouched; unknown class is a no-op), `test/install.gjs.js` (typelib + library load through GI), and
`dock-reopen.spec.ts` (platform guard, absent bridge, retired bridge).

Not verified here: the windowed Dock click itself (manual), the x64 build, and the CI leg (`ci:macos`).
