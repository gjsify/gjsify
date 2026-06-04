# @gjsify/nativescript-vite

Vite 8 / Rolldown compatibility + gjsify transforms for building [NativeScript](https://nativescript.org/) apps.

It is a **thin composer** around the upstream `@nativescript/vite` integration. It takes the Vite config that `@nativescript/vite` produces, fixes the two pieces Vite 8 / Rolldown reject, and layers gjsify's NativeScript transforms on top — so a NativeScript app builds under Vite 8 with `gjsify`'s stack.

## Why

`@nativescript/vite` targets Vite ≤ 7 (Rollup). Under **Vite 8 / Rolldown** its config uses two constructs the Rust bundler rejects, so a pristine NativeScript app fails to build. This package patches exactly those two pieces on the returned config object — no fork of `@nativescript/vite`, no patched `node_modules` — then adds the same gjsify NativeScript transforms that `gjsify build --app nativescript` applies.

**Empirically validated:** with pristine `@nativescript/vite` 2.0.3 + this composer, a real NativeScript app (a `@nativescript/canvas` three.js teapot) builds on **Vite 8.0.16** → 612 modules → `bundle.mjs` (~450 kB), `ns prepare android` succeeds, and the bundle has zero `@nativescript/vite` / `gi://` / `@girs/*` leakage.

## What it fixes

1. **Function-replacement `resolve.alias` entries are dropped.** `@nativescript/vite` registers aliases whose `replacement` is a *function* (platform-`main`, the tsconfig wildcard, `@nativescript/core/.../index` canonicalization). Vite 8's native alias (Rolldown) only accepts string replacements and otherwise fails with `Failed to convert builtin plugin 'ViteAlias' … function replacement into rust type String`. The upstream `nativescript-package-resolver` plugin (a `resolveId` hook, kept) and the string `~/` / `@` aliases (kept) already cover the same resolution, so dropping the function entries is safe.
2. **The explicit `@rollup/plugin-commonjs` plugin is removed.** It crashes Rolldown with `Cannot read properties of undefined (reading 'currentLoadingModule')`. Rolldown handles CommonJS (`@nativescript/core`'s modules) natively, so the plugin is not needed.

On top of the fixes, it spreads `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()` preset: `gi://` → empty module, platform file resolution (`*.android` / `*.ios` / `*.native`), platform defines (`__ANDROID__` / `__IOS__` / `__APPLE__` / `__VISIONOS__` / `__DEV__`), and the node-builtin alias routing (incl. `module` → `@gjsify/module`).

## Install

The package's only hard dependency is `@gjsify/vite-plugin-gjsify`. Everything from the NativeScript side is an **optional peer** — install it in your NativeScript app alongside the rest of your NS toolchain:

```bash
npm install -D @gjsify/nativescript-vite @nativescript/vite vite
# plus whatever your app already uses, e.g.:
npm install @nativescript/core @nativescript/canvas @nativescript/canvas-polyfill
```

Optional peers: `@nativescript/vite`, `@nativescript/core`, `nativescript`, `@nativescript/canvas`, `@nativescript/canvas-polyfill`, and `vite` (`^8.0.14`). They are not installed by this package — your NativeScript app provides them. If `@nativescript/vite` is missing, the config factory throws a clear, actionable error.

## Usage

`vite.config.ts` — use the exported factory as your whole config:

```ts
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

export default defineNativescriptConfig();
```

It returns an async Vite config **function**, so Vite resolves `mode` and passes it through; the upstream `@nativescript/vite` config is built for the right mode before the fixes + gjsify transforms are applied. The first argument is forwarded to the `gjsifyNativescript()` preset from `@gjsify/vite-plugin-gjsify` (`{ reflection?, aliases?, optimizeDepsExclude? }`); an optional second argument is a Vite config (object or `(env) => config`) that is `mergeConfig`'d in last, so you can compose your own settings on top.

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
