# @gjsify/nativescript-vite

Vite 8 / Rolldown compatibility + gjsify transforms for building [NativeScript](https://nativescript.org/) apps.

It is a **thin composer** around the upstream `@nativescript/vite` integration. It takes the Vite config that `@nativescript/vite` produces, fixes the two pieces Vite 8 / Rolldown reject, and layers gjsify's NativeScript transforms on top — so a NativeScript app builds under Vite 8 with `gjsify`'s stack.

## Why

`@nativescript/vite` targets Vite ≤ 7 (Rollup). Under **Vite 8 / Rolldown** its config uses two constructs the Rust bundler rejects, so a pristine NativeScript app fails to build. This package patches exactly those two pieces on the returned config object — no fork of `@nativescript/vite`, no patched `node_modules` — then adds the same gjsify NativeScript transforms that `gjsify build --app nativescript` applies.

**Empirically validated:** with pristine `@nativescript/vite` 2.0.3 + this composer, a real NativeScript app (a `@nativescript/canvas` three.js teapot) builds on **Vite 8.0.16** → 612 modules → `bundle.mjs` (~450 kB), `ns prepare android` succeeds, and the bundle has zero `@nativescript/vite` / `gi://` / `@girs/*` leakage.

## What it fixes

1. **Function-replacement `resolve.alias` entries are dropped.** `@nativescript/vite` registers aliases whose `replacement` is a *function* (platform-`main`, the tsconfig wildcard, `@nativescript/core/.../index` canonicalization). Vite 8's native alias (Rolldown) only accepts string replacements and otherwise fails with `Failed to convert builtin plugin 'ViteAlias' … function replacement into rust type String`. The upstream `nativescript-package-resolver` plugin (a `resolveId` hook, kept) and the string `~/` / `@` aliases (kept) already cover the same resolution, so dropping the function entries is safe.
2. **The explicit `@rollup/plugin-commonjs` plugin is removed.** It crashes Rolldown with `Cannot read properties of undefined (reading 'currentLoadingModule')`. Rolldown handles CommonJS (`@nativescript/core`'s modules) natively, so the plugin is not needed.

On top of the fixes, it spreads `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()` preset: `gi://` → empty module, `*.gresource.xml` imports embedded as bytes (ADR 0116), platform file resolution (`*.android` / `*.ios` / `*.native`), platform defines (`__ANDROID__` / `__IOS__` / `__APPLE__` / `__VISIONOS__` / `__DEV__`), and the node-builtin alias routing (incl. `module` → `@gjsify/module`).

## Release-build minifier defaults

*2026-10-10.* A release build of Learn6502's Android app crashed on launch with `Class not found` for `com.tns.FragmentClass`, `com.tns.NativeScriptActivity` and `org.nativescript.NativeScriptLifecycleCallbacks`. The Android Static Binding Generator reads the bundle as text: the default oxc minifier writes `extend(\`com.tns.X\`, …)` with a template literal, and the syntax pass folds `__decorate([JavaProxy("…")], t)` into a comma expression. The generator recognises neither, skips the class without an error, and the native class never exists. Mangled class names also broke the `adw:Bin` → `AdwBin` check in `@gjsify/adwaita-nativescript` (that package now names its classes with a static `GTypeName`).

`defineNativescriptConfig()` therefore ships `build.minify: 'esbuild'` plus `esbuild: { minifySyntax: false, keepNames: true }` (`nativescriptReleaseMinify()`), unless upstream already disabled minification (debug builds). Whitespace and identifiers still shrink. `esbuild` has to be installed next to `vite` (an optional peer of Vite 8). Your own `build.minify` / `esbuild` in the `userConfig` argument wins, so a platform that wants another minifier keeps it.

## Install

The package's only hard dependency is `@gjsify/vite-plugin-gjsify`. Everything from the NativeScript side is an **optional peer** — install it in your NativeScript app alongside the rest of your NS toolchain:

```bash
gjsify install -D @gjsify/nativescript-vite @nativescript/vite vite
# plus whatever your app already uses, e.g.:
gjsify install @nativescript/core @nativescript/canvas @nativescript/canvas-polyfill

# npm or yarn also work (e.g. alongside your existing NativeScript npm toolchain):
npm install -D @gjsify/nativescript-vite @nativescript/vite vite
```

Optional peers: `@nativescript/vite`, `@nativescript/core`, `nativescript`, `@nativescript/canvas`, `@nativescript/canvas-polyfill`, and `vite` (`^8.0.14`). They are not installed by this package — your NativeScript app provides them. If `@nativescript/vite` is missing, the config factory throws a clear, actionable error.

## Usage

`vite.config.ts` — use the exported factory as your whole config:

```ts
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

export default defineNativescriptConfig();
```

It returns an async Vite config **function**, so Vite resolves `mode` and passes it through; the upstream `@nativescript/vite` config is built for the right mode before the fixes + gjsify transforms are applied. The first argument is forwarded to the `gjsifyNativescript()` preset from `@gjsify/vite-plugin-gjsify` (`{ reflection?, aliases?, optimizeDepsExclude?, giRenderer?, locale?, giNamespaces? }`); an optional second argument is a Vite config (object or `(env) => config`) that is `mergeConfig`'d in last, so you can compose your own settings on top.

`nativescript.config.ts` — select the Vite bundler:

```ts
import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'org.example.app',
  appPath: 'src',
  android: { v8Flags: '--expose_gc', markingMode: 'none' },
  bundler: 'vite',
} satisfies NativeScriptConfig;
```

Then build as usual:

```bash
ns prepare android   # or: ns run android / ns run ios
```

## Declaring the GI namespaces your APK carries

An Android APK carries its whole GI stack or does without it: there is no `apt install gir1.2-soup-3.0` on a device, so a namespace that is not in the APK surfaces as a throw at the first `requireGi`. `@gjsify/gi-runtime-android` therefore ships a fixed CORE set — `GLib`, `GObject`, `Gio` and the other typelibs its link closure happens to contain — and anything beyond that is **declared**, per app, at build time ([ADR 0117](https://github.com/gjsify/gjsify/blob/main/docs/adr/0117-android-gi-namespaces-are-selected-at-build-time.md)).

The declaration is `giNamespaces` in the first argument, `Ns` or `Ns-Version`:

```ts
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

export default defineNativescriptConfig({
  giNamespaces: ['Soup-3.0', 'Json'],
});
```

Two things follow from it:

- **The build refuses to emit a bundle that imports a namespace the list omits**, naming the chunk the import was read from and the line to add. This is the direction that matters: a missing declaration is a crash on the device, so it is a build failure here.
- **A declared namespace the bundle does not appear to import is a warning**, not a failure. `GLib.Module`, a plugin loaded by name and `Gio.DBusProxy` reaching a namespace through a string are all legitimate and invisible to a scanner, and the declaration is how an app says so. The warning exists because every selected namespace costs APK size.

Declaring nothing selects exactly the core payload, which is what every app built before this option got — so adding the option to an existing config changes no bytes until you list something.

Under `giRenderer: true` a `gi://Gtk` import is **not** a reason to declare `Gtk`: the renderer answers those specifiers with `@gjsify/adwaita-nativescript`, no typelib is involved, and the scan reads the emitted bundle precisely so that it sees what survived the renderer rather than what the module graph contained.

The same declaration under `gjsify build --app nativescript` is `nativescript.giNamespaces` in `gjsify.config.ts`. Both paths share one scanner and one planner (in `@gjsify/rolldown-plugin-gjsify`), so a config means the same thing whichever drives the build.

What a namespace can resolve to is bounded by the pinned Android sysroot: a namespace whose backing library or typelib the sysroot does not carry fails the AAR build naming what is missing, rather than shipping a typelib that dies in `g_module_open`.

## Audio-context note

`@nativescript/canvas` transitively pulls a Web-Audio module that references surface a canvas/WebGL app never executes. If your app only does 2D/WebGL rendering, mark it `external` via the composable second argument so it stays out of the bundle:

```ts
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

export default defineNativescriptConfig({}, {
  build: { rollupOptions: { external: [/@nativescript\/audio-context/, /@nativescript\/canvas-media/] } },
});
```

## Known limitations

- **Production target.** Validated for the production build path (`ns prepare` / `ns build` / `ns run --no-hmr`). The upstream dev-server / HMR plugins are passed through untouched but not separately validated under Vite 8.
- **Web Worker builds** keep the upstream `worker` config verbatim; gjsify's transforms are not propagated into `worker.plugins`. A worker-using app is an untested shape.
- **Conditional exports.** `resolve.conditions` keep upstream's `browser` active alongside `nativescript`, so a package that ships *divergent* `browser` vs `nativescript` conditional exports may resolve its `browser` variant. The validated apps do not hit this.
- **Version coupling.** The two fixes target `@nativescript/vite`'s returned config shape (array-form aliases with function replacements, a plugin named `commonjs`). If a future version renames/wraps those, the composer warns at build time that the CommonJS fix did not apply.

## License

MIT — see the [gjsify](https://github.com/gjsify/gjsify) workspace.
