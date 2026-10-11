# The GI runtime as a NativeScript plugin, and the device opt-in (2026-10-11)

[ADR 0105](../adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md) stage 4:
package the GObject-Introspection runtime so that an Android app gets it from **one dependency**,
and then flip the opt-in [stage 3](2026-10-10-real-gio-stage3.md) deliberately left unflipped —
`packages/nativescript-bridge/adwaita/` building its GObject namespace on the real-Gio engine,
on a phone.

**Both hold.** A test app whose only connection to the runtime is
`"@gjsify/gi-runtime-android": "file:…"` in its `package.json` installs an APK that carries
`libnode_gi.so`, fourteen GI libraries and seven typelibs for two ABIs, and on a Samsung
Galaxy S9 it answers **41 of 41** rows with `gobjectEngineName() === 'real-gio'`: the 24
`GOBJECT_VECTORS` through the subset on real GObject, 9 `LIST_ITEMS_CHANGED_VECTORS` on a real
`Gio.ListStore`, 4 engine rows and 4 loader-probe rows. The same APK with the opt-in refused
answers **27 of 27** on pure JS. No vector was weakened and no `it.failing` was added.

Measured on a physical `arm64-v8a` device (SM-G960F, Android 10), `@nativescript/android` 9.1.1,
`@nativescript/vite` 8, Rolldown ESM output, NDK 27.1.12297006, GLib 2.91.0 in the bundled
closure, built from `~/.cache/gjsify-android/wt-stage4`.

## Where the plugin lives, and why

`packages/node-gi/gi-runtime-android/` → **`@gjsify/gi-runtime-android`**, tier 3, mirroring
`@gjsify/gtk-runtime-darwin-arm64`: a package whose whole content is a platform payload and a
build script for it. **One package carries both ABIs and `libnode_gi.so` with them**, rather than
a package per ABI plus a loader package. The reason is `DT_NEEDED`: the addon and the fourteen GI
libraries are one dynamically linked unit, and Android's packager puts `lib/<abi>/` from every
AAR into one APK regardless, so splitting would buy an app nothing it cannot get from an ABI
split in its own gradle config, and would cost a second coordination point between versions.

The envelope is an **AAR** in `platforms/android/`. NativeScript's own gradle scans
`$rootDir/${dep.directory}/platforms/android` for `**/*.aar` and adds each as `implementation`,
so an AAR is the one shape that needs no app-side gradle edit at all. Typelibs ride in the AAR's
`assets/app/girepository-1.0/`, which is exactly `host.nativescript.js`'s default
`__NODE_GI_TYPELIB_PATH` — the app sets no environment variable either.

Three things had to be true for discovery to work, and each is now asserted by a test rather than
by a successful build: `"nativescript": { "platforms": { "android": "7.0.0" } }` in the manifest
(without it the dependency is not a plugin and nothing scans it), `"./package.json"` in
`exports`, and `platforms/android/` reachable as a subpath export.

`gjsify.platforms` stays free of `android-*`, per the ADR's own rule: no loadable artifact exists
for a `gjsify` *platform* build here. The package declares `runtimes.nativescript: 'native'` and
`gjsify.nativescriptPlatforms: ["android"]` instead, which is what the conformance and
runtime-audit scripts read.

## How the payload is produced

`packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs`, in-repo, against an
Android GI prefix the script does not contain. **The closure is measured, not listed**: a
transitive `DT_NEEDED` walk from `libnode_gi.so`, and any soname it cannot resolve must appear in
the script's `SYSTEM_PROVIDED` set or the build fails. That set is seven entries —
`libNativeScript.so`, `libandroid.so`, `libc.so`, `libdl.so`, `liblog.so`, `libm.so`, `libz.so` —
and it is the whole contract with the platform. The typelib set follows the closure the same way:
**7 of the prefix's 21** typelibs ship, because only seven name a library that is in it.

Both ABIs are walked and compared; a divergence that is not declared fails the build. The source
ABI is declared `arm64-v8a`, and exactly one difference survives: `GLib-2.0.typelib` is 230,588
bytes for arm64 and 230,648 for x86_64, because the two came from different introspection runs of
the same GLib. That is recorded in `platforms/android/gi-runtime.json` with a sha256 per file.

The AAR, the staged tree and the generated `THIRD-PARTY-NOTICES.md` are **gitignored** — 32 MB of
stripped `.so` does not belong in git. `platforms/android/include.gradle` is the one committed
file under `platforms/`, and it exists only to **fail loudly**: if the AAR is absent, gradle stops
with the two commands that build it. Without that guard NativeScript's `**/*.aar` scan finds
nothing and says nothing, the app builds and installs, and it dies in `dlopen` at the first
`requireGi` — hours after the step that was skipped. A guard that ships inside the payload is a
guard that is missing precisely when it is needed.

Licensing is `"license": "SEE LICENSE IN platforms/THIRD-PARTY-NOTICES.md"`;
`licenses/bundled-projects.json` is a soname→project **name map**, so the notice is generated from
the measured closure instead of hand-maintained beside it. The zip writer
(`packages/node-gi/scripts/aar-zip.mjs`) is deterministic and STORE-only for `lib/`, which is
what keeps the APK's `.so` entries page-aligned and uncompressed.

## How the engine is chosen

Explicitly, at app level, and it fails loudly. There is no try/catch fallback anywhere on the
path, and **pure JS stays the default**.

- `@gjsify/adwaita-core`'s `src/engine.ts` holds a one-slot registry. It **freezes on first
  read** — the first `createGObject(door, registeredEngine())` fixes the answer for the process.
- tier-3 `@gjsify/adwaita-gobject-native` exports `useRealGObjectEngine(requireGi)`. It takes
  `requireGi` as an argument because the package has `@gjsify/node-gi` only as a devDependency;
  the app owns that import, so an app that never opts in never pulls the addon into its graph.
- late registration **throws**, and the message carries the import-order fix.
- the runtime query is `gobjectEngineName()`, plus `engineName` on the `GObjectNamespace`,
  re-exported from `@gjsify/adwaita-nativescript/gobject` and documented as **not** a GJS member.
  "Which engine backs this app?" is answerable on the device, by the app, without a log.

**The finding of this stage is that app-side import order cannot win.** `@nativescript/vite` 8
(`node_modules/@nativescript/vite/configuration/base.js:607`) puts every `node_modules` package
except `@nativescript/core` into `vendor.mjs`, and `bundle.mjs` imports `vendor.mjs` first. The
gobject namespace reads the slot during vendor evaluation, so no ordering of the app's own modules
can register before it: measured as `registered too late` on the device before the fix. The fix in
the test suite's vite config is `build.rollupOptions.output.manualChunks: () => undefined` — one
chunk, app modules and vendor in evaluation order. This is a real constraint for any app that
wants the real engine under vite, and it is now written down in
[docs/node-gi-platform-notes.md](../node-gi-platform-notes.md) § *The NativeScript plugin*.

## The result, per subject

Device suite `tests/integration/nativescript-gi/` (app id `org.gjsify.NsGiTest`, outside the root
`workspaces`, `@gjsify/*` deps as `file:` paths, NativeScript pinned to 9.1). Both runs install
the **same APK payload**; only the `__GJSIFY_GI_OPT_IN__` vite `define` differs, so the comparison
is a decision, not a different build. A failed opt-in is recorded in `app/opt-in.ts` and reported
as one failed case, never swallowed.

- **the subset on real GObject** — 24 of 24 `GOBJECT_VECTORS`, refusals included, driven by the
  shipped subject in `packages/nativescript-bridge/gobject/src/vector-subject.ts`, so CI and the
  device go through one door.
- **the portable list model on a real store** — 9 of 9 `LIST_ITEMS_CHANGED_VECTORS` against a
  real `Gio.ListStore`.
- **the engine contract** — 4 of 4: `gobjectEngineName()`, `GObject.engineName` and
  `registeredEngine()` all `real-gio`, and a second opt-in attempt throws.
- **the loader probe** — 4 of 4, and informative: all three links of `resolveNativeRequire`'s
  chain were functions on this runtime, and it took `__non_webpack_require__`; GLib reports
  2.91.0; `GLib.get_user_data_dir()` is
  `/data/user/0/org.gjsify.NsGiTest/files/.local/share`, i.e. the app-private path the host sets
  up, not a host default that happens to exist.
- **control run** (`GJSIFY_GI_OPT_IN=0`) — 27 of 27: the same 24 vectors on the default engine
  plus 3 engine rows, with `registeredEngine()` reporting `<none>` and `engineName` `pure-js`.

Logs: `logcat.optin.log`, `logcat.control.log`. The host-side suite is
`packages/node-gi/node-gi/test/gi-runtime-android.test.mjs`, 41 tests, which asserts the manifest,
the exports, the AAR layout and the closure/typelib agreement without a device.

## APK size

One universal debug build carrying both ABIs, measured with `zipinfo -l` by
`scripts/apk-size.mjs` (`apk-size.json`):

- APK total **152,310,583 B**; with the plugin's entries removed, **119,841,803 B**.
- plugin share: 37 of 37 expected entries present, **32,468,780 B compressed**
  (32,944,668 B uncompressed).
- per ABI, `lib/`: arm64-v8a 15 entries, **15,540,824 B**; x86_64 15 entries, **16,701,632 B** —
  stored, so compressed equals uncompressed.
- typelibs: 7 entries, 702,212 B uncompressed, **226,324 B compressed** (deflated).
- the AAR itself is 32,950,193 B, sha256 `dccae30b89df…`.

So the plugin costs **~15.5 MB per ABI plus ~0.22 MB of typelibs**, and the "two ABIs in one APK"
number (32.5 MB) is the universal-build figure, not what a per-ABI release would ship. The largest
single contributors are pixman (2.9/4.4 MB), Gio (2.7/2.6 MB), GLib (2.6 MB) and libxml2
(2.0/1.9 MB).

## Four defects fixed on the way

1. **`host.nativescript.js` only accepted `__non_webpack_require__`** — a name *webpack rewrites*.
   Under vite nothing rewrites it, so every vite-bundled NativeScript app failed at the first
   `requireGi` with a message telling it to change bundlers. Now `resolveNativeRequire(scope,
   webpackRequire)` is a chain — webpack's rewrite first (its module-scoped `require` would
   resolve `system_lib://` against the bundle graph), then `globalThis.require`, then
   `globalThis.__nativeRequire` — read off a scope **argument**, so the order is pinned by a unit
   test rather than by a gradle build. Fixed at the core, in its own commit.
2. **`@gjsify/nativescript-vite` could not find its optional peer from a symlinked lib.**
   `loadUpstreamConfig` resolved `@nativescript/vite` relative to itself, which fails when the
   package is linked into an app that has the peer and the package's own tree does not — exactly
   the worktree case. New `importSpecifierFor()` resolves cwd-first via `require.resolve` and
   converts to a file URL. Held by a new "Bug 3: symlinked lib" suite in
   `tests/e2e/ns-vite-fixes/run.mjs`; that file is 23 of 23 green.
3. **The device runner measured stale JS.** `scripts/run-on-device.mjs` copied from
   `.ns-vite-build` instead of `.ns-vite-build/android`, so it copied **0 files** and silently ran
   whatever was there before. It now dies on `copied === 0`.
4. **`scripts/apk-size.mjs` read the wrong `zipinfo -l` column** — the name is field 9, not 8,
   because date and time are two fields. It reported entries as missing that were present.

## Not done, and not measured

- **x86_64 ran nowhere.** It is built, walked, compared against arm64 and shipped in the APK, but
  no emulator or device executed it. Everything behavioural here is arm64-v8a.
- **No cold-start delta**, which ADR 0105 stage 4 explicitly asks for. The two runs differ in a
  `define`, not in payload, so the APK carries the full 32.5 MB in both — the honest comparison
  would need a build with the dependency removed, and it was not made. Nothing about startup cost
  is claimed.
- **No per-ABI and no release APK.** The number above is one universal debug build; an ABI split
  and R8 would both move it.
- **iOS is absent entirely.** The plugin is Android-only by name and by manifest.
- **The published-npm install path is unverified.** Every dependency was a `file:` link.
  `@gjsify/gi-runtime-android` is not on npm and cannot be until the name exists — it is declared
  in `status/pending-npm-bootstrap.json` and carried as `partial` in `status/status.json`. The
  claim "an installed tarball always carries the AAR" rests on the `files` field, not on an
  install.
- **No performance number.** Nothing was timed: not twin construction, not `set_property`
  round-trips through napi, not `dlopen` of the closure.
- **Settings and `Gio.File`** (ADR 0105 stage 3's literal content) remain blocked on ADR 0099/0100
  being implemented at all, unchanged by this work.
- The engine-slot error message is imprecise in one case the device hit: a second, *different*
  engine instance with the same name reads as `'real-gio' cannot be replaced by 'real-gio'`. It is
  the correct refusal with a confusing text; the adwaita-core slot tests assert the strings
  verbatim, so changing it is a deliberate edit, not a tidy-up.

## Where this runs

The device suite is **not** in CI and cannot be: it needs a phone. CI keeps the host-side half —
`gi-runtime-android.test.mjs` in the node-gi workflow, the `ns-vite-fixes` e2e suite, and the two
`*.node-gi.spec.ts` legs that drive the same vector subject the device drives.
